---
name: Neon advisory locks
description: Why Kay background generators use expiring database leases instead of session advisory locks.
---

Use an atomically acquired, expiring row lease for a generator that runs through the Neon pooled connection. Lease ownership must also fence every side-effecting write.

**Why:** Session advisory locks can remain attached to an underlying pooled PostgreSQL session even after the application releases its logical client. Heartbeats alone do not stop a worker that loses its lease between a check and a write.

**How to apply:** Store an owner token and expiry in a control/settings row. Before each side effect, lock that row and verify the token and unexpired lease in the same transaction as the write. Release only when the token still matches.