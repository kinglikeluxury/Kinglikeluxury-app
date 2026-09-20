"""Lazy Arabic Whisper provider.

The module deliberately imports no ML runtime at import time.  The first
request in a future voice-worker image loads faster-whisper and its configured
model; the application can therefore import this contract without
downloading weights or starting a model.
"""

from __future__ import annotations

import asyncio
import io
import time
import wave
from array import array
from typing import Any

from ..config import Settings, settings
from .base import ProviderUnavailable, SpeechToTextProvider, Transcription


def _pcm_to_float(audio: bytes) -> tuple[Any, int]:
    """Decode the bounded PCM WAV accepted by the HTTP contract.

    numpy is imported only when the model is actually requested.  Supporting
    the common PCM widths here keeps the provider independent from ffmpeg and
    avoids writing uploaded audio to disk.
    """
    try:
        import numpy as np
    except ImportError as exc:  # pragma: no cover - depends on future image
        raise ProviderUnavailable("STT runtime dependency numpy is not installed") from exc

    try:
        with wave.open(io.BytesIO(audio), "rb") as source:
            channels = source.getnchannels()
            width = source.getsampwidth()
            rate = source.getframerate()
            frames = source.readframes(source.getnframes())
    except (wave.Error, EOFError) as exc:
        raise ProviderUnavailable("STT received an unreadable WAV payload") from exc

    if channels < 1 or width not in {1, 2, 3, 4} or rate < 1:
        raise ProviderUnavailable("STT received unsupported PCM WAV parameters")

    if width == 1:
        samples = np.frombuffer(frames, dtype=np.uint8).astype(np.float32)
        samples = (samples - 128.0) / 128.0
    elif width == 2:
        samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        samples = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raw = np.frombuffer(frames, dtype=np.uint8).reshape(-1, 3)
        signed = (
            raw[:, 0].astype(np.int32)
            | (raw[:, 1].astype(np.int32) << 8)
            | (raw[:, 2].astype(np.int32) << 16)
        )
        signed = np.where((signed & 0x800000) != 0, signed - 0x1000000, signed)
        samples = signed.astype(np.float32) / 8388608.0

    if channels > 1:
        samples = samples[: len(samples) - (len(samples) % channels)]
        samples = samples.reshape(-1, channels).mean(axis=1)
    return np.asarray(samples, dtype=np.float32), rate


def _resample(samples: Any, source_rate: int, target_rate: int = 16_000) -> Any:
    if source_rate == target_rate:
        return samples
    try:
        import numpy as np
    except ImportError as exc:  # pragma: no cover - depends on future image
        raise ProviderUnavailable("STT runtime dependency numpy is not installed") from exc
    if len(samples) == 0:
        return samples
    target_length = max(1, round(len(samples) * target_rate / source_rate))
    source_positions = np.arange(len(samples), dtype=np.float32)
    target_positions = np.linspace(0, len(samples) - 1, target_length, dtype=np.float32)
    return np.interp(target_positions, source_positions, samples).astype(np.float32)


class LazyWhisperProvider(SpeechToTextProvider):
    """Arabic Whisper-large provider with lazy runtime/model loading."""

    def __init__(self, config: Settings = settings):
        self.config = config
        self._engine = None
        self._model_load_duration_ms = 0

    @property
    def configured(self) -> bool:
        return bool(self.config.stt_model)

    def _load_model(self) -> Any:
        if self._engine is not None:
            return self._engine
        if not self.config.stt_model:
            raise ProviderUnavailable("KAY_STT_MODEL is not configured")
        started = time.perf_counter()
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:  # pragma: no cover - depends on future image
            raise ProviderUnavailable("STT runtime dependency faster-whisper is not installed") from exc
        try:
            self._engine = WhisperModel(
                self.config.stt_model,
                device=self.config.stt_device,
                compute_type=self.config.stt_compute_type,
            )
        except Exception as exc:  # pragma: no cover - provider/runtime specific
            raise ProviderUnavailable("STT model could not be loaded") from exc
        self._model_load_duration_ms = round((time.perf_counter() - started) * 1000)
        return self._engine

    def _transcribe_blocking(self, audio: bytes, language: str) -> Transcription:
        samples, sample_rate = _pcm_to_float(audio)
        samples = _resample(samples, sample_rate)
        model = self._load_model()
        try:
            segments, info = model.transcribe(
                samples,
                language=language,
                task="transcribe",
                vad_filter=True,
                beam_size=5,
            )
            text = " ".join(str(segment.text).strip() for segment in segments).strip()
            detected_language = str(getattr(info, "language", None) or language)
        except Exception as exc:  # pragma: no cover - provider/runtime specific
            raise ProviderUnavailable("STT transcription failed") from exc
        duration_ms = round(len(samples) / 16_000 * 1000)
        return Transcription(text=text[:4000], language=detected_language, duration_ms=duration_ms)

    async def transcribe(self, audio: bytes, *, language: str = "ar") -> Transcription:
        if not audio:
            raise ProviderUnavailable("STT received an empty WAV payload")
        return await asyncio.to_thread(self._transcribe_blocking, audio, language)