from ..config import Settings, settings
from .base import ProviderUnavailable, TextToSpeechProvider

class LazyChatterboxProvider(TextToSpeechProvider):
    """Contract-only provider: no model, voice reference, or audio is loaded by V1."""
    def __init__(self, config: Settings = settings):
        self.config = config
        self._engine = None
    @property
    def configured(self) -> bool:
        return bool(self.config.tts_model)
    async def synthesize(self, text: str, *, voice: str, language: str) -> tuple[bytes, str]:
        raise ProviderUnavailable("TTS model runtime is not installed; no weights are loaded by V1")