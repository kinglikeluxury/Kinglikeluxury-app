---
name: WhatsApp monitoring preservation
description: Preserve the monitoring UI across mainline updates while keeping mock, reviewer, test WABA, and real employee data separate.
---

Keep the employee conversation archive mock-only until a separately reviewed, consent-gated Cloud API ingestion path exists. Treat the Meta Embedded Signup prototype, reviewer access, Test WABA traffic, and employee conversations as separate capabilities. When restoring this work after camera, map, or other production updates, start from current production main and explicitly verify the monitoring route and its source files; do not assume prior feature branches were included.

**Why:** The user has repeatedly noted that WhatsApp work disappeared from the production site after unrelated updates, and production main did not contain the monitoring route.

**How to apply:** Rebase or selectively port WhatsApp changes onto the latest main for each production update. Never transfer reviewer credentials, Test WABA traffic, or employee data into production as part of UI restoration.
