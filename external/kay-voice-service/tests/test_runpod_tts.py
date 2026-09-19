import asyncio
import base64
import inspect
import os
import sys
import time
import types
import wave
from io import BytesIO
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("KAY_VOICE_SERVICE_API_KEY", "runpod-test-secret")

from app.providers.base import ProviderUnavailable, SynthesisTelemetry, TextToSpeechProvider
from runpod import handler
from runpod.provider import RunPodChatterboxProvider
from runpod.samples import SAMPLE_TEXTS, SPOKEN_TEXTS, VOICE_PROFILES


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
        assert text in SPOKEN_TEXTS.values()
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
    assert set(VOICE_PROFILES) == {"A", "A2", "B", "C"}
    assert all(text and len(text) <= handler.MAX_SAMPLE_TEXT_LENGTH for text in SAMPLE_TEXTS.values())


def test_sample_1_v2_spoken_text_and_calm_profile_preserve_original_catalog():
    original = "مساء الخير أستاذ طارق، معك كاي. حبيت أحكي معك دقيقتين عن متابعة العملاء اليوم."
    spoken = "مساء الخير أستاذ طارئ، معك كاي. حبيت أحكي معك شوي بخصوص متابعة العملاء."
    assert SAMPLE_TEXTS["sample_1"] == original
    assert SPOKEN_TEXTS["sample_1"] == spoken
    assert SPOKEN_TEXTS["sample_2"] == SAMPLE_TEXTS["sample_2"]
    assert SPOKEN_TEXTS["sample_3"] == SAMPLE_TEXTS["sample_3"]
    assert VOICE_PROFILES["A"]["controls"] == {
        "exaggeration": 0.35,
        "cfg_weight": 0.55,
        "temperature": 0.65,
    }
    assert VOICE_PROFILES["B"]["controls"] == {
        "exaggeration": 0.55,
        "cfg_weight": 0.45,
        "temperature": 0.80,
    }
    assert VOICE_PROFILES["C"]["controls"] == {
        "exaggeration": 0.25,
        "cfg_weight": 0.70,
        "temperature": 0.55,
    }
    assert VOICE_PROFILES["A2"]["controls"] == {
        "exaggeration": 0.20,
        "cfg_weight": 0.60,
        "temperature": 0.50,
    }

    class CaptureProvider(MockProvider):
        async def synthesize(self, text, *, voice, language):
            self.received_text = text
            return await super().synthesize(text, voice=voice, language=language)

    provider = CaptureProvider()
    calls_before = CaptureProvider.calls
    asyncio.run(handler.generate(valid_input(profile="A2"), provider=provider))
    assert provider.received_text == spoken
    assert CaptureProvider.calls == calls_before + 1


def test_v2_does_not_globally_replace_qaf():
    source = "\n".join(
        (ROOT / path).read_text()
        for path in ("runpod/samples.py", "runpod/handler.py")
    )
    assert ".replace(\"ق\", \"أ\")" not in source
    assert ".replace('ق', 'أ')" not in source


def test_import_is_optional_and_core_provider_is_used():
    assert inspect.isclass(TextToSpeechProvider)
    assert inspect.iscoroutinefunction(handler.generate)
    assert inspect.iscoroutinefunction(handler.handler)
    assert handler._runpod is None or hasattr(handler._runpod, "serverless")
    provider = MockProvider()
    result = asyncio.run(handler.generate(valid_input(), provider=provider))
    assert result["sample_id"] == "sample_1"
    assert base64.b64decode(result["audio_base64"]).startswith(b"RIFF")
    assert result["model"] == "oddadmix/lahgtna-chatterbox-v1"
    assert result["model_revision"] == "test-revision"
    assert result["device"] == "mock-device"
    assert result["model_load_duration_ms"] == 7


def make_timed_provider(telemetry, clock=None, elapsed_ms=0):
    class TimedProvider(MockProvider):
        def __init__(self):
            self.telemetry = telemetry

        async def synthesize(self, text, *, voice, language):
            assert text in SPOKEN_TEXTS.values()
            assert voice == "kay_male"
            assert language == "ar"
            if clock is not None:
                clock.value = elapsed_ms
            return wav_bytes(), "audio/wav"

    return TimedProvider()


def test_timeout_uses_generation_telemetry_and_preserves_completed_wav(monkeypatch):
    clock = types.SimpleNamespace(value=0)
    monkeypatch.setattr(
        handler,
        "time",
        types.SimpleNamespace(perf_counter=lambda: clock.value / 1000),
    )
    provider = make_timed_provider(
        SynthesisTelemetry(
            model="test-model",
            model_revision="test-revision",
            device="mock-device",
            model_load_duration_ms=20_000,
            generation_duration_ms=25_000,
            total_request_duration_ms=45_000,
        ),
        clock=clock,
        elapsed_ms=45_000,
    )

    result = asyncio.run(handler.generate(valid_input(), provider=provider))

    assert base64.b64decode(result["audio_base64"]).startswith(b"RIFF")
    assert result["model_load_duration_ms"] == 20_000
    assert result["generation_duration_ms"] == 25_000
    assert result["total_request_duration_ms"] == 45_000


