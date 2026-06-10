# AI WhatsApp Lead Qualification — Planning & Design Document

**Status:** Design only. No code modified. No schema changed.
**Date:** June 2026
**Author:** Kinglike Luxury AI Planning

---

## 1. Full Architecture Proposal

### Overview

When a new Meta lead arrives in the CRM, an AI agent (named "خالد" — consistent with existing `whatsappAiService`) contacts the lead via the production Meta Cloud API and walks them through a structured 6-question qualification flow. All answers are stored in the CRM. After completion the agent scores the lead, generates a qualification summary, notifies the assigned consultant, and sends the lead a thank-you message.

### Component Map

```
┌──────────────────────────────────────────────────────────────────┐
│                     META LEADS PIPELINE                          │
│  Facebook Ad → Meta Webhook → metaLeadsService → crm_leads      │
└─────────────────────────────┬────────────────────────────────────┘
                              │  new lead inserted
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│               AI WHATSAPP QUALIFICATION ENGINE                   │
│                                                                  │
│  waQualService.ts          (new)                                 │
│  ├── triggerQualification(leadId)  ← called after lead insert    │
│  ├── handleInboundReply(waMessageId, body) ← webhook handler     │
│  ├── advanceStateMachine(sessionId, userInput)                   │
│  ├── scoreLeadFromAnswers(answers)                               │
│  ├── generateSummary(answers, score)                             │
│  └── notifyConsultant(leadId, summary)                           │
│                                                                  │
│  Provider: sendMetaWhatsApp() ← existing metaWhatsAppService.ts  │
│  Phone ID: 1110445448828325                                      │
│  Token:    WHATSAPP_ACCESS_TOKEN                                 │
└─────────────────────────────┬────────────────────────────────────┘
                              │  writes
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    DATABASE (PostgreSQL / Neon)                   │
│                                                                  │
│  wa_qual_sessions     — one row per lead, holds state            │
│  wa_qual_answers      — one row per question per session         │
│  wa_qual_summaries    — generated summary + score                │
└──────────────────────────────────────────────────────────────────┘
                              │  updates
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                         CRM                                      │
│  crm_leads.qualification_score    HOT / WARM / STANDARD / VIP   │
│  crm_leads.qualification_status   pending / in_progress / done  │
│  crm_leads.qualification_summary  text blob from AI             │
└──────────────────────────────────────────────────────────────────┘
                              │  notify
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│              CONSULTANT NOTIFICATION                             │
│  Internal: CRM notification / push                              │
│  WhatsApp: sendMetaWhatsApp(consultantPhone, summary)            │
└──────────────────────────────────────────────────────────────────┘
```

### Key Design Principles

- **Non-blocking:** `triggerQualification()` is fire-and-forget. Lead insert completes immediately.
- **Idempotent:** If a session already exists for a `lead_id`, the trigger is a no-op.
- **Stateless service:** All state lives in `wa_qual_sessions`. The engine can restart without losing progress.
- **Reuses existing sender:** No new Meta API integration. Uses `sendMetaWhatsApp()` already live and tested.
- **Inbound handling via webhook:** Meta webhook (`/api/webhooks/meta`) receives reply events and routes them through the state machine.

---

## 2. WhatsApp Conversation Flow Diagram

