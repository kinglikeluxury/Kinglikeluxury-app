---
name: Kay fixed scope policy
description: Durable business rule for Kay's launch cohort, imported-date provenance, and excluded owners.
---

Kay uses one fixed business cohort anchored to the formally approved operational launch in `Asia/Tbilisi`. The cutoff is exactly three calendar months before that launch and never rolls forward; future Leads remain in scope rather than aging out.

**Why:** The business policy preserves historical ownership and prevents Kay from turning routine supervision or Rescue into a rolling rebalancing mechanism.

**How to apply:** All Kay modules must use the shared server-side scope decision. Direct CRM intake may use CRM creation time. Import-, migration-, or legacy-like records require a trusted original business timestamp with an approved provenance value; otherwise classify them as `LEGACY_DATE_UNCERTAIN` and fail closed. Admin/system/non-sales owners remain excluded independently of date.