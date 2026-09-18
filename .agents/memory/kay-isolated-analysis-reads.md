---
name: Kay isolated analysis reads
description: Why Kay mutation suites must keep their read and write connections on the same isolated test database.
---

Kay mutation-capable integration suites must route dedicated analysis reads to the same physically isolated test database after the destructive-test identity guard passes. Keep those reads inside an explicit read-only transaction.

**Why:** Using the production analysis connection during an isolated test makes synthetic fixtures invisible and can produce misleading scope failures even though writes remain isolated.

**How to apply:** Under the explicit test environment only, require the full test database preflight before selecting the test URL for analysis reads. Production must continue using the independently privileged analysis role with no writer-pool fallback.