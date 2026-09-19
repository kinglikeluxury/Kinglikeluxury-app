from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Mapping

class ProviderUnavailable(RuntimeError):
    """A provider is configured but its optional model runtime/weights are absent."""

@dataclass(frozen=True)
class Transcription:
    text: str
    language: str
    duration_ms: int

@dataclass(frozen=True)
class SynthesisTelemetry:
    model: str = ""
    model_revision: str = ""
    device: str = ""
    model_load_duration_ms: int = 0
    generation_duration_ms: int = 0
    total_request_duration_ms: int = 0

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

    async def synthesize_with_options(
        self,
        text: str,
        *,
        voice: str,
        language: str,
        options: Mapping[str, Any] | None = None,
    ) -> tuple[bytes, str]:
        """Backward-compatible extension point for provider-specific controls."""
        return await self.synthesize(text, voice=voice, language=language)

    def last_telemetry(self) -> SynthesisTelemetry:
        """Providers may override this with truthful request telemetry."""
        return SynthesisTelemetry()