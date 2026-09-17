---
name: Kay gate changes require isolated tasks
description: Why high-safety Kay authorization changes must be implemented in an isolated Replit Task before applying to main.
---

Implement high-safety Kay authorization changes inside an isolated Replit Task, then apply the verified task result to main.

**Why:** Repeated direct attempts to add the internal-write gate in the main workspace were automatically restored between tool calls, including newly added files. The same changes persisted normally in an isolated task.

**How to apply:** For future Kay authorization-boundary changes, use an isolated task, complete tests and live least-privilege checks there, and keep activation as a separate post-apply operation.