---
name: Kay Vite audio fixture
description: Vite can bundle a tracked WAV outside client through a relative asset import, while Node tsx tests cannot import that binary directly.
---

For Kay browser audio fixtures, import the tracked WAV from the client component so Vite emits a hashed browser asset. Keep Node tests independent of that component import by testing pure call helpers from a small shared module and source-checking the component.

**Why:** The production bundler resolves browser asset imports, but the Node test loader treats the WAV as an unsupported module and fails before tests run.

**How to apply:** Preserve the fixture import in the browser component; do not make targeted Node tests import that component at runtime.