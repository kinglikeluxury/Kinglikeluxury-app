---
name: Kay isolated Neon test transport
description: The WebSocket constructor required when Kay tests connect to isolated Neon databases outside the app bootstrap.
---

Set `neonConfig.webSocketConstructor = ws` before the first `@neondatabase/serverless` Pool connection in standalone Kay test processes.

**Why:** The application bootstrap normally configures the `ws` constructor globally. A standalone isolated test that bypasses that bootstrap can fail to connect before issuing any SQL, even with a valid, safely isolated test URL.

**How to apply:** In standalone test runners, import `ws` and configure Neon before constructing or using Kay analysis/internal pools. Keep the existing dedicated-database preflight and never fall back to production credentials.
