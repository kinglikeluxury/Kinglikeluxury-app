"""Lazy Chatterbox provider used only by the optional external GPU image.

Heavy imports are deliberately inside _load_model so importing this package in
Replit never imports torch, chatterbox, or downloads model files.
"""

from __future__ import annotations

import asyncio
import io
import os
import time
from pathlib import Path
from typing import Any, Mapping

from app.providers.base import ProviderUnavailable, SynthesisTelemetry, TextToSpeechProvider
from .samples import TTS_MODEL

MODEL_REVISION = os.getenv(
    "KAY_TTS_MODEL_REVISION",
    "6b37e50d1952f07306dc9ff3f3d4ff4ddaf32541",
)
RUNTIME_REVISION = os.getenv(
    "KAY_TTS_RUNTIME_REVISION",
    "433cb74200b55457bffa8ee6965a02ecab546a1c",
)
MODEL_ID = os.getenv("KAY_TTS_MODEL", TTS_MODEL)


class RunPodChatterboxProvider(TextToSpeechProvider):
    def __init__(self) -> None:
        self._model = None
        self._model_load_duration_ms = 0
        self._device = os.getenv("KAY_TTS_DEVICE", "cuda")
        self._reference = os.getenv("KAY_TTS_REFERENCE_AUDIO", "")
        self._actual_device = ""
        self._telemetry = SynthesisTelemetry(model=MODEL_ID, model_revision=MODEL_REVISION)

    @property
    def configured(self) -> bool:
        return not self._reference or Path(self._reference).is_file()

    def _reference_path(self) -> str | None:
        """Return an optional owned reference, or use the model's built-in voice."""
        if not self._reference:
            return None
        if not Path(self._reference).is_file():
            raise ProviderUnavailable(
                "configured KAY_TTS_REFERENCE_AUDIO file does not exist"
            )
        return self._reference

    def _load_model(self) -> tuple[Any, int, str]:
        if self._model is not None:
            return self._model, 0, self._actual_device
        started = time.perf_counter()
        # These imports and the snapshot download happen only on the first
        # deployed request, never during module import.
        import torch
        if not self._device.startswith("cuda") or not torch.cuda.is_available():
            raise ProviderUnavailable("CUDA GPU is required; refusing CPU fallback")
        from huggingface_hub import snapshot_download
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        snapshot = snapshot_download(repo_id=MODEL_ID, revision=MODEL_REVISION)
        device = self._device
        self._model = ChatterboxMultilingualTTS.from_local(snapshot, device=device)
        actual_device = torch.cuda.get_device_name(device)
        self._actual_device = actual_device
        self._model_load_duration_ms = round((time.perf_counter() - started) * 1000)
        return self._model, self._model_load_duration_ms, actual_device

    def _synthesize_blocking(
        self, text: str, options: Mapping[str, Any] | None
    ) -> tuple[bytes, str, SynthesisTelemetry]:
        started = time.perf_counter()
        model, load_ms, device = self._load_model()
        controls = dict(options or {})
        reference = self._reference_path()
        audio = model.generate(
            text=text,
            language_id="ar",
            audio_prompt_path=reference,
            exaggeration=float(controls.get("exaggeration", 0.4)),
            cfg_weight=float(controls.get("cfg_weight", 0.6)),
            temperature=float(controls.get("temperature", 0.7)),
        )
        import soundfile as sf

        output = io.BytesIO()
        samples = audio.squeeze().detach().cpu().numpy()
        sf.write(output, samples, int(model.sr), format="WAV")
        generation_ms = round((time.perf_counter() - started) * 1000) - load_ms
        telemetry = SynthesisTelemetry(
            model=MODEL_ID,
            model_revision=MODEL_REVISION,
            device=device,
            model_load_duration_ms=load_ms,
            generation_duration_ms=max(0, generation_ms),
            total_request_duration_ms=round((time.perf_counter() - started) * 1000),
        )
        self._telemetry = telemetry
        return output.getvalue(), "audio/wav", telemetry

    async def synthesize(self, text: str, *, voice: str, language: str) -> tuple[bytes, str]:
        audio, media_type, _ = await asyncio.to_thread(self._synthesize_blocking, text, None)
        return audio, media_type

    async def synthesize_with_options(
        self, text: str, *, voice: str, language: str,
        options: Mapping[str, Any] | None = None,
    ) -> tuple[bytes, str]:
        audio, media_type, _ = await asyncio.to_thread(
            self._synthesize_blocking, text, options
        )
        return audio, media_type

    def last_telemetry(self) -> SynthesisTelemetry:
        return self._telemetry