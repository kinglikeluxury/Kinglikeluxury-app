from ..config import Settings, settings
from .base import ProviderUnavailable, SpeechToTextProvider, Transcription

class LazyWhisperProvider(SpeechToTextProvider):
    """Contract-only provider: model loading is deliberately deferred to a future image."""
    def __init__(self, config: Settings = settings):
        self.config = config
        self._engine = None
    @property
    def configured(self) -> bool:
        return bool(self.config.stt_model)
    async def transcribe(self, audio: bytes, *, language: str = "ar") -> Transcription:
        raise ProviderUnavailable("STT model runtime is not installed; no weights are loaded by V1")