```
AI sends greeting
        │
        ▼
┌──────────────────────────────────────────────────┐
│  GREETING                                        │
│  "مرحباً [name]! أنا خالد من Kinglike Luxury…   │
│   أود أن أطرح عليك بعض الأسئلة السريعة          │
│   لأقدم لك أفضل الفرص العقارية المناسبة."        │
│  "يمكنك الرد برقم الخيار أو نصه مباشرة."         │
└──────────────────┬───────────────────────────────┘
                   │  any reply (or auto-advance after 2s)
                   ▼
┌──────────────────────────────────────────────────┐
│  Q1 — PURCHASE GOAL                              │
│  ما هو هدفك من الشراء؟                           │
│  1. استثمار                                      │
│  2. سكن                                          │
│  3. استثمار وسكن معاً                            │
└──────────────────┬───────────────────────────────┘
                   │  answer stored
                   ▼
┌──────────────────────────────────────────────────┐
│  Q2 — CITY                                       │
│  أي مدينة تفضل؟                                  │
│  1. باتومي  2. تبليسي  3. شمال قبرص              │
│  4. إسطنبول  5. أخرى                             │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│  Q3 — BUDGET                                     │
│  ما هو ميزانيتك التقريبية؟                       │
│  1. 50k–80k USD    2. 80k–100k USD               │
│  3. 100k–150k USD  4. 150k–250k USD              │
│  5. أكثر من 250k USD                             │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│  Q4 — SPECIFIC PROJECT?                          │
│  هل أنت مهتم بمشروع محدد؟                       │
│  1. نعم  2. لا  3. أريد توصيات                  │
└──────┬───────────────────────────────────────────┘
       │ "نعم"                  │ "لا" / "توصيات"
       ▼                        ▼
┌──────────────┐         ┌──────────────────────────┐
│ Q4b —        │         │  Skip to Q5              │
│ Project name │         │  (store null / pref)     │
│ free text    │         └──────────────────────────┘
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│  Q5 — VISIT TIMELINE                             │
│  هل تخطط لزيارة قريباً؟                          │
│  1. خلال شهر  2. خلال 3 أشهر                    │
│  3. لاحقاً    4. لم أقرر بعد                    │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│  Q6 — PROPERTY TYPE                              │
│  نوع العقار المفضل؟                              │
│  1. جاهز للتسليم                                 │
│  2. قيد الإنشاء                                  │
│  3. لا تفضيل                                     │
└──────────────────┬───────────────────────────────┘
                   │  all answers collected
                   ▼
        ┌──────────────────────┐
        │  SCORE + SUMMARY     │
        │  (internal, no send) │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  THANK YOU MESSAGE   │
        │  (sent to lead)      │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  NOTIFY CONSULTANT   │
        │  (internal WA / CRM) │
        └──────────┬───────────┘
                   │
                   ▼
              HANDOFF DONE
         crm_leads status → qualified
```

---

## 3. Required Database Fields (Proposal Only)

> **No migrations.** This section describes what will be added when implementation begins.

### New Table: `wa_qual_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `lead_id` | integer FK → `crm_leads.id` | UNIQUE — one session per lead |
| `status` | text | `pending` / `greeting_sent` / `q1`–`q6` / `completed` / `failed` / `timed_out` |
| `current_question` | integer | 1–6, or 0 (greeting), 7 (done) |
| `last_message_at` | timestamptz | updated on every send/receive |
| `last_outbound_wamid` | text | Meta message ID of last sent message |
| `retry_count` | integer | number of unanswered follow-up nudges sent |
| `created_at` | timestamptz | |
| `completed_at` | timestamptz | |

### New Table: `wa_qual_answers`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `session_id` | integer FK → `wa_qual_sessions.id` | |
| `question_number` | integer | 1–6 |
| `question_key` | text | `goal` / `city` / `budget` / `project` / `timeline` / `property_type` |
| `raw_input` | text | what the lead typed |
| `normalised_value` | text | standardised enum value after parsing |
| `received_at` | timestamptz | |

### New Table: `wa_qual_summaries`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `session_id` | integer FK → `wa_qual_sessions.id` | UNIQUE |
| `lead_score` | text | `VIP` / `HOT` / `WARM` / `STANDARD` |
| `score_reason` | text | human-readable reason |
| `summary_text` | text | full AI-generated summary sent to consultant |
| `generated_at` | timestamptz | |

### Additions to Existing `crm_leads` Table

| Column | Type | Notes |
|---|---|---|
| `qualification_status` | text | `none` / `in_progress` / `completed` / `failed` |
| `qualification_score` | text | `VIP` / `HOT` / `WARM` / `STANDARD` / null |
| `qualification_summary` | text | short summary for CRM list view |
| `qualified_at` | timestamptz | |

---

## 4. CRM Integration Plan

### Trigger Point

`metaLeadsService.ts` — after a new `crm_leads` row is inserted successfully:

```typescript
// PROPOSED addition (not yet in code):
await waQualService.triggerQualification(crmLead.id);
// fire-and-forget, never throws, never delays the webhook response
```

### CRM Lead Card

The lead detail page (`crm-lead-detail.tsx`) will gain:
- A **Qualification badge**: pill showing `VIP` / `HOT` / `WARM` / `STANDARD` / `Pending`
- A **Qualification tab**: shows all 6 answers, score, summary, and the full message thread
- A **"Restart Qualification"** button for admins (only if status = failed / timed_out)

### CRM List View

`crm-leads.tsx` filter sidebar will gain:
- Filter by `qualification_score`
- Visual badge on each lead card showing score tier with brand colours

### Admin Notification

When qualification completes, the assigned consultant receives:
1. An in-app CRM notification (existing push system)
2. A WhatsApp message via `sendMetaWhatsApp(consultantPhone, summaryText)`

---

## 5. AI State Machine Design

### States

