from abc import ABC, abstractmethod
from dataclasses import dataclass

class ProviderUnavailable(RuntimeError):
    """A provider is configured but its optional model runtime/weights are absent."""

@dataclass(frozen=True)
class Transcription:
    text: str
    language: str
    duration_ms: int

class SpeechToTextProvider(ABC):
    @property
    @abstractmethod
    def configured(self) -> bool: ...
    @abstractmethod
    async def transcribe(self, audio: bytes, *, language: str = "ar") -> Transcription: ...

class TextToSpeechProvider(ABC):
    @property
    @abstractmethod
    def configured(self) -> bool: ...
    @abstractmethod
    async def synthesize(self, text: str, *, voice: str, language: str) -> tuple[bytes, str]: ...