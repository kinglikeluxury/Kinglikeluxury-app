---
name: PostgreSQL non-throwing timestamp validation
description: Correct input-validation signature for safely casting timestamps stored as JSON text.
---

Validate untrusted stored timestamp text with `pg_input_is_valid(value, 'timestamptz')` before applying the `timestamptz` cast. Do not pass a `regtype`; the supported PostgreSQL signature in the Kay Neon environment accepts the target type name as text.

**Why:** A date-shaped regular expression still admits impossible timestamps, while the `regtype` form fails function resolution instead of validating safely.

**How to apply:** Use this pattern for lease or runtime-state timestamps read from JSON before a cast, and keep invalid values on an explicit expired/fail-closed branch.