---
name: Kay metadata migration ownership
description: Ownership boundary for additive schema changes to Kay recording metadata
---

The Kay runtime writer can read and update recording metadata but cannot alter the recording table schema. Additive schema changes must use the dedicated migration-owner connection, while preserving the existing runtime grants.

**Why:** The recording metadata table is owned by a separate migration role; attempting an ALTER through the runtime writer or general database owner fails with PostgreSQL permission error 42501.

**How to apply:** For future additive Kay recording metadata fields, update the migration artifact and shared schema, then apply the change through the documented migration-owner path. Do not broaden runtime grants.