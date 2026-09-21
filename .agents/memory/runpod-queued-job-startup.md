---
name: RunPod queued-job startup
description: Scale-to-zero RunPod behavior when a one-worker test remains queued without a worker.
---

A RunPod endpoint can accept a job into `IN_QUEUE` while its health response still reports zero initializing, ready, running, and idle workers. After a provisioning/configuration release, the job gateway can also reject the first submission with HTTP 409 and no job ID. A queue wait or 409 is not evidence that the container or model started.

**Why:** a one-worker scale-up test remained queued for the full execution window with no worker lifecycle transition, and a later narrowed-GPU release returned 409 before accepting a job; sending a replacement would violate the one-job diagnostic boundary.

**How to apply:** poll both job status and health counters; if submission returns 409 without a job ID, do not retry. If a single diagnostic job reaches the deadline while queued, cancel that exact job, set both worker limits to zero, and verify queue, in-progress jobs, and every worker counter are zero before finishing.