---
name: Live camera source routing
description: Durable rules for safely rendering mixed live-camera URL types and allowlisting their browser permissions.
---

Camera URLs are not interchangeable: an HTML embed page belongs in an iframe, while an HLS manifest belongs in the HLS/video player. Keep browser permissions separate: embed origins use `frame-src`, HLS manifest and segment origins use exact `connect-src` entries, and `media-src` should only include real direct media origins.

**Why:** Treating an embed page as a video source caused the browser to reject the stream, while an HLS origin blocked by `connect-src` failed before the player could load its manifest.

**How to apply:** Route by URL shape before rendering; never add an embed provider to `media-src` merely to silence a playback error, and do not use wildcard domains when exact provider hosts are known.