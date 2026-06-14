---
name: AI Lead Scoring System
description: How the CRM AI scoring system works — columns, service, hooks, and notification pattern.
---

## Columns (raw SQL, not in Drizzle schema)
Added inside `ensureWaQualTables()` in `server/db.ts`:
- `ai_score INTEGER` — 0-100 numeric score
- `ai_score_category TEXT` — 'HOT' | 'WARM' | 'COLD'
- `ai_score_reason TEXT` — bullet-point explanation
- `ai_score_updated_at TIMESTAMPTZ`

Frontend accesses via `(lead as any).ai_score_category` etc. (Drizzle SELECT * returns all DB columns even if not in schema).

## Scoring service
`server/aiLeadScoringService.ts` — pure rule-based (no OpenAI):
- Budget: 30 pts max | Timeline: 20 | Country: 15 | Goal: 15 | Phone: 5 | WA engagement: 10 | Status modifier: -10 to +5 | AI data bonus: 5
- HOT ≥80, WARM ≥50, COLD <50

**Why:** OpenAI calls would be expensive and add latency. Rule-based is reliable, fast, and transparent.

## Trigger pattern
Fire-and-forget using dynamic import (matches existing codebase pattern):
- On lead CREATE: `setTimeout(() => import("./aiLeadScoringService").then(...), 500)`
- On lead UPDATE: immediate `import("./aiLeadScoringService").then(...)`
- Manual: `POST /api/admin/crm/leads/:id/rescore` (admin only)

## HOT notification
Only fires when score CROSSES INTO HOT (previous category !== 'HOT'). Inserts into `user_notifications` for assigned agent + all admins.

## Filter support
`getCrmLeads` in `database-storage.ts` accepts `aiScore?: string` and uses `sql\`ai_score_category = ${filters.aiScore}\`` (raw Drizzle sql template).

## Stats endpoint
Uses `drizzleSql\`ai_score_category = 'HOT'\`` as condition in existing `cnt()` helper — works because Drizzle WHERE accepts raw SQL fragments.
