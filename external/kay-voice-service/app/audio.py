import io
import wave

class InvalidAudio(ValueError):
    pass

def validate_audio(data: bytes, max_bytes: int, max_duration_seconds: int = 120) -> int:
    if not data or len(data) > max_bytes:
        raise InvalidAudio("audio is empty or exceeds the configured size limit")
    # WAV validation is intentionally conservative; future codecs can be added explicitly.
    try:
        with wave.open(io.BytesIO(data), "rb") as source:
            if source.getcomptype() != "NONE":
                raise InvalidAudio("audio must be uncompressed PCM")
            if source.getnchannels() not in (1, 2):
                raise InvalidAudio("audio must have one or two channels")
            if source.getsampwidth() not in (1, 2, 3, 4):
                raise InvalidAudio("audio sample width is not supported")
            rate = source.getframerate()
            if rate < 8000 or rate > 48000:
                raise InvalidAudio("audio sample rate must be between 8000 and 48000 Hz")
            frames = source.getnframes()
            if not frames or not rate:
                raise InvalidAudio("audio has no samples")
            if frames > rate * max_duration_seconds:
                raise InvalidAudio("audio exceeds the configured duration limit")
            return round(frames * 1000 / rate)
    except (wave.Error, EOFError, ValueError) as exc:
        raise InvalidAudio("audio must be a valid WAV file") from exc