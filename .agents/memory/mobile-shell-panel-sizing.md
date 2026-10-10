---
name: Mobile shell panel sizing
description: Layout rule for mobile pages that contain independently scrolling panels and a fixed application shell.
---

When a mobile page no longer reserves space for a fixed bottom shell, constrain the page to the viewport and apply `min-height: 0` through every nested flex column that should shrink. Keep scrolling on the message/list region, not on the page, so a composer remains fully visible.

**Why:** Removing a fixed bottom navigation can expose an older height calculation, while flex items with the default automatic minimum height expand from their content and push the composer below the viewport.

**How to apply:** Use a viewport-bounded page container, a flex column that gives the workspace the remaining height, and `min-height: 0` on the workspace and panel wrappers. Validate at the narrowest mobile width and after long-content scrolling.