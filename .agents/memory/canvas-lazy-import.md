---
name: canvas native module — lazy import pattern
description: The canvas package requires a compiled native binary (.node file). A static import crashes the server if the binary is missing; use a lazy require with try-catch.
---

## Rule
Never use a top-level static `import { createCanvas, loadImage } from 'canvas'` in server code. Use a lazy dynamic require wrapped in try-catch.

**Why:** `canvas` is a native Node.js addon. If the compiled `.node` binary (`build/Release/canvas.node`) is missing (e.g., after a partial dependency install), a static import crashes the entire server process at startup before any routes are registered.

**How to apply:**
```typescript
let canvasModule: any = null;
try {
  canvasModule = require('canvas');
} catch (_e) {
  console.warn('[imageProcessing] canvas native module not available — watermarking disabled');
}

export async function addWatermark(imageDataUrl: string): Promise<string> {
  if (!canvasModule) return imageDataUrl;  // graceful no-op
  const { createCanvas, loadImage } = canvasModule;
  // ... rest of implementation
}
```

**Relevant file:** `server/utils/imageProcessing.ts`
