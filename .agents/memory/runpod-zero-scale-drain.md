---
name: RunPod zero-scale drain
description: Operational verification needed after lowering a serverless endpoint to zero workers.
---

Setting `workersMax=0` does not necessarily make the active worker count zero immediately; the endpoint health response can briefly show a running worker while the completed request drains.

**Why:** declaring zero-scale from endpoint configuration alone can leave a live worker running after a test, which violates minimum-cost test boundaries.

**How to apply:** set `workersMax=0` immediately after the job finishes or fails, then poll the endpoint health workers counters until idle, initializing, ready, running, throttled, and unhealthy are all zero.