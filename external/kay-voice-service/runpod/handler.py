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
from .samples import SAMPLE_TEXTS, SPOKEN_TEXTS, TTS_MODEL, VOICE_PROFILES

MAX_SAMPLE_TEXT_LENGTH = int(os.getenv("MAX_SAMPLE_TEXT_LENGTH", "300"))
MAX_GENERATION_SECONDS = float(os.getenv("MAX_GENERATION_SECONDS", "120"))
MAX_REQUEST_SECONDS = float(os.getenv("MAX_REQUEST_SECONDS", "240"))
_provider: TextToSpeechProvider | None = None
_provider_lock = threading.Lock()
_generation_locks: dict[asyncio.AbstractEventLoop, asyncio.Lock] = {}
_generation_locks_guard = threading.Lock()


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
    if sample_id == "recording_notice_tarek" and profile != "A2":
        raise ValueError("recording_notice_tarek requires the approved A2 profile")
    text = SPOKEN_TEXTS[sample_id]
    if len(text) > MAX_SAMPLE_TEXT_LENGTH:
        raise ValueError("sample text exceeds MAX_SAMPLE_TEXT_LENGTH")
    return sample_id, profile


def _generation_lock() -> asyncio.Lock:
    """Get one async serialization lock for the currently running loop."""
    loop = asyncio.get_running_loop()
    with _generation_locks_guard:
        lock = _generation_locks.get(loop)
        if lock is None:
            lock = asyncio.Lock()
            _generation_locks[loop] = lock
        return lock


async def _run(
    provider: TextToSpeechProvider, text: str, profile: str
) -> tuple[bytes, str]:
    result = provider.synthesize_with_options(
        text, voice="kay_male", language="ar",
        options=VOICE_PROFILES[profile]["controls"],
    )
    if inspect.isawaitable(result):
        return await result
    return result


async def generate(
    request: dict[str, Any], provider: TextToSpeechProvider | None = None
) -> dict[str, Any]:
    """Generate one approved sample through the existing provider abstraction."""
    started = time.perf_counter()
    sample_id, profile = _payload(request)
    selected = provider or _get_provider()
    generation_started = time.perf_counter()
    async with _generation_lock():
        audio, media_type = await _run(selected, SPOKEN_TEXTS[sample_id], profile)
    generation_duration_ms = round((time.perf_counter() - generation_started) * 1000)
    total_duration_ms = round((time.perf_counter() - started) * 1000)
    telemetry = selected.last_telemetry()
    actual_generation_duration_ms = (
        telemetry.generation_duration_ms or generation_duration_ms
    )
    if actual_generation_duration_ms > MAX_GENERATION_SECONDS * 1000:
        raise TimeoutError("generation exceeded MAX_GENERATION_SECONDS")
    if total_duration_ms > MAX_REQUEST_SECONDS * 1000:
        raise TimeoutError("request exceeded MAX_REQUEST_SECONDS")
    if not isinstance(audio, bytes) or not audio.startswith(b"RIFF") or b"WAVE" not in audio[:16]:
        raise ValueError("provider must return WAV bytes")
    return {
        "sample_id": sample_id,
        "profile": profile,
        "model": telemetry.model or TTS_MODEL,
        "model_revision": telemetry.model_revision,
        "audio_base64": base64.b64encode(audio).decode("ascii"),
        "audio_media_type": media_type or "audio/wav",
        "generation_duration_ms": actual_generation_duration_ms,
        "model_load_duration_ms": telemetry.model_load_duration_ms,
        "total_request_duration_ms": total_duration_ms,
        "device": telemetry.device,
    }


async def handler(job: dict[str, Any]) -> dict[str, Any]:
    """RunPod-compatible entry point; errors are safe and contain no secrets."""
    try:
        return {"status": "ok", **await generate((job or {}).get("input", {}))}
    except (ProviderUnavailable, TimeoutError, ValueError) as exc:
        return {"status": "error", "code": type(exc).__name__.upper(), "message": str(exc)}


_runpod = None
if os.getenv("KAY_RUNPOD_AUTOSTART") == "true":  # pragma: no cover
    try:
        import runpod as _runpod  # type: ignore
    except ImportError as exc:
        raise RuntimeError("RunPod SDK is required only when autostart is enabled") from exc
    _runpod.serverless.start({"handler": handler})