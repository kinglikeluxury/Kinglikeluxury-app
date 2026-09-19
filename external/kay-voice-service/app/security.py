from fastapi import Header, HTTPException, Request, WebSocket, status
import secrets
from .config import settings

def require_api_key(authorization: str | None = Header(default=None)) -> None:
    if not settings.api_key:
        raise HTTPException(status_code=503, detail="voice service API key is not configured")
    supplied = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
    if not secrets.compare_digest(supplied, settings.api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid API key")

def check_websocket_key(websocket: WebSocket) -> bool:
    if not settings.api_key:
        return False
    authorization = websocket.headers.get("authorization", "")
    bearer = authorization[7:] if authorization.startswith("Bearer ") else ""
    # Browser WebSocket clients cannot set Authorization. They may pass the token
    # in Sec-WebSocket-Protocol as: ["kay-voice-v1", "<api-key>"].
    protocols = [part.strip() for part in websocket.headers.get("sec-websocket-protocol", "").split(",")]
    subprotocol = next((part for part in protocols if part.startswith("kay-voice-v1.")), "")
    protocol_token = subprotocol[len("kay-voice-v1."):] if subprotocol else ""
    return secrets.compare_digest(bearer, settings.api_key) or secrets.compare_digest(protocol_token, settings.api_key)

async def enforce_size(request: Request) -> None:
    length = request.headers.get("content-length")
    if not length:
        return
    try:
        parsed = int(length, 10)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="invalid Content-Length") from None
    if parsed < 0:
        raise HTTPException(status_code=400, detail="invalid Content-Length")
    if parsed > settings.max_request_bytes:
        raise HTTPException(status_code=413, detail="request exceeds size limit")