def test_generation_timeout_uses_provider_generation_duration(monkeypatch):
    provider = make_timed_provider(
        SynthesisTelemetry(generation_duration_ms=120_001)
    )
    with pytest.raises(TimeoutError, match="generation"):
        asyncio.run(handler.generate(valid_input(), provider=provider))


def test_request_timeout_is_separate_from_generation_timeout(monkeypatch):
    clock = types.SimpleNamespace(value=0)
    monkeypatch.setattr(
        handler,
        "time",
        types.SimpleNamespace(perf_counter=lambda: clock.value / 1000),
    )
    provider = make_timed_provider(
        SynthesisTelemetry(
            model_load_duration_ms=216_000,
            generation_duration_ms=25_000,
            total_request_duration_ms=241_000,
        ),
        clock=clock,
        elapsed_ms=241_000,
    )

    with pytest.raises(TimeoutError, match="request"):
        asyncio.run(handler.generate(valid_input(), provider=provider))


def test_handler_awaits_inside_an_existing_event_loop(monkeypatch):
    provider = MockProvider()
    monkeypatch.setattr(handler, "_provider", provider)

    async def invoke():
        return await handler.handler({"input": valid_input()})

    result = asyncio.run(invoke())

    assert result["status"] == "ok"
    assert base64.b64decode(result["audio_base64"]).startswith(b"RIFF")


def test_live_request_path_does_not_use_nested_asyncio_run():
    source = (ROOT / "runpod/handler.py").read_text()
    assert "asyncio.run(" not in source


@pytest.mark.parametrize("payload", [
    {"api_key": "wrong", "sample_id": "sample_1", "profile": "A"},
    {"sample_id": "other", "profile": "A"},
    {"sample_id": "sample_1", "profile": "D"},
    {"sample_id": "sample_1", "profile": "A", "text": "arbitrary"},
])
def test_fixed_payload_validation(payload):
    with pytest.raises((PermissionError, ValueError)):
        asyncio.run(handler.generate(payload, provider=MockProvider()))


def test_handler_does_not_accept_platform_key_in_payload():
    result = asyncio.run(
        handler.handler(
            {"input": {"api_key": "wrong", "sample_id": "sample_1", "profile": "A"}}
        )
    )
    assert result["status"] == "error"
    assert "api_key" not in str(result)


def test_cost_limit_rejects_long_generation(monkeypatch):
    monkeypatch.setattr(handler, "MAX_GENERATION_SECONDS", 0.001)

    class SlowProvider(MockProvider):
        async def synthesize(self, text, *, voice, language):
            await asyncio.sleep(0.01)
            return wav_bytes(), "audio/wav"

    with pytest.raises(TimeoutError):
        asyncio.run(handler.generate(valid_input(), provider=SlowProvider()))


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

    async def call_twice():
        return await asyncio.gather(
            handler.generate(valid_input()),
            handler.generate(valid_input()),
        )

    results.extend(asyncio.run(call_twice()))
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

def test_provider_uses_private_base64_reference_and_removes_tempfile(monkeypatch):
    from runpod.provider import RunPodChatterboxProvider

    calls = {}
    reference = wav_bytes()

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
            prompt = kwargs["audio_prompt_path"]
            assert prompt.startswith("/tmp/kay-reference-")
            assert Path(prompt).is_file()
            return FakeAudio()

    def write_wav(output, samples, sample_rate, format):
        output.write(b"RIFF\\x24\\x00\\x00\\x00WAVEfmt ")

    monkeypatch.setitem(sys.modules, "soundfile", types.SimpleNamespace(write=write_wav))
    provider = RunPodChatterboxProvider()
    provider._reference = ""
    provider._reference_b64 = base64.b64encode(reference).decode("ascii")
    provider._load_model = lambda: (FakeModel(), 0, "test-device")

    provider._synthesize_blocking("مساء الخير", {})

    assert calls["language_id"] == "ar"
    temp_path = calls["audio_prompt_path"]
    assert not Path(temp_path).exists()


def test_provider_rejects_malformed_private_base64(monkeypatch):
    from app.providers.base import ProviderUnavailable
    from runpod.provider import RunPodChatterboxProvider

    provider = RunPodChatterboxProvider()
    provider._reference = ""
    provider._reference_b64 = "%%%not-base64%%%"

    with pytest.raises(ProviderUnavailable, match="valid base64"):
        with provider._reference_path():
            pass


def test_provider_rejects_invalid_private_wav():
    from app.providers.base import ProviderUnavailable
    from runpod.provider import RunPodChatterboxProvider

    provider = RunPodChatterboxProvider()
    provider._reference = ""
    provider._reference_b64 = base64.b64encode(b"not-a-wave").decode("ascii")

    with pytest.raises(ProviderUnavailable, match="valid PCM WAV"):
        with provider._reference_path():
            pass


def test_provider_rejects_ambiguous_reference_sources(tmp_path):
    from app.providers.base import ProviderUnavailable
    from runpod.provider import RunPodChatterboxProvider

    local_reference = tmp_path / "owned.wav"
    local_reference.write_bytes(wav_bytes())
    provider = RunPodChatterboxProvider()
    provider._reference = str(local_reference)
    provider._reference_b64 = base64.b64encode(wav_bytes()).decode("ascii")

    with pytest.raises(ProviderUnavailable, match="configure only one"):
        with provider._reference_path():
            pass
