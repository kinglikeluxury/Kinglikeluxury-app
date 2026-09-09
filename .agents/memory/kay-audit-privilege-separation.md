---
name: Kay audit privilege separation
description: Durable privilege boundary for Kay authorization audit records.
---

Kay authorization audit must use a dedicated database login that can only
INSERT into a ledger owned by an independent NOLOGIN role. The serving
application must never provision, own, update, delete, truncate, or silently
replace records in that ledger; it must verify the privilege boundary and
append-only trigger before authorization can continue.

**Why:** An append-only trigger is not a meaningful control when the same
runtime credential owns the table or trigger function and can disable or
replace them.

**How to apply:** Provision the ledger and roles through an operator migration,
store the writer connection separately, and fail Kay closed when the credential,
trigger, non-ownership, or INSERT-only grants cannot be verified.