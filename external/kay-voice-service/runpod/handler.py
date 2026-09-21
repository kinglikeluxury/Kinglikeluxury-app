"""Unified, authenticated RunPod adapter for the single-turn Kay test.

The handler accepts exactly two operations:

* ``stt``: one bounded base64-encoded PCM WAV turn.
* ``tts``: one bounded arbitrary Arabic text response.

Provider classes are imported and instantiated lazily. Model runtimes, weights,
and reference audio are touched only after an authenticated request passes all
validation.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import os
import secrets
import threading
from typing import Any

from app.audio import InvalidAudio, validate_audio
from app.config import settings
from app.providers.base import ProviderUnavailable, SpeechToTextProvider, TextToSpeechProvider
from app.providers.stt import LazyWhisperProvider
from app.providers.tts import LazyChatterboxProvider

MAX_AUDIO_BYTES = int(os.getenv("KAY_ONE_TURN_MAX_AUDIO_BYTES", str(2 * 1024 * 1024)))
MAX_AUDIO_DURATION_SECONDS = int(os.getenv("KAY_ONE_TURN_MAX_AUDIO_DURATION_SECONDS", "15"))
MAX_TEXT_CHARS = int(os.getenv("KAY_ONE_TURN_MAX_TEXT_CHARS", str(settings.max_text_chars)))
MAX_GENERATION_SECONDS = float(os.getenv("MAX_GENERATION_SECONDS", "30"))
MAX_BASE64_AUDIO_CHARS = ((MAX_AUDIO_BYTES + 2) // 3) * 4
ALLOWED_WAV_TYPES = {"audio/wav", "audio/x-wav"}
STT_BASE64_KEYS = {"operation", "api_key", "audio_base64", "content_type"}
STT_RAW_KEYS = {"operation", "api_key", "audio", "content_type"}
TTS_KEYS = {"operation", "api_key", "text", "voice", "language"}

logger = logging.getLogger(__name__)
_stt_provider: SpeechToTextProvider | None = None
_tts_provider: TextToSpeechProvider | None = None
_provider_lock = threading.Lock()
_request_lock = asyncio.Lock()


class HandlerRequestError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class HandlerAuthError(PermissionError):
    def __init__(self, code: str = "AUTH_REQUIRED"):
        super().__init__(code)
        self.code = code


def _configured_api_key() -> str:
    return os.getenv("KAY_VOICE_SERVICE_API_KEY", "")


def _require_api_key(payload: dict[str, Any]) -> None:
    expected = _configured_api_key()
    supplied = payload.get("api_key")
    if not expected:
        raise HandlerAuthError("AUTH_NOT_CONFIGURED")
    if not isinstance(supplied, str) or not secrets.compare_digest(supplied, expected):
        raise HandlerAuthError()


def _require_object(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise HandlerRequestError("INVALID_REQUEST")
    return value


def _require_keys(payload: dict[str, Any], expected: set[str]) -> None:
    if set(payload) != expected:
        raise HandlerRequestError("INVALID_REQUEST")


def _decode_wav(payload: dict[str, Any]) -> bytes:
    if payload.get("content_type") not in ALLOWED_WAV_TYPES:
        raise HandlerRequestError("UNSUPPORTED_AUDIO_TYPE")
    if "audio_base64" in payload:
        encoded = payload.get("audio_base64")
        if not isinstance(encoded, str) or not encoded or len(encoded) > MAX_BASE64_AUDIO_CHARS:
            raise HandlerRequestError("AUDIO_TOO_LARGE")
        try:
            audio = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            raise HandlerRequestError("INVALID_AUDIO") from None
    else:
        audio = payload.get("audio")
        if not isinstance(audio, bytes):
            raise HandlerRequestError("INVALID_AUDIO")
    if not audio or len(audio) > MAX_AUDIO_BYTES:
        raise HandlerRequestError("AUDIO_TOO_LARGE")
    try:
        validate_audio(audio, MAX_AUDIO_BYTES, MAX_AUDIO_DURATION_SECONDS)
    except InvalidAudio:
        raise HandlerRequestError("INVALID_AUDIO") from None
    return audio


def _validate_stt_payload(payload: Any) -> tuple[dict[str, Any], bytes]:
    value = _require_object(payload)
    if set(value) not in (STT_BASE64_KEYS, STT_RAW_KEYS):
        raise HandlerRequestError("INVALID_REQUEST")
    _require_api_key(value)
    return value, _decode_wav(value)


def _validate_tts_payload(payload: Any) -> tuple[dict[str, Any], str]:
    value = _require_object(payload)
    _require_keys(value, TTS_KEYS)
    _require_api_key(value)
    text = value.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS:
        raise HandlerRequestError("INVALID_TEXT")
    if value.get("voice") != "kay_male" or value.get("language") != "ar":
        raise HandlerRequestError("UNSUPPORTED_VOICE")
    return value, text.strip()


def _get_stt_provider() -> SpeechToTextProvider:
    global _stt_provider
    if _stt_provider is None:
        with _provider_lock:
            if _stt_provider is None:
                _stt_provider = LazyWhisperProvider()
    return _stt_provider


def _get_tts_provider() -> TextToSpeechProvider:
    global _tts_provider
    if _tts_provider is None:
        with _provider_lock:
            if _tts_provider is None:
                _tts_provider = LazyChatterboxProvider()
    return _tts_provider


async def _generate_stt(
    payload: Any, provider: SpeechToTextProvider | None = None
) -> dict[str, Any]:
    _, audio = _validate_stt_payload(payload)
    selected = provider or _get_stt_provider()
    result = await asyncio.wait_for(
        selected.transcribe(audio, language="ar"),
        timeout=MAX_GENERATION_SECONDS,
    )
    text = getattr(result, "text", "")
    if not isinstance(text, str) or not text.strip():
        raise HandlerRequestError("EMPTY_TRANSCRIPT")
    return {
        "status": "ok",
        "operation": "stt",
        "text": text[: settings.max_text_chars],
        "language": str(getattr(result, "language", "ar") or "ar"),
        "duration_ms": int(getattr(result, "duration_ms", 0) or 0),
    }


async def _generate_tts(
    payload: Any, provider: TextToSpeechProvider | None = None
) -> dict[str, Any]:
    _, text = _validate_tts_payload(payload)
    selected = provider or _get_tts_provider()
    result = await asyncio.wait_for(
        selected.synthesize(text, voice="kay_male", language="ar"),
        timeout=MAX_GENERATION_SECONDS,
    )
    if not isinstance(result, tuple) or len(result) != 2:
        raise HandlerRequestError("INVALID_PROVIDER_AUDIO")
    audio, media_type = result
    if not isinstance(audio, bytes) or not audio.startswith(b"RIFF") or b"WAVE" not in audio[:16]:
        raise HandlerRequestError("INVALID_PROVIDER_AUDIO")
    telemetry = selected.last_telemetry()
    return {
        "status": "ok",
        "operation": "tts",
        "audio_base64": base64.b64encode(audio).decode("ascii"),
        "audio_media_type": media_type or "audio/wav",
        "model": telemetry.model,
        "model_revision": telemetry.model_revision,
        "model_load_duration_ms": telemetry.model_load_duration_ms,
        "generation_duration_ms": telemetry.generation_duration_ms,
        "total_request_duration_ms": telemetry.total_request_duration_ms,
        "device": telemetry.device,
    }


async def generate(
    payload: dict[str, Any],
    *,
    stt_provider: SpeechToTextProvider | None = None,
    tts_provider: TextToSpeechProvider | None = None,
) -> dict[str, Any]:
    value = _require_object(payload)
    operation = value.get("operation")
    async with _request_lock:
        if operation == "stt":
            return await _generate_stt(value, provider=stt_provider)
        if operation == "tts":
            return await _generate_tts(value, provider=tts_provider)
    raise HandlerRequestError("UNSUPPORTED_OPERATION")


async def handler(
    job: dict[str, Any],
    *,
    stt_provider: SpeechToTextProvider | None = None,
    tts_provider: TextToSpeechProvider | None = None,
) -> dict[str, Any]:
    """RunPod-compatible entry point with generic, non-sensitive errors."""
    try:
        request = _require_object((job or {}).get("input"))
        return await generate(
            request,
            stt_provider=stt_provider,
            tts_provider=tts_provider,
        )
    except HandlerAuthError as exc:
        return {"status": "error", "code": exc.code}
    except HandlerRequestError as exc:
        return {"status": "error", "code": exc.code}
    except InvalidAudio:
        return {"status": "error", "code": "INVALID_REQUEST"}
    except TimeoutError:
        return {"status": "error", "code": "TIMEOUT"}
    except ProviderUnavailable:
        return {"status": "error", "code": "PROVIDER_UNAVAILABLE"}
    except Exception:
        job_id = job.get("id", "unknown") if isinstance(job, dict) else "unknown"
        logger.exception("RunPod handler failed job_id=%s", job_id)
        return {"status": "error", "code": "INTERNAL_ERROR"}


_runpod = None
if os.getenv("KAY_RUNPOD_AUTOSTART") == "true":  # pragma: no cover
    try:
        import runpod as _runpod  # type: ignore
    except ImportError as exc:
        raise RuntimeError("RunPod SDK is required only when autostart is enabled") from exc
    _runpod.serverless.start({"handler": handler})