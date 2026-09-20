---
name: Kay one-turn gateway
description: The Tarek voice test is a single-use, authenticated, notice-gated pipeline with no CRM/customer context.
---

The Kay Tarek voice test may proceed only when the direct ADMIN_TEST call is active, the recording notice is recorded as played, the request is bound to the exact authenticated answering connection, and a database-backed unique reservation succeeds. Failed processing is terminal; retries are unavailable.

**Why:** In-memory or UI-only guards could be bypassed or raced, while the test must remain exactly one turn and must not expand into employee/customer automation.

**How to apply:** Keep provider calls behind the same-origin authenticated gateway, pass only explicit internal test context to read-only reasoning, and leave automation disabled unless a future provider deployment test explicitly enables the approved environment.