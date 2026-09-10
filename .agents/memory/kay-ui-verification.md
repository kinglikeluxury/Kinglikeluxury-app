---
name: Kay UI verification boundaries
description: Lessons from redesigning Kay while its data routes remain frozen.
---

Treat unavailable Kay data as an unknown state, never as evidence that the
employee has no work. Preserve separate loading, failure, and successful-empty
states during future visual refactors.

**Why:** During the premium redesign, frozen read endpoints made attractive
“all clear” defaults misleading, and counting historical completions as today's
work produced incorrect summaries despite valid API responses.

**How to apply:** Test unavailable-query and historical-date inputs separately.
An unauthenticated screenshot showing the global loading screen is not proof
that the authenticated Kay workspace rendered correctly.