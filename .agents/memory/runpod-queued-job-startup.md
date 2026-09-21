---
name: RunPod queued-job startup
description: Scale-to-zero RunPod behavior when a one-worker test remains queued without a worker.
---

A RunPod endpoint can accept a job into `IN_QUEUE` while its health response still reports zero initializing, ready, running, and idle workers. A 240-second queue wait is not evidence that the container or model started.

**Why:** a one-worker scale-up test remained queued for the full execution window with no worker lifecycle transition; sending a replacement would violate the one-job diagnostic boundary.

**How to apply:** poll both job status and health counters; if the single diagnostic job reaches the deadline while queued, cancel that exact job, set both worker limits to zero, and verify queue, in-progress jobs, and every worker counter are zero before finishing.