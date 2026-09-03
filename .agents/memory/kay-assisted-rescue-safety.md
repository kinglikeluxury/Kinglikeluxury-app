---
name: Kay assisted rescue safety
description: Durable safety boundaries for admin-confirmed lead rescue and reversal.
---

Kay may recommend rescues in SHADOW and may execute one only through the standalone ASSISTED admin command. Evaluators and schedulers must never call ownership execution or undo. Controlled and full automation modes remain rejected.

**Why:** Lead ownership is a high-consequence CRM mutation. Confirmation must use live authoritative state, preserve promises through handoffs, reconcile Kay-owned work atomically, and retain a complete audit trail.

**How to apply:** Lock and revalidate the lead inside one transaction, require an eligible active target, record every accepted or rejected attempt, and provide a bounded transactional undo that returns `MANUAL_REVIEW_REQUIRED` whenever later work makes reversal unsafe. Keep production mode SHADOW unless the user explicitly authorizes otherwise.