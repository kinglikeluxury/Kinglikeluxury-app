---
name: Meta WhatsApp review prototype
description: User-approved configuration and safety limits for the admin-only WhatsApp App Review prototype.
---

For the admin WhatsApp App Review prototype, represent Embedded Signup Builder ES Version v4 through the supplied config ID and pass Session Info Version 3 exactly. Do not choose another Meta/Graph API version or add other configuration assumptions. Keep the feature default-off and admin-click-only; consume only allowlisted signup session events, keep any returned WABA/phone IDs temporary in memory, and never persist or log authorization codes or tokens. Preserve the existing mock monitoring UI and do not extend this prototype without explicit approval.

**Why:** The user explicitly supplied the Builder values and narrowed the work to an App Review prototype, rejecting unspecified Meta configuration and broader integration changes.

**How to apply:** Re-read this constraint before changing the prototype's signup options, status handling, or integration scope; treat future production connection work as requiring fresh explicit approval.