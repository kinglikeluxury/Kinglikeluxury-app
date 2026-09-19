import asyncio
import base64
import inspect
import os
import sys
import threading
import time
import types
import wave
from io import BytesIO
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("KAY_VOICE_SERVICE_API_KEY", "runpod-test-secret")

from app.providers.base import SynthesisTelemetry, TextToSpeechProvider
from runpod import handler
from runpod.samples import SAMPLE_TEXTS, VOICE_PROFILES


def wav_bytes() -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(b"\0\0")
    return output.getvalue()


class MockProvider(TextToSpeechProvider):
    calls = 0
    telemetry = SynthesisTelemetry(
        model="oddadmix/lahgtna-chatterbox-v1",
        model_revision="test-revision",
        device="mock-device",
        model_load_duration_ms=7,
        generation_duration_ms=9,
        total_request_duration_ms=16,
    )

    @property
    def configured(self):
        return True

    async def synthesize(self, text, *, voice, language):
        type(self).calls += 1
        assert text in SAMPLE_TEXTS.values()
        assert voice == "kay_male"
        assert language == "ar"
        await asyncio.sleep(0)
        return wav_bytes(), "audio/wav"

    def last_telemetry(self):
        return self.telemetry


def valid_input(**overrides):
    payload = {"sample_id": "sample_1", "profile": "A"}
    payload.update(overrides)
    return payload


def test_catalog_is_exact_and_profiles_are_present():
    assert list(SAMPLE_TEXTS) == ["sample_1", "sample_2", "sample_3"]
    assert set(VOICE_PROFILES) == {"A", "B", "C"}
    assert all(text and len(text) <= handler.MAX_SAMPLE_TEXT_LENGTH for text in SAMPLE_TEXTS.values())


def test_import_is_optional_and_core_provider_is_used():
    assert inspect.isclass(TextToSpeechProvider)
    assert handler._runpod is None or hasattr(handler._runpod, "serverless")
    provider = MockProvider()
    result = handler.generate(valid_input(), provider=provider)
    assert result["sample_id"] == "sample_1"
    assert base64.b64decode(result["audio_base64"]).startswith(b"RIFF")
    assert result["model"] == "oddadmix/lahgtna-chatterbox-v1"
    assert result["model_revision"] == "test-revision"
    assert result["device"] == "mock-device"
    assert result["model_load_duration_ms"] == 7


@pytest.mark.parametrize("payload", [
    {"api_key": "wrong", "sample_id": "sample_1", "profile": "A"},
    {"sample_id": "other", "profile": "A"},
    {"sample_id": "sample_1", "profile": "D"},
    {"sample_id": "sample_1", "profile": "A", "text": "arbitrary"},
])
def test_fixed_payload_validation(payload):
    with pytest.raises((PermissionError, ValueError)):
        handler.generate(payload, provider=MockProvider())


def test_handler_does_not_accept_platform_key_in_payload():
    result = handler.handler({"input": {"api_key": "wrong", "sample_id": "sample_1", "profile": "A"}})
    assert result["status"] == "error"
    assert "api_key" not in str(result)


def test_cost_limit_rejects_long_generation(monkeypatch):
    monkeypatch.setattr(handler, "MAX_GENERATION_SECONDS", 0.001)

    class SlowProvider(MockProvider):
        async def synthesize(self, text, *, voice, language):
            await asyncio.sleep(0.01)
            return wav_bytes(), "audio/wav"

    with pytest.raises(TimeoutError):
        handler.generate(valid_input(), provider=SlowProvider())


def test_warm_provider_is_singleton_and_requests_are_serialized(monkeypatch):
    handler._provider = None
    created = []

    class CountingProvider(MockProvider):
        active = 0
        maximum = 0

        def __init__(self):
            created.append(self)

        async def synthesize(self, text, *, voice, language):
            type(self).active += 1
            type(self).maximum = max(type(self).maximum, type(self).active)
            await asyncio.sleep(0.01)
            type(self).active -= 1
            return wav_bytes(), "audio/wav"

    monkeypatch.setattr(handler, "RunPodChatterboxProvider", CountingProvider)
    results = []

    def call():
        results.append(handler.generate(valid_input()))

    threads = [threading.Thread(target=call) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(created) == 1
    assert len(results) == 2
    assert CountingProvider.maximum == 1


def test_provider_fails_without_cuda_before_model_download(monkeypatch, tmp_path):
    from app.providers.base import ProviderUnavailable
    from runpod.provider import RunPodChatterboxProvider

    fake_torch = types.SimpleNamespace(
        cuda=types.SimpleNamespace(is_available=lambda: False)
    )
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    provider = RunPodChatterboxProvider()
    provider._reference = str(tmp_path / "owned.wav")
    Path(provider._reference).write_bytes(b"owned")
    with pytest.raises(ProviderUnavailable, match="CUDA"):
        provider._load_model()


def test_provider_uses_builtin_conditionals_without_reference(monkeypatch):
    from runpod.provider import RunPodChatterboxProvider

    calls = {}

    class FakeAudio:
        def squeeze(self):
            return self

        def detach(self):
            return self

        def cpu(self):
            return self

        def numpy(self):
            return [0.0]

    class FakeModel:
        sr = 8000

        def generate(self, **kwargs):
            calls.update(kwargs)
            return FakeAudio()

    def write_wav(output, samples, sample_rate, format):
        output.write(b"RIFF\x24\x00\x00\x00WAVEfmt ")

    monkeypatch.setitem(sys.modules, "soundfile", types.SimpleNamespace(write=write_wav))
    provider = RunPodChatterboxProvider()
    provider._load_model = lambda: (FakeModel(), 0, "test-device")

    audio, media_type, _ = provider._synthesize_blocking(
        "مساء الخير", {"exaggeration": 0.4, "cfg_weight": 0.6, "temperature": 0.7}
    )

    assert audio.startswith(b"RIFF")
    assert media_type == "audio/wav"
    assert calls["language_id"] == "ar"
    assert calls["audio_prompt_path"] is None


def test_provider_uses_existing_owned_reference(monkeypatch, tmp_path):
    from runpod.provider import RunPodChatterboxProvider

    calls = {}

    class FakeAudio:
        def squeeze(self):
            return self

        def detach(self):
            return self

        def cpu(self):
            return self

        def numpy(self):
            return [0.0]

    class FakeModel:
        sr = 8000

        def generate(self, **kwargs):
            calls.update(kwargs)
            return FakeAudio()

    def write_wav(output, samples, sample_rate, format):
        output.write(b"RIFF\x24\x00\x00\x00WAVEfmt ")

    reference = tmp_path / "owned.wav"
    reference.write_bytes(b"owned")
    monkeypatch.setitem(sys.modules, "soundfile", types.SimpleNamespace(write=write_wav))
    provider = RunPodChatterboxProvider()
    provider._reference = str(reference)
    provider._load_model = lambda: (FakeModel(), 0, "test-device")

    provider._synthesize_blocking("مساء الخير", {})

    assert calls["language_id"] == "ar"
    assert calls["audio_prompt_path"] == str(reference)


def test_warm_model_reports_cached_device_without_reload():
    from runpod.provider import RunPodChatterboxProvider

    provider = RunPodChatterboxProvider()
    provider._model = object()
    provider._actual_device = "NVIDIA Test GPU"
    model, load_ms, device = provider._load_model()
    assert model is provider._model
    assert load_ms == 0
    assert device == "NVIDIA Test GPU"