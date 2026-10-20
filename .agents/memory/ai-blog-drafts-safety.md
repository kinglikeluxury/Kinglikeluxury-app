---
name: AI blog draft safety
description: User-approved constraints for the proposed Arabic property-market AI draft workflow.
---

The five editorial channels are Georgia, Turkey, Syria, Azerbaijan/Baku only, and Northern Cyprus. AI research, text generation, image generation, and scheduling must remain inactive until the user separately approves costs and service activation. Publishing is manual and must remain behind an explicit administrator action after review.

**Why:** The user requires factual, source-backed Arabic articles and rejects paid activity or automated publication without later approval. Production or ambiguous database writes must not be used to simulate test persistence.

**How to apply:** Keep provider adapters and scheduler startup fail-closed; run persistence and publish-flow integration tests only against a dedicated non-production database, with fixtures removed afterward.