```
IDLE
  → on triggerQualification()
GREETING_QUEUED
  → on message sent
GREETING_SENT
  → on inbound reply (any content)
Q1_SENT → Q1_ANSWERED
Q2_SENT → Q2_ANSWERED
Q3_SENT → Q3_ANSWERED
Q4_SENT → Q4_ANSWERED
  └─ if answer = "yes" → Q4B_SENT → Q4B_ANSWERED
Q5_SENT → Q5_ANSWERED
Q6_SENT → Q6_ANSWERED
  → SCORING
  → THANKYOU_SENT
  → CONSULTANT_NOTIFIED
COMPLETED
  (terminal)

FAILED          (terminal — hard error, e.g. Meta API rejects number)
TIMED_OUT       (terminal — no reply after max_wait × max_retries)
OPT_OUT         (terminal — lead replies STOP / لا أريد / إلغاء)
```

### Transition Logic

```
handleInboundReply(waMessageId, fromNumber, bodyText):
  1. Lookup session WHERE lead.phone = fromNumber AND status NOT IN (COMPLETED, FAILED, OPT_OUT)
  2. If none → ignore (not a qualification conversation)
  3. Check opt-out keywords → transition to OPT_OUT, send confirmation, stop
  4. Parse bodyText against current question's expected values
     a. Valid option  → store answer, advance to next state, send next question
     b. Invalid input → send clarification prompt (counts as 1 retry for this question)
     c. Free text (Q4b) → store as-is, advance
  5. If current_question = 6 and answered → trigger SCORING → THANKYOU_SENT → CONSULTANT_NOTIFIED → COMPLETED
```

### Input Normalisation

Leads may reply with Arabic numerals, English numerals, or free text. The parser:
- Strips whitespace and punctuation
- Maps `١٢٣٤٥` → `12345` (Arabic-Indic digits)
- Matches numbered options (1–5) OR keyword match (partial, case-insensitive)
- Falls back to "clarification request" after 2 unrecognised replies per question

---

## 6. Lead Scoring Design

### Budget-Driven Score

| Budget Answer | Score |
|---|---|
| More than 250k USD | **VIP** |
| 150k – 250k USD | **HOT** |
| 100k – 150k USD | **WARM** |
| 80k – 100k USD | **WARM** |
| 50k – 80k USD | **STANDARD** |

### Multipliers (upgrade score one tier)

| Condition | Effect |
|---|---|
| Visit timeline = "Within 1 month" | +1 tier |
| Goal = "Investment & Residence" (highest intent) | +1 tier, max VIP |
| Interested in specific project (Q4 = "Yes") | +0.5 tier (tiebreaker) |

Score is capped at VIP. Multipliers are advisory — the final tier is still human-overridable in the CRM.

### Score Reason Text (examples)

- `VIP: Budget >250k USD + planning to visit within 1 month`
- `HOT: Budget 150k–250k USD + investment & residence goal`
- `WARM: Budget 100k–150k USD, no visit planned yet`

---

## 7. Human Handoff Design

### Handoff Trigger

Immediately after `THANKYOU_SENT` state transition:

1. `wa_qual_summaries` row is written with full score and summary text.
2. `crm_leads.qualification_score` and `crm_leads.qualification_status = 'completed'` are updated.
3. Assigned consultant is identified from `crm_leads.assigned_to` (FK → `users`).
4. Consultant receives:
   - **In-app push:** "New qualified lead: [name] — Score: VIP"
   - **WhatsApp (if consultant has phone):** Formatted summary message

### Consultant Summary Message Format

```
🏆 New Qualified Lead — Kinglike Luxury CRM

👤 Name: [lead name]
📞 Phone: [phone]
🏷️ Score: VIP / HOT / WARM / STANDARD

📋 Qualification Answers:
• Goal: Investment & Residence
• City: Batumi
• Budget: More than 250k USD
• Project: Silk Towers
• Visit: Within 1 month
• Property type: Ready property

🤖 AI Summary:
[2–3 sentence summary]

🔗 CRM: https://kinglikeluxury.app/admin/crm/leads/[id]
```

### Handoff Rules

- AI stops sending messages the moment `COMPLETED` state is set.
- Any further inbound message from the lead after COMPLETED is silently ignored by the AI.
- The lead's next contact is purely human (consultant via native WhatsApp or CRM).
- CRM shows "Handed off to: [consultant name]" badge on the lead card.

---

## 8. Failure and Timeout Handling

### Timeout Policy

