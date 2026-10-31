---
name: AI blog draft safety
description: User-approved constraints for the proposed Arabic property-market AI draft workflow.
---

The five editorial channels are Georgia, Turkey, Syria, Azerbaijan/Baku only, and Northern Cyprus. The user requires $0 additional cost: do not enable billing, auto-upgrade, paid fallback, or any provider call unless the user separately authorizes that exact activity. AI research, text generation, image generation, and scheduling remain inactive by default. Publishing is manual and must remain behind an explicit administrator action after review.

**Why:** The user requires factual, source-backed Arabic articles and rejects paid activity, automatic cost escalation, or automated publication without later approval. Free-tier eligibility and remaining account quota cannot be inferred from code. Production or ambiguous database writes must not be used to simulate test persistence.

**How to apply:** Keep provider adapters and scheduler startup fail-closed, require account-specific free-tier/billing/quota confirmation, and never fall back to paid providers. Run persistence and publish-flow integration tests only against a dedicated non-production database, with fixtures removed afterward.
