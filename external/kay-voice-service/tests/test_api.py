import os
import sys
import wave
from dataclasses import replace
import asyncio
import pytest
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
os.environ["KAY_VOICE_SERVICE_API_KEY"] = "test-secret"

from app import main
from app.config import settings

client = TestClient(main.app)

def _wav(rate=8000, channels=1, width=2, frames=1):
    buffer = __import__("io").BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(channels)
        output.setsampwidth(width)
        output.setframerate(rate)
        output.writeframes(b"\0" * frames * channels * width)
    return buffer.getvalue()

def test_health_safe_output():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["stt_model"] == settings.stt_model
    assert body["tts_model"] == settings.tts_model
    assert body["stt_configured"] is True
    assert body["tts_configured"] is True
    assert "api_key" not in body

@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}])
def test_missing_or_wrong_api_key(headers):
    assert client.post("/v1/tts", json={"text": "مرحبا"}, headers=headers).status_code == 401

def test_unset_api_key_fails_closed(monkeypatch):
    from app import security
    monkeypatch.setattr(security, "settings", replace(security.settings, api_key=""))
    assert client.post("/v1/tts", json={"text": "مرحبا"}, headers={"Authorization": "Bearer test-secret"}).status_code == 503

def test_correct_api_key_reaches_provider():
    response = client.post("/v1/tts", json={"text": "مرحبا"}, headers={"Authorization": "Bearer test-secret"})
    assert response.status_code == 503

def test_invalid_audio_rejected_before_provider_unavailable():
    response = client.post("/v1/stt", content=b"not wav", headers={"Content-Type": "audio/wav", "Authorization": "Bearer test-secret"})
    assert response.status_code == 400

def test_valid_wav_reaches_lazy_provider_503():
    response = client.post("/v1/stt", content=_wav(), headers={"Content-Type": "audio/wav",
                           "Authorization": "Bearer test-secret"})
    assert response.status_code == 503

def _invalid_width_wav():
    data = bytearray(_wav(width=4))
    data[34:36] = (40).to_bytes(2, "little")
    return bytes(data)

@pytest.mark.parametrize("wav", [_wav(channels=3), _wav(rate=4000), _invalid_width_wav()])
def test_strict_wav_format_rejected(wav):
    response = client.post("/v1/stt", content=wav, headers={"Content-Type": "audio/wav",
                           "Authorization": "Bearer test-secret"})
    assert response.status_code == 400

def test_audio_duration_limit():
    old = main.settings
    main.settings = replace(old, max_audio_duration_seconds=1)
    try:
        response = client.post("/v1/stt", content=_wav(frames=8001), headers={"Content-Type": "audio/wav",
                               "Authorization": "Bearer test-secret"})
    finally:
        main.settings = old
    assert response.status_code == 400

def test_streamed_body_limit_without_content_length():
    old = main.settings
    main.settings = replace(old, max_request_bytes=4)
    try:
        response = client.post("/v1/stt", content=b"12345", headers={"Content-Type": "audio/wav",
                               "Authorization": "Bearer test-secret"})
    finally:
        main.settings = old
    assert response.status_code == 413

def test_tts_body_limit():
    old = main.settings
    main.settings = replace(old, max_request_bytes=16)
    try:
        response = client.post("/v1/tts", content=b'{"text":"this is too large"}',
                               headers={"Content-Type": "application/json", "Authorization": "Bearer test-secret"})
    finally:
        main.settings = old
    assert response.status_code == 413

def test_slow_async_body_ingress_is_terminated_by_request_timeout():
    old = main.settings
    main.settings = replace(old, request_timeout_seconds=0.01)
    sent = []
    state = {"count": 0}

    async def receive():
        await asyncio.sleep(0.05)
        state["count"] += 1
        return {"type": "http.request", "body": b"{}", "more_body": False}

    async def send(message):
        sent.append(message)

    async def invoke():
        await main.app({
            "type": "http", "http_version": "1.1", "method": "POST",
            "path": "/v1/tts", "raw_path": b"/v1/tts", "query_string": b"",
            "headers": [(b"authorization", b"Bearer test-secret"),
                        (b"content-type", b"application/json")],
            "scheme": "http", "server": ("test", 80), "client": ("test", 1),
            "root_path": "",
        }, receive, send)

    try:
        asyncio.run(invoke())
    finally:
        main.settings = old
    assert next(message for message in sent if message["type"] == "http.response.start")["status"] == 504

def test_invalid_content_length():
    response = client.post("/v1/tts", content=b"{}", headers={"Content-Length": "not-a-number",
                           "Authorization": "Bearer test-secret"})
    assert response.status_code == 400

def test_negative_content_length():
    response = client.post("/v1/tts", content=b"{}", headers={"Content-Length": "-1",
                           "Authorization": "Bearer test-secret"})
    assert response.status_code == 400

def test_lying_oversized_content_length():
    response = client.post("/v1/tts", content=b"{}", headers={"Content-Length": str(settings.max_request_bytes + 1),
                           "Authorization": "Bearer test-secret"})
    assert response.status_code == 413

@pytest.mark.parametrize("payload", [{"text": ""}, {"text": "hello", "voice": "other"},
                                     {"text": "hello", "language": "english"}])
def test_tts_payload_validation(payload):
    assert client.post("/v1/tts", json=payload, headers={"Authorization": "Bearer test-secret"}).status_code == 422

def test_realtime_unauthorized_rejected():
    with pytest.raises(Exception):
        with client.websocket_connect("/v1/realtime"):
            pass

def test_realtime_authorized_skeleton_protocol():
    with client.websocket_connect("/v1/realtime", subprotocols=["kay-voice-v1.test-secret"]) as socket:
        assert socket.receive_json()["event"] == "error"
        socket.send_json({"event": "audio.input", "data": "not-audio"})
        assert socket.receive_json()["code"] == "PROVIDER_UNAVAILABLE"

def test_realtime_malformed_json_rejected():
    with client.websocket_connect("/v1/realtime", subprotocols=["kay-voice-v1.test-secret"]) as socket:
        socket.receive_json()
        socket.send_text("{")
        with pytest.raises(Exception):
            socket.receive_json()

def test_realtime_oversized_frame_rejected():
    old = main.settings
    main.settings = replace(old, websocket_max_frame_bytes=4)
    try:
        with client.websocket_connect("/v1/realtime", subprotocols=["kay-voice-v1.test-secret"]) as socket:
            socket.receive_json()
            socket.send_text('{"event":"audio.input"}')
            with pytest.raises(Exception):
                socket.receive_json()
    finally:
        main.settings = old

def test_realtime_idle_timeout_rejected():
    old = main.settings
    main.settings = replace(old, websocket_idle_timeout_seconds=0.01)
    try:
        with client.websocket_connect("/v1/realtime", subprotocols=["kay-voice-v1.test-secret"]) as socket:
            socket.receive_json()
            with pytest.raises(Exception):
                socket.receive_json()
    finally:
        main.settings = old

def test_provider_abstract_contracts():
    from app.providers.base import SpeechToTextProvider, TextToSpeechProvider
    assert __import__("inspect").isabstract(SpeechToTextProvider)
    assert __import__("inspect").isabstract(TextToSpeechProvider)