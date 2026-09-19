import asyncio
import json
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from .audio import InvalidAudio, validate_audio
from .config import settings
from .providers.base import ProviderUnavailable
from .providers.stt import LazyWhisperProvider
from .providers.tts import LazyChatterboxProvider
from .security import enforce_size, require_api_key, check_websocket_key

app = FastAPI(title="KAY External Voice Service", version="1.0.0", docs_url=None, redoc_url=None)
stt_provider = LazyWhisperProvider()
tts_provider = LazyChatterboxProvider()

class BodyTooLarge(Exception):
    pass

@app.middleware("http")
async def request_guard(request: Request, call_next):
    try:
        async with asyncio.timeout(settings.request_timeout_seconds):
            await enforce_size(request)
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > settings.max_request_bytes:
                    raise BodyTooLarge
            request.state.raw_body = bytes(body)
            request._body = request.state.raw_body
            return await call_next(request)
    except BodyTooLarge:
        return JSONResponse({"detail": "request exceeds size limit"}, status_code=413)
    except HTTPException as exc:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)
    except asyncio.TimeoutError:
        return JSONResponse({"detail": "request timed out"}, status_code=504)

class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=settings.max_text_chars)
    voice: str = Field(default="kay_male", pattern="^kay_male$")
    language: str = Field(default="ar", pattern="^ar$")

@app.get("/health")
async def health():
    return {"status": "ok", "stt_configured": stt_provider.configured,
            "tts_configured": tts_provider.configured, "stt_model": settings.stt_model,
            "tts_model": settings.tts_model, "audio_persistence": False}

@app.post("/v1/stt", dependencies=[Depends(require_api_key)])
async def stt(request: Request):
    if request.headers.get("content-type", "").split(";", 1)[0].lower() not in {"audio/wav", "audio/x-wav"}:
        raise HTTPException(status_code=415, detail="Content-Type must be audio/wav")
    data = request.state.raw_body
    try:
        duration = validate_audio(data, settings.max_audio_bytes, settings.max_audio_duration_seconds)
        result = await asyncio.wait_for(
            stt_provider.transcribe(data, language="ar"),
            timeout=settings.request_timeout_seconds,
        )
        return {"text": result.text, "language": result.language, "duration_ms": result.duration_ms or duration}
    except InvalidAudio as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

@app.post("/v1/tts", dependencies=[Depends(require_api_key)])
async def tts(payload: TTSRequest):
    try:
        data, media_type = await asyncio.wait_for(
            tts_provider.synthesize(payload.text, voice=payload.voice, language=payload.language),
            timeout=settings.request_timeout_seconds,
        )
        return Response(content=data, media_type=media_type)
    except ProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

@app.websocket("/v1/realtime")
async def realtime(websocket: WebSocket):
    if not check_websocket_key(websocket):
        await websocket.close(code=4401)
        return
    await websocket.accept()
    try:
        await websocket.send_json({"event": "error", "code": "NOT_IMPLEMENTED", "message": "realtime provider is not enabled"})
        async with asyncio.timeout(settings.websocket_max_lifetime_seconds):
            while True:
                raw = await asyncio.wait_for(websocket.receive_text(), settings.websocket_idle_timeout_seconds)
                if len(raw.encode("utf-8")) > settings.websocket_max_frame_bytes:
                    await websocket.close(code=1009)
                    return
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    await websocket.close(code=1007)
                    return
                if not isinstance(message, dict):
                    await websocket.close(code=1008)
                    return
                event = message.get("event")
                if event == "audio.input":
                    await websocket.send_json({"event": "error", "code": "PROVIDER_UNAVAILABLE"})
                elif event in {"transcript.partial", "transcript.final", "assistant.text", "audio.output", "turn.end", "error"}:
                    await websocket.send_json({"event": "error", "code": "READ_ONLY_SKELETON"})
                else:
                    await websocket.send_json({"event": "error", "code": "INVALID_EVENT"})
    except WebSocketDisconnect:
        pass
    except asyncio.TimeoutError:
        await websocket.close(code=1001)