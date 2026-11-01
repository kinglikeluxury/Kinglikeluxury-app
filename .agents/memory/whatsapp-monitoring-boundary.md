---
name: WhatsApp monitoring boundary
description: Keep employee conversation mocks isolated from the Meta review test WABA and live WhatsApp systems.
---

The employee monitoring archive is mock-only unless a separately approved production integration is delivered. Meta reviewers must be limited to the mock workspace and explicitly enabled Test-WABA endpoints; they must never inherit access to employee conversation APIs or production numbers. Reviewer identity must be deployment-configured with a password hash so it remains stable across restarts; do not store reviewer credentials in source or Neon.

**Why:** The review experience must not expose employee/customer conversations or production WhatsApp data, and a process-memory account cannot reliably preserve a review login across restarts.

**How to apply:** Keep test sends disabled by default, maintain exact reviewer API allowlists, keep mock and test-WABA event stores separate, and verify any activation only in an isolated staging deployment.
