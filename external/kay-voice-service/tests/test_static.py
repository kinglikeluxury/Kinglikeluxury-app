from pathlib import Path
import ast
import unittest

ROOT = Path(__file__).parents[1]

class StaticContractTests(unittest.TestCase):
  def test_required_files_and_no_replit_dependency(self):
    required = ["app/main.py", "app/config.py", "app/audio.py", "app/security.py",
                "app/providers/base.py", "app/providers/stt.py", "app/providers/tts.py",
                "requirements.txt", "requirements-dev.txt", "Dockerfile", "README.md", "MODEL_LICENSES.md"]
    for name in required:
      self.assertTrue((ROOT / name).exists())
    source = "\n".join(p.read_text() for p in (ROOT / "app").rglob("*.py"))
    self.assertNotIn("REPL_ID", source)
    self.assertNotIn("replit", source.lower())
    for p in (ROOT / "app").rglob("*.py"):
      ast.parse(p.read_text())

  def test_protocol_and_safety_contract(self):
    main = (ROOT / "app/main.py").read_text()
    self.assertIn('"/health"', main)
    self.assertIn('"/v1/stt"', main)
    self.assertIn('"/v1/tts"', main)
    self.assertIn('"/v1/realtime"', main)
    for event in ("audio.input", "transcript.partial", "transcript.final", "assistant.text", "audio.output", "turn.end", "error"):
      self.assertIn(event, main)
    self.assertIn("ProviderUnavailable", main)
    self.assertNotIn("UploadFile", main)
    self.assertNotIn("multipart", (ROOT / "requirements.txt").read_text())

  def test_lazy_provider_implementations_support_real_arbitrary_turns(self):
    stt = (ROOT / "app/providers/stt.py").read_text()
    tts = (ROOT / "app/providers/tts.py").read_text()
    self.assertIn("from faster_whisper import WhisperModel", stt)
    self.assertIn("WhisperModel(", stt)
    self.assertIn("model.transcribe(", stt)
    self.assertIn("asyncio.to_thread", stt)
    self.assertIn("from chatterbox.mtl_tts import ChatterboxMultilingualTTS", tts)
    self.assertIn("ChatterboxMultilingualTTS.from_local", tts)
    self.assertIn("text=text[: self.config.max_text_chars]", tts)
    self.assertIn('language_id=language', tts)
    self.assertIn("asyncio.to_thread", tts)
    self.assertNotIn("sample_id", tts)

  def test_container_is_pinned_and_non_root(self):
    dockerfile = (ROOT / "Dockerfile").read_text()
    self.assertIn("python:3.11.9-slim-bookworm", dockerfile)
    self.assertIn("USER kayvoice", dockerfile)
    self.assertIn("${PORT:-8000}", dockerfile)
    self.assertIn("--ws-max-size", dockerfile)
    self.assertIn("KAY_WEBSOCKET_MAX_FRAME_BYTES", dockerfile)
    compose = (ROOT / "docker-compose.example.yml").read_text()
    self.assertIn("KAY_WEBSOCKET_MAX_FRAME_BYTES", compose)
    self.assertIn("audio/wav", (ROOT / "README.md").read_text())
    self.assertIn("HEALTHCHECK", dockerfile)
    self.assertNotIn("python-multipart", (ROOT / "requirements.txt").read_text())
    for line in (ROOT / "requirements.txt").read_text().splitlines():
      if line and not line.startswith("#"):
        self.assertIn("==", line)
    for line in (ROOT / "requirements-dev.txt").read_text().splitlines():
      if line and not line.startswith("#"):
        self.assertIn("==", line)
    self.assertNotIn("tempfile", "\n".join(p.read_text() for p in (ROOT / "app").rglob("*.py")))

  def test_runpod_image_and_adapter_are_optional(self):
    for name in ("runpod/handler.py", "runpod/provider.py", "runpod/samples.py",
                 "runpod/README.md", "Dockerfile.runpod", "requirements-runpod.txt",
                 "assets/internal/kay-syrian-reference.wav"):
      self.assertTrue((ROOT / name).exists())
    image = (ROOT / "Dockerfile.runpod").read_text()
    self.assertIn("runpod/pytorch:1.0.3-cu1281-torch260-ubuntu2404", image)
    self.assertIn("requirements-runpod.txt", image)
    self.assertIn("COPY runpod ./adapter", image)
    self.assertIn("COPY assets/internal ./assets/internal", image)
    self.assertIn("adapter.handler", image)
    self.assertIn("ENTRYPOINT", image)
    self.assertIn("PYTHONPATH=/opt/lahgtna/src:/service", image)
    self.assertIn("https://github.com/Oddadmix/lahgtna-chatterbox.git", image)
    self.assertIn("git checkout 433cb74200b55457bffa8ee6965a02ecab546a1c", image)
    self.assertNotIn("--no-deps", image)
    self.assertIn("import torch, torchaudio, runpod, faster_whisper, numpy, chatterbox.mtl_tts", image)
    requirements = (ROOT / "requirements-runpod.txt").read_text()
    self.assertIn("faster-whisper==1.1.1", requirements)
    self.assertIn("numpy==2.2.3", requirements)
    for line in requirements.splitlines():
      if line and not line.startswith("#"):
        self.assertIn("==", line)
    provider = (ROOT / "runpod/provider.py").read_text()
    self.assertIn("snapshot_download", provider)
    self.assertIn("ChatterboxMultilingualTTS", provider)
    self.assertIn("6b37e50d1952f07306dc9ff3f3d4ff4ddaf32541", provider)
    self.assertIn("KAY_TTS_RUNTIME_REVISION", provider)
    self.assertIn("433cb74200b55457bffa8ee6965a02ecab546a1c", provider)
    self.assertIn("from_local(snapshot, device=device)", provider)
    self.assertNotIn("t3_model=", provider)
    self.assertIn("CUDA GPU is required", provider)
    self.assertNotIn("import torch\n", provider.split("def _load_model", 1)[0])
    adapter = (ROOT / "runpod/handler.py").read_text()
    self.assertIn('operation == "stt"', adapter)
    self.assertIn('operation == "tts"', adapter)
    self.assertIn("audio_base64", adapter)
    self.assertIn("LazyWhisperProvider", adapter)
    self.assertIn("LazyChatterboxProvider", adapter)
    self.assertIn("secrets.compare_digest", adapter)
    self.assertNotIn("only sample_id and profile", adapter)
    self.assertNotIn("SAMPLE_TEXTS", adapter)
    source = "\n".join(p.read_text() for p in (ROOT / "runpod").rglob("*.py"))
    self.assertNotIn("REPL_ID", source)
    self.assertNotIn("DATABASE_URL", source)

if __name__ == "__main__":
  unittest.main()