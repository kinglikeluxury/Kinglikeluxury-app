---
name: Neon advisory locks
description: Why Kay background generators use expiring database leases instead of session advisory locks.
---

Use an atomically acquired, expiring row lease for a generator that runs through the Neon pooled connection.

**Why:** Session advisory locks can remain attached to an underlying pooled PostgreSQL session even after the application releases its logical client. A later run may then be skipped indefinitely.

**How to apply:** For bounded background generators, store an owner token and expiry in an existing control/settings table, acquire it with a conditional update, and release only when the token still matches.