| Wait Window | Action |
|---|---|
| 24h with no reply | Send one nudge: "هل ما زلت مهتماً؟ يمكنك الرد في أي وقت." |
| 48h total with no reply | Send final nudge (max 1): "يسعدنا مساعدتك لاحقاً عندما تكون مستعداً." |
| 72h total with no reply | Set status = `TIMED_OUT`, notify consultant |

Max 2 nudge messages per session. No further sends after timeout.

### Invalid Input Handling

- Up to **2 clarification attempts** per question.
- After 2 unrecognised replies: skip question (store null), advance to next question.
- Log the raw inputs for manual review.

### Hard Failures

| Failure | Handling |
|---|---|
| Meta API returns non-200 | Log error, retry once after 60s, then set `FAILED` |
| Lead phone is not on WhatsApp (Meta error 131030) | Set `FAILED` immediately, no retry |
| Lead replies opt-out keyword | Set `OPT_OUT`, send: "تم إلغاء التسجيل. لن نتواصل معك مجدداً." |
| Lead has no phone number | Skip qualification entirely (no session created) |
| Database write fails | Rollback, log, retry once |

### Opt-Out Keywords (multilingual)

```
STOP, stop, لا أريد, إلغاء, اخرج, وقف, no more, unsubscribe, بلاش
```

---

## 9. Estimated Implementation Phases

### Phase 1 — Outbound Only (AI sends questions, does not process replies)
**Scope:** `triggerQualification()` fires after lead insert. AI sends all 6 questions sequentially with a delay between each. Answers are not collected — this is a broadcast test.
**Estimated effort:** 2–3 days
**Risk:** Low — uses existing `sendMetaWhatsApp()`, no webhook changes

---

### Phase 2 — Inbound Reply Handling (full interactive flow)
**Scope:** Meta webhook extended to route inbound WhatsApp messages to `handleInboundReply()`. Full state machine active. Answers stored in `wa_qual_answers`.
**Estimated effort:** 4–5 days
**Dependencies:** Meta webhook must be configured to deliver inbound messages (currently set up for lead forms only)
**Risk:** Medium — requires webhook update and Meta app permissions for inbound messages

---

### Phase 3 — Scoring, Summary, and Consultant Notification
**Scope:** `scoreLeadFromAnswers()` and `generateSummary()` active. CRM lead card shows score badge. Consultant notified via push + WhatsApp.
**Estimated effort:** 2–3 days
**Risk:** Low

---

### Phase 4 — CRM Qualification UI
**Scope:** Qualification tab on lead detail page. Filter by score in lead list. Restart qualification button. Admin override of score.
**Estimated effort:** 3–4 days
**Risk:** Low — frontend only

---

### Phase 5 — Timeout & Failure Recovery
**Scope:** Cron-based nudge scheduler. Opt-out detection. Failed session admin view and manual restart.
**Estimated effort:** 2 days
**Risk:** Low

---

### Total Estimated Timeline

| Phase | Days |
|---|---|
| Phase 1 | 2–3 |
| Phase 2 | 4–5 |
| Phase 3 | 2–3 |
| Phase 4 | 3–4 |
| Phase 5 | 2 |
| **Total** | **13–17 days** |

---

## Appendix A — New Files Required (Implementation Phase)

```
server/waQualService.ts             — core state machine + scoring + summary
server/waQualScheduler.ts           — timeout nudge cron
server/waQualRoutes.ts              — admin API endpoints (restart, override)
shared/schema additions             — 3 new tables + 4 new crm_leads columns
client/.../wa-qualification-tab.tsx — CRM lead detail tab
client/.../wa-qual-badge.tsx        — reusable score badge component
```

## Appendix B — Existing Files Touched (Implementation Phase)

```
server/metaLeadsService.ts          — add triggerQualification() call after insert
server/routes.ts (webhook handler)  — route inbound WA messages to handleInboundReply()
client/.../crm-lead-detail.tsx      — add Qualification tab
client/.../crm-leads.tsx            — add score filter + badge
server/index.ts                     — register waQualRoutes, start waQualScheduler
```

## Appendix C — Existing Files NOT Touched

```
server/services/metaWhatsAppService.ts   — reused as-is
server/whatsappNotificationService.ts    — reused as-is
server/whatsappAiService.ts              — independent, not modified
server/metaLeadsService.ts               — modified only at trigger point
server/emailNurturingService.ts          — untouched
server/silkSubmissionAdapter.ts          — untouched
server/routes.ts (auth/OTP)             — untouched
All Twilio SMS logic                     — untouched
```

---

*This document is planning only. No production code, database schema, or environment variables have been modified.*
