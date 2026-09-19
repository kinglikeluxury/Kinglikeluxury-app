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

if __name__ == "__main__":
  unittest.main()