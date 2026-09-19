from dataclasses import dataclass
import os

@dataclass(frozen=True)
class Settings:
    api_key: str = os.getenv("KAY_VOICE_SERVICE_API_KEY", "")
    stt_model: str = os.getenv("KAY_STT_MODEL", "dev-ahmedhany/whisper-large-v3-arabic-ft-v3-ct2-int8")
    stt_device: str = os.getenv("KAY_STT_DEVICE", "cpu")
    stt_compute_type: str = os.getenv("KAY_STT_COMPUTE_TYPE", "int8")
    tts_model: str = os.getenv("KAY_TTS_MODEL", "oddadmix/lahgtna-chatterbox-v1")
    tts_device: str = os.getenv("KAY_TTS_DEVICE", "cpu")
    tts_reference_audio: str = os.getenv("KAY_TTS_REFERENCE_AUDIO", "")
    tts_language: str = os.getenv("KAY_TTS_LANGUAGE", "ar")
    max_request_bytes: int = int(os.getenv("KAY_MAX_REQUEST_BYTES", "10485760"))
    max_audio_bytes: int = int(os.getenv("KAY_MAX_AUDIO_BYTES", "8388608"))
    max_text_chars: int = int(os.getenv("KAY_MAX_TEXT_CHARS", "4000"))
    request_timeout_seconds: int = int(os.getenv("KAY_REQUEST_TIMEOUT_SECONDS", "30"))
    max_audio_duration_seconds: int = int(os.getenv("KAY_MAX_AUDIO_DURATION_SECONDS", "120"))
    websocket_max_frame_bytes: int = int(os.getenv("KAY_WEBSOCKET_MAX_FRAME_BYTES", "1048576"))
    websocket_idle_timeout_seconds: int = int(os.getenv("KAY_WEBSOCKET_IDLE_TIMEOUT_SECONDS", "60"))
    websocket_max_lifetime_seconds: int = int(os.getenv("KAY_WEBSOCKET_MAX_LIFETIME_SECONDS", "900"))

    @property
    def stt_configured(self) -> bool:
        return bool(self.stt_model)

    @property
    def tts_configured(self) -> bool:
        return bool(self.tts_model)

settings = Settings()