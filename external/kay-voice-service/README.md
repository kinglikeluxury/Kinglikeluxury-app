# KAY External Voice Service V1

Portable FastAPI contract for a future self-hosted Arabic voice worker. It is intentionally independent of Kinglike, Replit, databases, telephony, CRM, and paid APIs. Providers are lazy contract implementations: no model weights are downloaded or loaded, and endpoints return `503` until an approved provider runtime is installed.

## Run

```bash
cp .env.example .env
docker compose -f docker-compose.example.yml up --build
```

Set a strong `KAY_VOICE_SERVICE_API_KEY`. `GET /health` is intentionally safe and unauthenticated; STT, TTS, and realtime require the key. Audio is validated in memory, never persisted, logged, or recorded. HTTP clients use `Authorization: Bearer <key>`. Browser WebSocket clients must not put secrets in URLs; use `new WebSocket(url, ["kay-voice-v1.<key>"])`, which sends the token in `Sec-WebSocket-Protocol` during the handshake. Raw request bodies stay memory-only; a reverse proxy may still log metadata or bodies and must be configured not to do so.

* `POST /v1/stt` — raw request body with `Content-Type: audio/wav` (or `audio/x-wav`), containing a valid WAV; there is no multipart wrapper or `audio` field.
* `POST /v1/tts` — JSON `{ "text": "...", "voice": "kay_male", "language": "ar" }`, returns audio when a provider is installed.
* `WS /v1/realtime` — authenticated future protocol skeleton.

Realtime event names are `audio.input`, `transcript.partial`, `transcript.final`, `assistant.text`, `audio.output`, `turn.end`, and `error`. The future pipeline is employee microphone → STT → Kay conversation engine → TTS chunks → browser; no LLM is included here. The Uvicorn transport limit is `KAY_WEBSOCKET_MAX_FRAME_BYTES`; any reverse proxy or WebSocket gateway must enforce the same value or a smaller one.

## Kay profile and portability

`kay_male` targets a calm, confident, professional, natural, conversational male voice with Syrian/Levantine Arabic capability and a perceived age around 30–40; it is not overly formal or robotic. Exact Syrian quality is not claimed until samples are generated and heard. Reference audio is configurable and must be owned/authorized; no third-party voice is hardcoded.

The same image is designed for RunPod Serverless, another GPU provider, a GPU VPS, or an owned server. Lazy loading, an optional warm worker, scale-to-zero operation, and small-team concurrency keep it serverless-friendly. A future deployment should expect a suitable GPU class for Whisper-large/Arabic TTS (provider-dependent, typically 12–24GB VRAM); none is provisioned here.

## RunPod Serverless deployment design (future, not provisioned)

Use a thin RunPod HTTP handler as an adapter around the same provider interfaces: validate the request, obtain a worker from a bounded pool, call STT/TTS, and return the contract response. Keep the FastAPI image as the worker image; do not put Kinglike or database code in it. RunPod Serverless is HTTP/job oriented, so the realtime WebSocket contract should be terminated by a separate WebSocket-capable gateway that forwards bounded events to a warm worker; do not assume a long-lived WebSocket survives scale-to-zero.

Mount a model-cache volume (or provider cache) only in a later deployment so cold starts download approved weights once per worker. Lazy-load models on first request, offer an optional warm worker for latency-sensitive periods, and configure a single concurrent request per GPU until measured otherwise. Keep the 30-second request timeout, 60-second realtime idle timeout, 15-minute realtime lifetime, and bounded audio/frame sizes aligned across the adapter and gateway. Set minimum workers to zero for scale-to-zero when latency is acceptable. Budget roughly 12–24GB VRAM for Whisper-large Arabic plus the selected TTS runtime, subject to actual quantization and model measurements; no GPU is provisioned by this repository.

Future Kinglike integration uses only `KAY_VOICE_SERVICE_URL` and `KAY_VOICE_SERVICE_API_KEY`. Production call behavior is unchanged and browser `speechSynthesis` remains the fallback.

## TTS-only RunPod sample preparation

The optional `runpod/` adapter is not part of the core image contract and is
not deployed by this repository. It accepts only the three fixed Arabic texts
and profiles A (calm professional), B (warm conversational), and C (confident
supervisor). It uses `oddadmix/lahgtna-chatterbox-v1`, returns temporary
base64-encoded WAV bytes plus timing/device metadata, and rejects arbitrary
text. Configure `MAX_SAMPLE_TEXT_LENGTH=300` and
`MAX_GENERATION_SECONDS=30`; the future RunPod endpoint must use min workers 0,
max workers 1, one request at a time, and a 24GB-class GPU. See
`runpod/README.md` for exact settings. No endpoint or sample generation has
been performed.

The external GPU image uses `Dockerfile.runpod` and pinned
`requirements-runpod.txt` with the official base image
`runpod/pytorch:1.0.3-cu1281-torch260-ubuntu2404`. Package pins and the
Chatterbox API must be validated externally in that image before endpoint
creation. RunPod native endpoint authentication is used; its key is never
part of the job input.