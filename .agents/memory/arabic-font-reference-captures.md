---
name: Arabic font reference captures
description: Which stored mobile Arabic screenshots are valid baselines for font comparison.
---

The stored `preview-home-mobile-ar.png` capture is a splash screen, not the rendered Home route, so it must not be used for pixel-level typography comparison.

**Why:** Comparing a rendered route against that splash produces a large image difference unrelated to fonts.

**How to apply:** Wait for the route's Arabic content to appear before capturing a baseline, and compare Home only with a rendered Home image at the same viewport and state.