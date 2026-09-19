---
name: Kay browser audio capture
description: Browser speech synthesis is audible but cannot be routed into the MediaRecorder audio graph.
---

Kay recording can mix microphone audio with a capturable WebRTC remote track through Web Audio, but browser `speechSynthesis` does not expose an audio stream. The virtual direct-caller path must therefore fail closed instead of marking a recording READY when Kay output was only synthesized locally.

**Why:** A recording that contains only the employee microphone is not a valid Kay call archive, even if the notice was audible to the employee.

**How to apply:** Treat the WebRTC remote Kay track as the source of Kay output for normal calls; keep direct virtual-caller archives FAILED/blocked until a real capturable Kay audio source exists.