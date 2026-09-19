"""Optional RunPod Serverless TTS-only adapter.

This module is importable without the optional ``runpod`` package. It is
deliberately limited to the three approved first samples and never logs input.
"""

from __future__ import annotations

import asyncio
import base64
import inspect
import os
import threading
import time
from typing import Any

from app.providers.base import ProviderUnavailable, TextToSpeechProvider
from .provider import RunPodChatterboxProvider
from .samples import SAMPLE_TEXTS, TTS_MODEL, VOICE_PROFILES

MAX_SAMPLE_TEXT_LENGTH = int(os.getenv("MAX_SAMPLE_TEXT_LENGTH", "300"))
MAX_GENERATION_SECONDS = float(os.getenv("MAX_GENERATION_SECONDS", "30"))
_provider: TextToSpeechProvider | None = None
_provider_lock = threading.Lock()


def _get_provider() -> TextToSpeechProvider:
    """Create one provider per warm worker; never downloads a model here."""
    global _provider
    if _provider is None:
        with _provider_lock:
            if _provider is None:
                _provider = RunPodChatterboxProvider()
    return _provider


def _payload(request: dict[str, Any]) -> tuple[str, str]:
    if not isinstance(request, dict):
        raise ValueError("input must be an object")
    if set(request) != {"sample_id", "profile"}:
        raise ValueError("only sample_id and profile are accepted; use native RunPod auth")
    sample_id = request.get("sample_id")
    profile = request.get("profile")
    if sample_id not in SAMPLE_TEXTS or profile not in VOICE_PROFILES:
        raise ValueError("sample_id and profile must select an approved sample")
    text = SAMPLE_TEXTS[sample_id]
    if len(text) > MAX_SAMPLE_TEXT_LENGTH:
        raise ValueError("sample text exceeds MAX_SAMPLE_TEXT_LENGTH")
    return sample_id, profile


def _run(provider: TextToSpeechProvider, text: str, profile: str) -> tuple[bytes, str]:
    result = provider.synthesize_with_options(
        text, voice="kay_male", language="ar",
        options=VOICE_PROFILES[profile]["controls"],
    )
    if inspect.isawaitable(result):
        return asyncio.run(result)
    return result


def generate(request: dict[str, Any], provider: TextToSpeechProvider | None = None) -> dict[str, Any]:
    """Generate one approved sample through the existing provider abstraction."""
    started = time.perf_counter()
    sample_id, profile = _payload(request)
    selected = provider or _get_provider()
    generation_started = time.perf_counter()
    with _provider_lock:
        audio, media_type = _run(selected, SAMPLE_TEXTS[sample_id], profile)
    generation_duration_ms = round((time.perf_counter() - generation_started) * 1000)
    total_duration_ms = round((time.perf_counter() - started) * 1000)
    if total_duration_ms > MAX_GENERATION_SECONDS * 1000:
        raise TimeoutError("generation exceeded MAX_GENERATION_SECONDS")
    if not isinstance(audio, bytes) or not audio.startswith(b"RIFF") or b"WAVE" not in audio[:16]:
        raise ValueError("provider must return WAV bytes")
    telemetry = selected.last_telemetry()
    return {
        "sample_id": sample_id,
        "profile": profile,
        "model": telemetry.model or TTS_MODEL,
        "model_revision": telemetry.model_revision,
        "audio_base64": base64.b64encode(audio).decode("ascii"),
        "audio_media_type": media_type or "audio/wav",
        "generation_duration_ms": telemetry.generation_duration_ms or generation_duration_ms,
        "model_load_duration_ms": telemetry.model_load_duration_ms,
        "total_request_duration_ms": total_duration_ms,
        "device": telemetry.device,
    }


def handler(job: dict[str, Any]) -> dict[str, Any]:
    """RunPod-compatible entry point; errors are safe and contain no secrets."""
    try:
        return {"status": "ok", **generate((job or {}).get("input", {}))}
    except (ProviderUnavailable, TimeoutError, ValueError) as exc:
        return {"status": "error", "code": type(exc).__name__.upper(), "message": str(exc)}


_runpod = None
if os.getenv("KAY_RUNPOD_AUTOSTART") == "true":  # pragma: no cover
    try:
        import runpod as _runpod  # type: ignore
    except ImportError as exc:
        raise RuntimeError("RunPod SDK is required only when autostart is enabled") from exc
    _runpod.serverless.start({"handler": handler})