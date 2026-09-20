"""Lazy arbitrary-text Arabic Chatterbox provider."""

from __future__ import annotations

import asyncio
import io
import time
from pathlib import Path
from typing import Any, Mapping

from ..config import Settings, settings
from .base import ProviderUnavailable, SynthesisTelemetry, TextToSpeechProvider


class LazyChatterboxProvider(TextToSpeechProvider):
    """Kay male Syrian/Levantine voice provider with lazy model loading."""

    def __init__(self, config: Settings = settings):
        self.config = config
        self._engine = None
        self._model_load_duration_ms = 0
        self._actual_device = ""
        self._telemetry = SynthesisTelemetry(model=config.tts_model)

    @property
    def configured(self) -> bool:
        return bool(self.config.tts_model)

    def _load_model(self) -> Any:
        if self._engine is not None:
            return self._engine
        if not self.config.tts_model:
            raise ProviderUnavailable("KAY_TTS_MODEL is not configured")
        reference = self.config.tts_reference_audio
        if not reference or not Path(reference).is_file():
            raise ProviderUnavailable("an owned/licensed KAY_TTS_REFERENCE_AUDIO file is required")
        started = time.perf_counter()
        try:
            import torch
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS
            from huggingface_hub import snapshot_download
        except ImportError as exc:  # pragma: no cover - depends on future image
            raise ProviderUnavailable("TTS runtime dependencies are not installed") from exc
        try:
            snapshot = snapshot_download(repo_id=self.config.tts_model)
            self._engine = ChatterboxMultilingualTTS.from_local(
                snapshot,
                device=self.config.tts_device,
            )
            self._actual_device = (
                torch.cuda.get_device_name(self.config.tts_device)
                if str(self.config.tts_device).startswith("cuda") and torch.cuda.is_available()
                else str(self.config.tts_device)
            )
        except Exception as exc:  # pragma: no cover - provider/runtime specific
            raise ProviderUnavailable("TTS model could not be loaded") from exc
        self._model_load_duration_ms = round((time.perf_counter() - started) * 1000)
        return self._engine

    def _synthesize_blocking(
        self,
        text: str,
        *,
        voice: str,
        language: str,
        options: Mapping[str, Any] | None = None,
    ) -> tuple[bytes, str]:
        if voice != "kay_male" or language != "ar":
            raise ProviderUnavailable("only the kay_male Arabic voice is enabled")
        if not text.strip():
            raise ProviderUnavailable("TTS text must not be empty")
        model = self._load_model()
        started = time.perf_counter()
        controls = dict(options or {})
        try:
            audio = model.generate(
                text=text[: self.config.max_text_chars],
                language_id=language,
                audio_prompt_path=self.config.tts_reference_audio,
                exaggeration=float(controls.get("exaggeration", 0.4)),
                cfg_weight=float(controls.get("cfg_weight", 0.6)),
                temperature=float(controls.get("temperature", 0.7)),
            )
            import soundfile as sf
            output = io.BytesIO()
            samples = audio.squeeze().detach().cpu().numpy()
            sf.write(output, samples, int(model.sr), format="WAV")
        except Exception as exc:  # pragma: no cover - provider/runtime specific
            raise ProviderUnavailable("TTS synthesis failed") from exc
        generation_ms = round((time.perf_counter() - started) * 1000)
        self._telemetry = SynthesisTelemetry(
            model=self.config.tts_model,
            device=self._actual_device,
            model_load_duration_ms=self._model_load_duration_ms,
            generation_duration_ms=generation_ms,
            total_request_duration_ms=self._model_load_duration_ms + generation_ms,
        )
        return output.getvalue(), "audio/wav"

    async def synthesize(self, text: str, *, voice: str, language: str) -> tuple[bytes, str]:
        return await asyncio.to_thread(
            self._synthesize_blocking,
            text,
            voice=voice,
            language=language,
        )

    async def synthesize_with_options(
        self,
        text: str,
        *,
        voice: str,
        language: str,
        options: Mapping[str, Any] | None = None,
    ) -> tuple[bytes, str]:
        return await asyncio.to_thread(
            self._synthesize_blocking,
            text,
            voice=voice,
            language=language,
            options=options,
        )

    def last_telemetry(self) -> SynthesisTelemetry:
        return self._telemetry