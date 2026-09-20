# KAY unified one-turn RunPod Serverless preparation

This optional adapter is **not deployed** and does not start unless
`KAY_RUNPOD_AUTOSTART=true`. It accepts exactly two operations for the
Tarek-only one-turn test: one bounded base64 WAV STT request, or one bounded
arbitrary Arabic TTS request. Both require the configured
`KAY_VOICE_SERVICE_API_KEY`; model loading remains lazy.

Profile controls are intentionally distinct: A uses exaggeration `0.35`,
cfg_weight `0.55`, temperature `0.65`; B uses `0.55`, `0.45`, `0.80`; and C
uses `0.25`, `0.70`, `0.55`. These are style controls, not a claim of
different trained voices.

The adapter calls `app.providers.stt.LazyWhisperProvider` and
`app.providers.tts.LazyChatterboxProvider`. It has one lazy singleton per warm
worker and a process lock for one request at a time. On the deployed worker
only, the first request imports runtime packages and loads the model; imports
in the application/test environment do not load weights. An owned/licensed
male reference voice is required via `KAY_TTS_REFERENCE_AUDIO`.

The handler independently authenticates each job using `api_key` in the
validated internal input contract. The application-side HTTP adapter uses the
same configured secret as a Bearer token. Never log either form.

### Unified input shapes

STT:

```json
{
  "operation": "stt",
  "api_key": "<configured key>",
  "audio_base64": "<one PCM WAV turn>",
  "content_type": "audio/wav"
}
```

TTS:

```json
{
  "operation": "tts",
  "api_key": "<configured key>",
  "text": "<arbitrary Arabic reply>",
  "voice": "kay_male",
  "language": "ar"
}
```

## Exact future endpoint settings

Create only after explicit approval:

* Image: build `Dockerfile.runpod` from the repository
* GPU: 24 GB class
* Minimum workers: `0`
* Maximum workers: `1`
* Maximum concurrent requests per worker: `1`
* Scale-to-zero: enabled
* `KAY_RUNPOD_AUTOSTART=true`
* `KAY_TTS_MODEL=oddadmix/lahgtna-chatterbox-v1`
* `KAY_ONE_TURN_MAX_AUDIO_DURATION_SECONDS=15`
* `KAY_ONE_TURN_MAX_TEXT_CHARS=4000`
* `MAX_GENERATION_SECONDS=30`
* `KAY_TTS_DEVICE=cuda`
* `KAY_TTS_MODEL_REVISION=6b37e50d1952f07306dc9ff3f3d4ff4ddaf32541`
* `KAY_TTS_RUNTIME_REVISION=433cb74200b55457bffa8ee6965a02ecab546a1c`
* `KAY_TTS_REFERENCE_AUDIO=/service/assets/internal/kay-syrian-reference.wav`
* `HF_HOME=/runpod-volume/huggingface`
* Endpoint execution timeout: hard RunPod boundary of 300s initially
  (`MAX_GENERATION_SECONDS` plus cold-start allowance); revise after measurements
* Maximum execution/cost control: 300s hard maximum, no autoscaling above one worker

Source provenance: Hugging Face TTS model
[`oddadmix/lahgtna-chatterbox-v1`](https://huggingface.co/oddadmix/lahgtna-chatterbox-v1),
model revision `6b37e50d1952f07306dc9ff3f3d4ff4ddaf32541`; runtime source is
[`Oddadmix/lahgtna-chatterbox`](https://github.com/Oddadmix/lahgtna-chatterbox)
at commit `433cb74200b55457bffa8ee6965a02ecab546a1c`. The official Oddadmix
README maps Syrian dialect synthesis to Chatterbox `language_id="ko"`.

The Python `MAX_GENERATION_SECONDS` check is a soft response-time violation
only. It cannot cancel an already-running blocking CUDA kernel; RunPod's hard
execution timeout and container termination are the cost boundary. Configure
that platform timeout to the cold-start allowance plus the 30-second generation
budget (300s initially), never claim Python cancellation, and revise after
measurements.

Mount a persistent network volume for the Hugging Face cache and a separate
read-only reference-audio mount. Do not persist request audio or generated
samples. The Python deadline covers provider acquisition and awaits, but a
blocking CUDA kernel cannot be reliably cancelled by Python; the RunPod
execution timeout/container termination is the final safety boundary.

Do not create the endpoint, spend money, download weights in Replit, or
generate samples as part of preparation. The pinned runtime package versions
and image must be validated externally in the official base image before
endpoint creation. Measure cold start, model-load time, generation time, VRAM,
and cost only in the separately approved deployment.