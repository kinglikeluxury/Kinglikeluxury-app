---
name: Kinglike Quality Score (KQS) engine
description: How the read-only lead/campaign quality scoring system is structured and why, for the Kinglike Luxury Real Estate marketing director feature.
---

KQS (0-100) is computed for every CRM lead and rolled up per-campaign to replace Meta's CPL/CTR as the primary signal for budget decisions.

**Why:** Meta metrics (CPL/CTR) only measure ad-click efficiency, not whether leads actually convert to sales. A campaign with cheap, high-volume leads can still be a poor investment if those leads never buy. The business explicitly required real CRM outcomes (replies, appointments, site visits, sales) to override Meta metrics in the Final Recommendation.

**How to apply:**
- KQS is entirely additive/read-only: it lives in its own `ai_kqs_lead_scores` table (owned by `server/kqsEngine.ts`) and a `kqs_json` column on `ai_director_snapshots`. It never writes to `crm_leads`, `meta_intelligence_*`, or any Meta API — only reads.
- Campaign-level score = 0.75 * CRM Score + 0.25 * Meta Score (CRM outcomes dominate). Meta Score is CPL/CTR percentile rank only; CRM Score blends Bayesian-smoothed conversion rate, profit-per-lead, funnel rate, and avg lead-level KQS.
- Group-quality scores (per lead_source/country+city/project/campaign/adset/ad) use Bayesian smoothing toward the global rate to avoid small-sample groups (e.g. 2 leads, 1 sale) looking artificially perfect.
- Recommendations engine (`buildRecommendations` in `aiMarketingDirectorService.ts`) pushes `category: "kqs"` entries whenever a campaign's KQS conflicts significantly with its Meta score (>25pt gap), or KQS is very low despite volume — this is intentionally separate from the older CPL/CTR-based recommendation logic rather than replacing it in place.
- Ad-set/ad-level KQS is intentionally lighter-weight (avg lead KQS + duplicate count only, no full Meta-vs-CRM split) due to sparser spend/CTR aggregation at that grain — a documented scope reduction, not a bug.
