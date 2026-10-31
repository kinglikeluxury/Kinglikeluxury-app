---
name: Read-only browser diagnostics
description: Running Playwright browser checks in the Replit container without changing dependencies
---

When a read-only browser diagnostic cannot launch Playwright's bundled Chromium because a system shared library is missing, use the system Chromium found through `which chromium` as the explicit Playwright executable path.

**Why:** The container can provide a usable Nix Chromium binary even when the Playwright browser bundle is missing runtime libraries. Installing packages or changing the project is unnecessary and violates the scope of a read-only diagnostic.

**How to apply:** Resolve the executable at runtime, launch with the existing no-sandbox/container-safe flags, and keep the diagnostic temporary and outside the workspace.