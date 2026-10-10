---
name: Public Arabic font policy
description: Confirmed boundary for public-page Arabic typography after Production comparison.
---

Public application pages must retain the existing global Google Fonts imports and CSS stacks exactly as-is. Do not add local or external fonts, imitate device fallbacks, or change public font metrics. Tajawal Local is reserved for the Kinglike Family WhatsApp page and must be lifecycle-scoped there.

**Why:** Production and Preview computed styles and observed rendered fonts matched; the user accepted the result and explicitly rejected further public font changes.

**How to apply:** Treat `client/src/index.css` and public-page typography as frozen unless the user explicitly reopens this decision. Keep any local Tajawal declarations isolated to WhatsApp.