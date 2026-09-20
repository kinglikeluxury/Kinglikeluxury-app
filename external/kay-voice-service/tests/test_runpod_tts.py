import asyncio
import base64
import os
import wave
from io import BytesIO
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
os.environ["KAY_VOICE_SERVICE_API_KEY"] = "runpod-test-secret"

from app.providers.base import SynthesisTelemetry, Transcription
from runpod import handler


def wav_bytes() -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16_000)
        wav.writeframes(b"\0\0" * 160)
    return output.getvalue()


class MockSttProvider:
    def __init__(self):
        self.calls = 0

    async def transcribe(self, audio, *, language):
        self.calls += 1
        assert audio.startswith(b"RIFF")
        assert language == "ar"
        return Transcription(text="مرحبا يا كاي", language="ar", duration_ms=10)


class MockTtsProvider:
    def __init__(self):
        self.calls = 0

    async def synthesize(self, text, *, voice, language):
        self.calls += 1
        assert text == "هذا رد عربي حر للاختبار"
        assert voice == "kay_male"
        assert language == "ar"
        return wav_bytes(), "audio/wav"

    def last_telemetry(self):
        return SynthesisTelemetry(
            model="test-model",
            model_revision="test-revision",
            device="test-device",
            model_load_duration_ms=0,
            generation_duration_ms=1,
            total_request_duration_ms=1,
        )


def stt_payload(**overrides):
    payload = {
        "operation": "stt",
        "api_key": "runpod-test-secret",
        "audio_base64": base64.b64encode(wav_bytes()).decode("ascii"),
        "content_type": "audio/wav",
    }
    payload.update(overrides)
    return payload


def tts_payload(**overrides):
    payload = {
        "operation": "tts",
        "api_key": "runpod-test-secret",
        "text": "هذا رد عربي حر للاختبار",
        "voice": "kay_male",
        "language": "ar",
    }
    payload.update(overrides)
    return payload


def test_unified_handler_accepts_one_stt_wav_turn():
    provider = MockSttProvider()
    result = handler.generate(stt_payload(), stt_provider=provider)
    assert result["status"] == "ok"
    assert result["operation"] == "stt"
    assert result["text"] == "مرحبا يا كاي"
    assert provider.calls == 1


def test_unified_handler_accepts_one_raw_wav_turn():
    provider = MockSttProvider()
    payload = stt_payload()
    payload.pop("audio_base64")
    payload["audio"] = wav_bytes()
    result = handler.generate(payload, stt_provider=provider)
    assert result["status"] == "ok"
    assert result["operation"] == "stt"


def test_unified_handler_accepts_arbitrary_arabic_tts():
    provider = MockTtsProvider()
    result = handler.generate(tts_payload(), tts_provider=provider)
    assert result["status"] == "ok"
    assert result["operation"] == "tts"
    assert base64.b64decode(result["audio_base64"]).startswith(b"RIFF")
    assert result["model"] == "test-model"
    assert provider.calls == 1


@pytest.mark.parametrize("payload", [
    stt_payload(api_key="wrong"),
    tts_payload(api_key="wrong"),
])
def test_both_operations_reject_bad_auth(payload):
    result = handler.handler({"input": payload})
    assert result == {"status": "error", "code": "AUTH_REQUIRED"}


def test_missing_service_key_fails_closed(monkeypatch):
    monkeypatch.delenv("KAY_VOICE_SERVICE_API_KEY", raising=False)
    result = handler.handler({"input": tts_payload()})
    assert result == {"status": "error", "code": "AUTH_NOT_CONFIGURED"}


def test_stt_rejects_oversize_and_unsupported_payload(monkeypatch):
    monkeypatch.setattr(handler, "MAX_AUDIO_BYTES", 1)
    monkeypatch.setattr(handler, "MAX_BASE64_AUDIO_CHARS", 8)
    assert handler.handler({"input": stt_payload()})["code"] == "AUDIO_TOO_LARGE"
    assert handler.handler({"input": stt_payload(content_type="audio/mp3")})["code"] == "UNSUPPORTED_AUDIO_TYPE"


def test_strict_payload_and_text_validation():
    assert handler.handler({"input": tts_payload(extra="nope")})["code"] == "INVALID_REQUEST"
    assert handler.handler({"input": tts_payload(language="en")})["code"] == "UNSUPPORTED_VOICE"
    assert handler.handler({"input": {"operation": "realtime", "api_key": "runpod-test-secret"}})["code"] == "UNSUPPORTED_OPERATION"


def test_timeout_is_generic_and_bounded(monkeypatch):
    monkeypatch.setattr(handler, "MAX_GENERATION_SECONDS", 0.001)

    class SlowProvider(MockTtsProvider):
        async def synthesize(self, text, *, voice, language):
            await asyncio.sleep(0.01)
            return wav_bytes(), "audio/wav"

    with pytest.raises(TimeoutError):
        handler.generate(tts_payload(), tts_provider=SlowProvider())
    monkeypatch.setattr(handler, "MAX_GENERATION_SECONDS", 30)


def test_import_and_provider_construction_do_not_load_models():
    assert handler._stt_provider is None
    assert handler._tts_provider is None
    assert "faster_whisper" not in handler.__dict__
    assert "torch" not in handler.__dict__


def test_image_reference_is_valid_internal_wav():
    reference = ROOT / "assets/internal/kay-syrian-reference.wav"
    assert reference.exists()
    with wave.open(str(reference), "rb") as audio:
        assert audio.getnchannels() == 1
        assert audio.getsampwidth() == 2
        assert audio.getcomptype() == "NONE"