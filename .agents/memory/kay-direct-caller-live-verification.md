---
name: Kay direct caller live verification
description: Records the user-confirmed live behavior of the single-browser direct Kay call path.
---

The single-browser direct Kay caller was confirmed live: the in-app ring appeared, the user answered manually, completed the microphone and mute controls, heard the local Arabic browser voice, and ended the call successfully.

**Why:** This is runtime behavior confirmed by the user and database lifecycle timestamps; it cannot be established by reading the implementation alone.

**How to apply:** Treat the direct browser-only path as live-verified. Preserve its one-call gating, global incoming overlay, local speech fallback, media cleanup, and terminal persistence when changing call behavior.