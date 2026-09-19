---
name: Kay recording foundation
description: Durable boundary for Kay recording metadata, storage, notice gating, and admin authorization.
---

Kay recording work must keep audio objects outside PostgreSQL and store only lifecycle metadata in the Kay internal database. Private provider configuration is optional during foundation work; playback and upload must fail closed when it is absent. The informational notice is not a consent flow, but a failed notice must prevent the future CRM discussion gate from opening. Employee stop/delete controls are not part of the employee experience.

**Why:** The recording foundation is administrative and preparatory only; introducing public object routes, CRM writes, employee controls, or real calls would widen the approved scope.

**How to apply:** Keep future upload/finalization work behind the provider-neutral storage abstraction, live Kay admin authorization, short-lived signed URLs, and the notice gate. Apply metadata migration only to `KAY_INTERNAL_DATABASE_URL`.