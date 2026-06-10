# AI WhatsApp Lead Qualification — Revised Implementation Plan

**Status:** Design only. No code modified. No schema changed.
**Version:** 2.1 — Revised June 2026
**Author:** Kinglike Luxury AI Planning

> **Revision notes (v2.1 vs v2.0):**
> - **Post-Completion Incoming Messages Rule added:** After COMPLETED, AI stops replying but all inbound messages are still logged to Chat History and trigger an internal CRM notification. Messages are never silently dropped.
> - **Duplicate Qualification Prevention Rule added:** If the same phone number already has a completed qualification within the last 60 days, no new AI flow is started. New lead is linked to the existing record; CRM shows "Already Qualified".
> - State machine, handoff rules, CRM integration, Chat History section, and implementation phases updated accordingly.
>
> **Revision notes (v2.0 vs v1.0):**
> - Phase 1 outbound-only removed — first implementation is fully interactive
> - WhatsApp interactive buttons/list messages added throughout
> - Lead score `STANDARD` replaced with `COLD` everywhere
> - Budget tiers and upgrade rules updated
> - Consultant WhatsApp notification removed — internal CRM only
> - WhatsApp API Chat History integration added (every message logged)
> - Arabic thank-you message corrected
> - Stop/opt-out conditions formalised
> - Safety boundaries explicitly listed

---

## 1. Full Architecture Proposal

### Overview

When a new Meta lead arrives in the CRM, an AI agent named **خالد** contacts the lead via the production Meta Cloud API and walks them through a **fully interactive** 6-question qualification flow using WhatsApp reply buttons and list messages. Answers are stored in the CRM. After completion the agent scores the lead, writes a qualification summary, creates an internal CRM notification, and sends the lead a thank-you message. Every outbound question and every inbound reply is logged to the WhatsApp API Chat History — including all messages received **after** qualification is complete.

### Component Map

```
┌──────────────────────────────────────────────────────────────────┐
│                     META LEADS PIPELINE                          │
│  Facebook Ad → Meta Webhook → metaLeadsService → crm_leads      │
└─────────────────────────────┬────────────────────────────────────┘
                              │  new lead inserted (fire-and-forget)
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│          DUPLICATE QUALIFICATION CHECK (new — v2.1)              │
│                                                                  │
│  waQualService.checkDuplicateQualification(phone)                │
│  ├── Query: completed session for this phone within 60 days?     │
│  ├── YES → link new lead, create CRM note "Already Qualified",   │
│  │         skip AI flow entirely                                 │
│  └── NO  → proceed to triggerQualification(leadId)              │
└─────────────────────────────┬────────────────────────────────────┘
                              │  no duplicate found
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│               AI WHATSAPP QUALIFICATION ENGINE                   │
│                                                                  │
│  waQualService.ts          (new)                                 │
│  ├── triggerQualification(leadId)  ← called after lead insert    │
│  ├── handleInboundReply(fromNumber, bodyText, buttonId?)          │
│  │     ├── if session COMPLETED → log to Chat History +          │
│  │     │     create CRM notification, do NOT send AI reply       │
│  │     ├── if session OPT_OUT/FAILED/TIMED_OUT → log only        │
│  │     └── if session active → advance state machine             │
│  ├── advanceStateMachine(sessionId, parsedAnswer)                │
│  ├── sendInteractiveQuestion(phone, questionSpec)                │
│  ├── scoreLeadFromAnswers(answers) → COLD/WARM/HOT/VIP           │
│  ├── generateSummary(answers, score)                             │
│  └── notifyConsultantInternal(leadId, summary)  ← CRM only      │
│                                                                  │
│  Sender: sendMetaWhatsApp() + sendInteractiveMessage() (new)     │
│  Phone ID: 1110445448828325                                      │
│  Token:    WHATSAPP_ACCESS_TOKEN                                 │
└──────────────────┬──────────────────┬────────────────────────────┘
                   │ writes            │ logs every message
                   ▼                   ▼
┌─────────────────────────┐  ┌──────────────────────────────────────┐
│  wa_qual_sessions        │  │  whatsapp_api_conversations          │
│  wa_qual_answers         │  │  whatsapp_api_messages               │
│  wa_qual_summaries       │  │  (existing Chat History tables)      │
└─────────┬───────────────┘  └──────────────────────────────────────┘
          │  updates
          ▼
┌──────────────────────────────────────────────────────────────────┐
│                         CRM                                      │
│  crm_leads.qualification_status   none/in_progress/completed/    │
│                                   already_qualified              │
│  crm_leads.qualification_score    COLD/WARM/HOT/VIP              │
│  crm_leads.qualification_summary  short summary text             │
│  crm_leads.opt_out                boolean                        │
└──────────────────────────────────────────────────────────────────┘
          │  notify (internal only)
          ▼
┌──────────────────────────────────────────────────────────────────┐
│              CONSULTANT NOTIFICATION (INTERNAL ONLY)             │
│  In-app CRM notification (existing push system)                  │
│  Badge on CRM lead card                                          │
│  ✗ NO WhatsApp message to consultant                             │
└──────────────────────────────────────────────────────────────────┘
```

### Key Design Principles

- **Non-blocking:** `triggerQualification()` is fire-and-forget. Lead insert completes immediately.
- **Idempotent:** If a session already exists for a `lead_id`, the trigger is a no-op.
- **Stateless service:** All state lives in `wa_qual_sessions`. The engine can restart without losing progress.
- **Interactive from day one:** Every question uses WhatsApp buttons or list messages — never plain numeric-only text.
- **Full audit trail:** Every outbound AI message and every inbound reply is written to the WhatsApp API Chat History, including post-completion messages.
- **Never lose a message:** Even after AI handoff, inbound messages are always logged and always trigger a CRM notification.
- **No repeated qualification:** A customer who already completed qualification within 60 days is never re-qualified automatically.
- **Reuses existing sender:** No new Meta API key needed. Uses `sendMetaWhatsApp()` for text, adds `sendInteractiveMessage()` for buttons/lists.

---

## 2. Interactive Question Formats

### Button / List Message Assignment

WhatsApp supports two interactive types:
- **Reply buttons** — up to 3 options, shown as tappable buttons
- **List messages** — 4–10 options, shown as a scrollable list

| Question | Options | Format |
|---|---|---|
| Q1 Purchase goal | 3 | Reply buttons |
| Q2 City | 5 | List message |
| Q3 Budget | 4 | List message |
| Q4 Specific project | 3 | Reply buttons |
| Q4b Project name | free text | Plain text prompt |
| Q5 Visit timeline | 4 | List message |
| Q6 Property type | 3 | Reply buttons |

---

## 3. WhatsApp Conversation Flow

```
NEW LEAD INSERTED
        │
        ▼
┌──────────────────────────────────────────────────┐
│  DUPLICATE CHECK (v2.1)                          │
│  Has this phone number completed qualification   │
│  in the last 60 days?                            │
└──────┬────────────────────┬─────────────────────┘
       │ YES                │ NO
       ▼                    ▼
┌──────────────┐    ┌──────────────────────────────┐
│  ALREADY     │    │  PROCEED TO AI FLOW          │
│  QUALIFIED   │    └──────────────┬───────────────┘
│  - Link lead │                   │
│  - CRM note  │                   ▼
│  - No AI msg │    AI sends greeting (plain text)
└──────────────┘            │
                            ▼
┌──────────────────────────────────────────────────┐
│  GREETING                                        │
│  "مرحباً [name]! أنا خالد من Kinglike Luxury.   │
│   أود أن أطرح عليك بعض الأسئلة السريعة          │
│   لأقدم لك أفضل الفرص العقارية المناسبة.         │
│   يمكنك الإجابة باختيار الأزرار أدناه."          │
└──────────────────┬───────────────────────────────┘
                   │  any reply or button press
                   ▼
                [Q1 → Q2 → Q3 → Q4 → Q4b? → Q5 → Q6]
                   │  all 6 answers collected
                   ▼
        ┌──────────────────────┐
        │  SCORE + SUMMARY     │
        │  (internal only)     │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  THANK-YOU MESSAGE   │
        │  (sent to lead)      │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  LOG QUAL SUMMARY    │
        │  to Chat History     │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  NOTIFY CONSULTANT   │
        │  (CRM internal only) │
        └──────────┬───────────┘
                   │
                   ▼
              HANDOFF DONE
         crm_leads status → completed
                   │
                   │  ← session is now COMPLETED (terminal for AI)
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│  POST-COMPLETION MESSAGES (v2.1)                 │
│                                                  │
│  Any future inbound message from same phone:     │
│  ✓ Stored in Chat History                        │
│  ✓ Linked to correct CRM lead/conversation       │
│  ✓ Shown as new incoming message in thread       │
│  ✓ Triggers internal CRM notification            │
│  ✗ AI does NOT auto-reply                        │
│  ✗ AI does NOT restart qualification             │
└──────────────────────────────────────────────────┘
```

---

## 4. Message Content Specifications

### Greeting Message (plain text)

```
مرحباً [الاسم] 👋

أنا خالد من Kinglike Luxury.
أودّ أن أطرح عليك بعض الأسئلة السريعة لأتمكن من تقديم أفضل الفرص العقارية المناسبة لاحتياجاتك.

يمكنك الإجابة باختيار أحد الأزرار أدناه، أو كتابة إجابتك مباشرةً.
```

### Q1 — Purchase Goal (Reply Buttons)

```
Body: "ما هو هدفك من الشراء؟ 🏠"
Button 1: "استثمار"            id: goal_investment
Button 2: "سكن"               id: goal_residence
Button 3: "استثمار وسكن معاً"  id: goal_both
```

### Q2 — City (List Message)

```
Body: "أي مدينة تفضل للاستثمار أو الإقامة؟ 🌍"
List button text: "اختر مدينة"
Section: "المدن المتاحة"
  Row 1: id=city_batumi    title="باتومي"        desc="جورجيا 🇬🇪"
  Row 2: id=city_tbilisi   title="تبليسي"        desc="جورجيا 🇬🇪"
  Row 3: id=city_ncyprus   title="شمال قبرص"     desc="قبرص 🇨🇾"
  Row 4: id=city_istanbul  title="إسطنبول"        desc="تركيا 🇹🇷"
  Row 5: id=city_recommend title="أحتاج توصية"   desc="اقترح لي المناسب"
```

### Q3 — Budget (List Message)

```
Body: "ما هي ميزانيتك التقريبية؟ 💰"
List button text: "اختر الميزانية"
Section: "نطاق الميزانية"
  Row 1: id=budget_50_80    title="50,000 – 80,000 USD"
  Row 2: id=budget_80_100   title="80,000 – 100,000 USD"
  Row 3: id=budget_100_150  title="100,000 – 150,000 USD"
  Row 4: id=budget_150plus  title="أكثر من 150,000 USD"
```

### Q4 — Specific Project (Reply Buttons)

```
Body: "هل أنت مهتم بمشروع محدد؟ 🏗️"
Button 1: "نعم"            id: project_yes
Button 2: "لا"             id: project_no
Button 3: "أريد توصيات"    id: project_recommend
```

### Q4b — Project Name (plain text prompt, only if Q4 = "Yes")

```
"رائع! ما اسم المشروع الذي يثير اهتمامك؟"
(Awaits free text reply — stored as-is)
```

### Q5 — Visit Timeline (List Message)

```
Body: "هل تخطط لزيارة المشاريع قريباً؟ ✈️"
List button text: "اختر الوقت"
Section: "موعد الزيارة"
  Row 1: id=visit_1month    title="خلال شهر واحد"
  Row 2: id=visit_3months   title="خلال 3 أشهر"
  Row 3: id=visit_later     title="لاحقاً"
  Row 4: id=visit_undecided title="لم أقرر بعد"
```

### Q6 — Property Type (Reply Buttons)

```
Body: "ما نوع العقار الذي تفضله؟ 🏢"
Button 1: "جاهز للتسليم"   id: type_ready
Button 2: "قيد الإنشاء"    id: type_offplan
Button 3: "لا تفضيل"       id: type_nopref
```

### Thank-You Message (plain text, sent after all answers collected)

```
شكراً لتزويدنا بالمعلومات 🌷

سيقوم أحد مستشارينا العقاريين بالتواصل معكم في أسرع وقت ممكن لتزويدكم بكافة المعلومات والفرص المناسبة لاحتياجاتكم.

نتمنى لكم يوماً سعيداً.
```

### Qualification Summary (logged to Chat History after COMPLETED — not sent to lead)

```
📋 ملخص التأهيل — Kinglike Luxury

الهدف:         [goal answer]
المدينة:       [city answer]
الميزانية:    [budget answer]
المشروع:       [project name or "لا / توصيات"]
موعد الزيارة: [timeline answer]
نوع العقار:   [property type answer]

🏷️ تقييم العميل: [COLD / WARM / HOT / VIP]
📝 السبب: [score_reason text]
```

---

## 5. Duplicate Qualification Prevention (v2.1)

### Rule

Before starting any new AI qualification session, check:

> Does this phone number already have a `COMPLETED` qualification session with `completed_at` within the last **60 days**?

### If YES — Already Qualified

1. Do **not** send any WhatsApp message to the lead
2. Do **not** start a new session
3. Set new `crm_leads.qualification_status = 'already_qualified'`
4. Set new `crm_leads.qualification_score` = score from existing session
5. Copy the existing `qualification_summary` to the new lead record
6. Link the new lead to the existing `whatsapp_api_conversations` row for that phone (so future messages appear in the same thread)
7. Create an internal CRM notification:
   > "العميل مؤهَّل مسبقاً بتاريخ [date]. تم استخدام التأهيل الموجود."
   > *(Lead already qualified on [date]. Qualification reused.)*
8. CRM lead card shows **"Already Qualified"** badge with date

### If NO — Start Normal Flow

Proceed with `triggerQualification(leadId)` as normal.

### 60-Day Window Logic

```
checkDuplicateQualification(phoneNumber):
  SELECT s.*, l.phone FROM wa_qual_sessions s
  JOIN crm_leads l ON s.lead_id = l.id
  WHERE l.phone = phoneNumber
    AND s.status = 'completed'
    AND s.completed_at > NOW() - INTERVAL '60 days'
  LIMIT 1
  → If row found: return existing session
  → If not found: return null (proceed with new session)
```

### Edge Cases

| Scenario | Behaviour |
|---|---|
| Phone number has a `timed_out` or `failed` session | Treated as no completed session — new flow starts |
| Phone number has an `opt_out` session | Treated as opt-out across all leads — do not start new flow; show OPT-OUT badge |
| Phone number has `in_progress` session from another lead | Do not start second parallel session; attach new lead, notify consultant |
| Completed session is older than 60 days | Normal new flow starts |

---

## 6. Post-Completion Incoming Messages Rule (v2.1)

### Current Behaviour (v2.0 — changed)

~~After COMPLETED, further inbound messages from the lead are silently ignored by the AI.~~

### New Behaviour (v2.1)

After a session reaches `COMPLETED`, `OPT_OUT`, `TIMED_OUT`, or `FAILED`:

**The AI stops all outbound sends.** No qualification questions, no auto-replies, no restarts.

**But every inbound message is still:**
1. **Stored in WhatsApp API Chat History** — logged to `whatsapp_api_messages` with `direction = 'inbound'` and `context_label = 'post_completion'`
2. **Linked to the correct conversation** — the existing `whatsapp_api_conversations` row for that phone number
3. **Shown in the Chat History thread** as a new incoming message bubble
4. **Triggers an internal CRM notification** for the assigned consultant/admin:
   > "رسالة جديدة من [name/phone] — بعد اكتمال التأهيل. يرجى الرد مباشرة."
   > *(New message from [name/phone] after qualification handoff. Please respond directly.)*

### Why This Matters

> We must never lose a customer message after handoff. The AI stops, but logging and CRM notification always continue. A customer reaching out after qualification is a high-intent signal — the consultant must see it immediately.

### Implementation Note

`handleInboundReply()` checks session status first:
- If `COMPLETED` / `OPT_OUT` / `TIMED_OUT` / `FAILED` → log to Chat History + fire CRM notification, return without advancing state machine
- If `already_qualified` (no session, but existing completed record for phone) → same as above

---

## 7. Required Database Fields (Proposal Only)

> **No migrations yet.** This section describes what will be added when implementation begins.

### New Table: `wa_qual_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `lead_id` | integer FK → `crm_leads.id` | UNIQUE — one session per lead |
| `status` | text | `pending` / `greeting_sent` / `q1`–`q6` / `q4b` / `scoring` / `completed` / `failed` / `timed_out` / `opt_out` |
| `current_question` | text | `greeting` / `q1`–`q6` / `q4b` / `done` |
| `last_message_at` | timestamptz | updated on every send/receive |
| `last_outbound_wamid` | text | Meta message ID of last sent message |
| `retry_count` | integer | unanswered follow-up nudges sent (max 2) |
| `invalid_input_count` | integer | unrecognised replies for current question (max 2) |
| `created_at` | timestamptz | |
| `completed_at` | timestamptz | |

### New Table: `wa_qual_answers`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `session_id` | integer FK → `wa_qual_sessions.id` | |
| `question_number` | integer | 1–6 (4b counted as 4) |
| `question_key` | text | `goal` / `city` / `budget` / `project_interest` / `project_name` / `timeline` / `property_type` |
| `raw_input` | text | exact text or button ID the lead sent |
| `normalised_value` | text | canonical enum value after parsing |
| `input_method` | text | `button` / `list` / `text` |
| `received_at` | timestamptz | |

### New Table: `wa_qual_summaries`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `session_id` | integer FK → `wa_qual_sessions.id` | UNIQUE |
| `lead_score` | text | `VIP` / `HOT` / `WARM` / `COLD` |
| `score_reason` | text | human-readable reason string |
| `summary_text` | text | formatted summary logged to Chat History |
| `generated_at` | timestamptz | |

### Additions to Existing `crm_leads` Table

| Column | Type | Notes |
|---|---|---|
| `qualification_status` | text | `none` / `in_progress` / `completed` / `failed` / `timed_out` / `opt_out` / `already_qualified` |
| `qualification_score` | text | `VIP` / `HOT` / `WARM` / `COLD` / null |
| `qualification_summary` | text | short summary for CRM list view |
| `qualified_at` | timestamptz | |
| `opt_out` | boolean | true if lead sent stop keyword |

---

## 8. Lead Scoring Design

### Score Tiers

| Tier | Meaning |
|---|---|
| **VIP** | Highest priority — must be contacted immediately |
| **HOT** | High intent — contact same day |
| **WARM** | Moderate intent — contact within 48h |
| **COLD** | Low intent — nurture sequence |

### Budget-Driven Base Score

| Budget Answer | Base Score |
|---|---|
| More than 150,000 USD | **HOT** |
| 100,000 – 150,000 USD | **WARM** |
| 80,000 – 100,000 USD | **WARM** |
| 50,000 – 80,000 USD | **COLD** |

### Upgrade Rules (+1 tier each, maximum VIP)

| Condition | Effect |
|---|---|
| Visit timeline = "Within 1 month" | +1 tier |
| Specific project selected (Q4 = "Yes") | +1 tier |
| Goal = "Investment & Residence" | +1 tier |

**Maximum:** VIP. Upgrades are additive but capped.

### Score Reason Examples

- `VIP: Budget >150k + visit within 1 month + investment & residence goal`
- `HOT: Budget >150k + specific project selected`
- `WARM: Budget 100k–150k, no near-term visit planned`
- `COLD: Budget 50k–80k, no upgrade conditions met`

---

## 9. WhatsApp API Chat History Integration

Every message in the qualification flow must appear in the existing **WhatsApp API Chat History** admin page (`/admin/whatsapp-api-chat-history`). This includes all messages received after qualification is complete.

### Logging Rules

| Event | Direction | Context Label | Notes |
|---|---|---|---|
| Greeting sent | `outbound` | `qual_greeting` | |
| Q1–Q6 sent | `outbound` | `qual_q1` … `qual_q6` | |
| Q4b prompt sent | `outbound` | `qual_q4b` | |
| Nudge sent | `outbound` | `qual_nudge` | |
| Thank-you sent | `outbound` | `qual_thankyou` | |
| Lead reply (active session) | `inbound` | `qual_reply` | |
| Opt-out received | `inbound` | `qual_optout` | |
| Qualification summary | `outbound` | `qual_summary` | System message, not sent to lead |
| **Post-completion inbound** | `inbound` | **`post_completion`** | **v2.1 — always logged, never dropped** |
| **Already-qualified inbound** | `inbound` | **`post_completion`** | **v2.1 — logged to existing thread** |

All logging via the existing `logOutboundMessage()` / `logInboundMessage()` helpers in `metaWhatsAppService.ts`. The qualification summary is logged as a special outbound system message appended to the conversation after COMPLETED state is set.

### Chat History Conversation Display

The conversation thread shows the full lifecycle of a customer's interaction:

```
خالد (AI): مرحباً محمد 👋 أنا خالد من Kinglike Luxury…       [outbound bubble]
محمد:       [button press: استثمار وسكن معاً]                 [inbound bubble]
خالد (AI): أي مدينة تفضل؟ 🌍  [list message]                 [outbound bubble]
محمد:       باتومي                                            [inbound bubble]
...
خالد (AI): شكراً لتزويدنا بالمعلومات 🌷 …                    [outbound bubble]
─────────────── تقرير التأهيل ───────────────
خالد (AI): 📋 ملخص التأهيل — الهدف: استثمار وسكن…           [system bubble]
═════════════ تم التسليم للمستشار ═══════════
محمد:       هل يمكنني الاستفسار عن السعر؟                    [inbound bubble — post_completion]
محمد:       متى يمكن زيارة المشروع؟                          [inbound bubble — post_completion]
```

Post-completion messages appear in the same thread with a visual separator ("تم التسليم للمستشار") so consultants can see the full context.

---

## 10. AI State Machine Design

### States

```
IDLE
  → on triggerQualification() after duplicate check passes
GREETING_SENT
  → on any inbound reply
Q1_SENT → Q1_ANSWERED
Q2_SENT → Q2_ANSWERED
Q3_SENT → Q3_ANSWERED
Q4_SENT → Q4_ANSWERED
  └─ if "yes" → Q4B_SENT → Q4B_ANSWERED
Q5_SENT → Q5_ANSWERED
Q6_SENT → Q6_ANSWERED
  → SCORING
  → THANKYOU_SENT
  → SUMMARY_LOGGED
  → CONSULTANT_NOTIFIED (internal)
COMPLETED
  (terminal for AI sends)
  (inbound messages → logged + CRM notification only)

FAILED        (terminal — hard API error or non-WA number)
              (inbound messages → logged + CRM notification only)
TIMED_OUT     (terminal — no reply after nudge window exhausted)
              (inbound messages → logged + CRM notification only)
OPT_OUT       (terminal — lead replied stop keyword)
              (inbound messages → logged only, no CRM notification)

ALREADY_QUALIFIED  (virtual — no session row created)
              (inbound messages → logged to existing thread + CRM notification)
```

### Transition Logic

```
handleInboundReply(fromNumber, bodyText, buttonId?):

  [STEP 0 — Always log first]
  logInboundMessage({ phone: fromNumber, text: bodyText, ... })

  [STEP 1 — Find session]
  session = findSessionByPhone(fromNumber)

  [STEP 2 — Terminated sessions (post-completion rule)]
  if session.status IN (COMPLETED, FAILED, TIMED_OUT):
    createCrmNotification(session.lead_id, "رسالة جديدة بعد التسليم")
    return  ← no AI reply, no state change

  if session.status = OPT_OUT:
    return  ← log already done in Step 0, no notification

  [STEP 3 — No session but phone has already_qualified lead]
  if session is null AND existsAlreadyQualifiedLead(fromNumber):
    createCrmNotification for that lead
    return

  [STEP 4 — No session at all]
  if session is null:
    return  ← unrelated inbound, ignore

  [STEP 5 — Active session: check opt-out]
  if isOptOutKeyword(bodyText):
    → transition to OPT_OUT, send confirmation, stop

  [STEP 6 — Parse and advance]
  answer = parseAnswer(session.current_question, bodyText, buttonId)
  if valid: store answer, advance to next state, send next question
  if invalid: increment invalid_input_count, send clarification
  if invalid_input_count ≥ 2: skip question (null), advance

  [STEP 7 — After Q6 answered]
  → SCORING → THANKYOU_SENT → SUMMARY_LOGGED → NOTIFY → COMPLETED
```

### Input Normalisation

- Strip whitespace and punctuation
- Arabic-Indic digits `١٢٣٤٥` → `12345`
- Button/list ID takes priority over text parsing
- Partial keyword match (case-insensitive, Arabic diacritics stripped)
- Up to **2 clarification attempts** per question before auto-skip

---

## 11. Opt-Out and Stop Conditions

### Opt-Out Keywords (checked on every inbound message during active session)

```
Arabic:  لا أريد, إلغاء, اخرج, وقف, بلاش, لا شكرا, إيقاف
English: stop, unsubscribe, no more, cancel, quit
```

### On Opt-Out Detection

1. Set `wa_qual_sessions.status = 'opt_out'`
2. Set `crm_leads.opt_out = true`
3. Set `crm_leads.qualification_status = 'opt_out'`
4. Send confirmation message:
   ```
   تم إلغاء التواصل. لن نتواصل معك مجدداً.
   إذا غيّرت رأيك، يسعدنا خدمتك في أي وقت. 🌷
   ```
5. Log opt-out to Chat History (context: `qual_optout`)
6. Stop all further AI sends — session is terminal
7. CRM lead card shows **OPT-OUT** badge
8. Future inbound messages from opt-out phone are logged but generate no CRM notification

---

## 12. CRM Integration Plan

### Trigger Point

`metaLeadsService.ts` — after a new `crm_leads` row is inserted successfully:

```typescript
// PROPOSED addition (not yet in code):
// fire-and-forget — never throws, never delays webhook response
waQualService.checkAndTrigger(crmLead.id, crmLead.phone).catch(() => {});
// checkAndTrigger() = duplicate check → if clear, triggerQualification()
```

### CRM Lead Card

The lead detail page (`crm-lead-detail.tsx`) will gain:
- A **Qualification badge**: pill showing `VIP` / `HOT` / `WARM` / `COLD` / `In Progress` / `Pending` / `Opt-Out` / **`Already Qualified`**
- A **Qualification tab**: shows all 6 answers, score, score reason, and link to Chat History thread
- A **"Restart Qualification"** button for admins (only if status = `failed` / `timed_out`)
- **OPT-OUT badge**: prominent warning if lead has opted out
- **"Already Qualified" notice**: shows original qualification date and score if reused

### CRM List View

`crm-leads.tsx` filter sidebar will gain:
- Filter by `qualification_score` (VIP / HOT / WARM / COLD)
- Filter by `qualification_status` (including `already_qualified`)
- Visual badge on each lead card (brand colours: VIP=teal, HOT=deep blue, WARM=teal/50%, COLD=grey)

### Internal Notifications (no WhatsApp to consultant)

| Event | Notification Text |
|---|---|
| Qualification completed | "تم تأهيل العميل: [name] — Score: [tier]" |
| Post-completion inbound message | "رسالة جديدة من [name] بعد اكتمال التأهيل" |
| Duplicate lead detected | "العميل مؤهَّل مسبقاً بتاريخ [date]. تم استخدام التأهيل الموجود." |
| Session timed out | "انتهت مهلة تأهيل العميل [name] دون رد" |

---

## 13. Failure and Timeout Handling

### Timeout Policy

| Wait Window | Action |
|---|---|
| 24h with no reply | Send nudge 1: "هل ما زلت مهتماً؟ يمكنك الرد في أي وقت." |
| 48h total with no reply | Send nudge 2: "يسعدنا مساعدتك لاحقاً عندما تكون مستعداً." |
| 72h total with no reply | Set `TIMED_OUT` — create internal CRM notification |

Max **2 nudge messages** per session. No further sends after timeout.
Post-timeout inbound messages still logged + CRM notification fired (per v2.1 rule).

### Hard Failures

| Failure | Handling |
|---|---|
| Meta API returns non-200 | Log error, retry once after 60s, then set `FAILED` |
| Lead phone not on WhatsApp (error 131030) | Set `FAILED` immediately, no retry |
| Lead replies opt-out keyword | Set `OPT_OUT`, send confirmation, stop |
| Lead has no phone number | Skip qualification entirely (no session created) |
| DB write fails | Log, retry once, then set `FAILED` |
| Duplicate phone — in-progress session exists | Do not create second session; attach new lead to existing session |

---

## 14. Estimated Implementation Plan

### Phase 1 — Interactive Core Flow + Safety Rules
**Scope:**
- `wa_qual_sessions`, `wa_qual_answers`, `wa_qual_summaries` tables
- `waQualService.ts` with full state machine including duplicate check and post-completion logging
- `sendInteractiveMessage()` helper for buttons + list messages
- Greeting → Q1–Q6 → score → thank-you → summary log → internal CRM notification
- Opt-out detection on every inbound message
- Full Chat History logging (all outbound + inbound, including post-completion)
- Duplicate qualification prevention (60-day check)
- Webhook extension to route inbound WA messages to `handleInboundReply()`
- CRM lead card badge + qualification tab
- `crm_leads` new columns

**Estimated effort:** 6–8 days
**Risk:** Medium — requires Meta webhook inbound configuration

---

### Phase 2 — CRM Qualification UI + Filters
**Scope:**
- Filter by score and status in CRM list view
- "Already Qualified" badge and notice
- Restart qualification button (failed / timed_out sessions)
- Admin score override in lead detail
- OPT-OUT status prominently shown
- Post-completion message indicator in Chat History thread (separator)

**Estimated effort:** 2–3 days
**Risk:** Low — frontend only

---

### Phase 3 — Timeout & Nudge Scheduler
**Scope:**
- `waQualScheduler.ts` — cron job checks sessions with `last_message_at` > 24h
- Sends nudge 1 / nudge 2 / sets TIMED_OUT per policy
- Logs nudges to Chat History
- Timed-out sessions create internal CRM notification

**Estimated effort:** 2 days
**Risk:** Low

---

### Total Estimated Timeline

| Phase | Scope | Days |
|---|---|---|
| Phase 1 | Interactive core + webhook + safety rules + CRM badge + logging | 6–8 |
| Phase 2 | CRM UI + filters + override + already-qualified UI | 2–3 |
| Phase 3 | Timeout nudge scheduler | 2 |
| **Total** | | **10–13 days** |

---

## Appendix A — New Files Required (Implementation Phase)

```
server/waQualService.ts               — state machine, scoring, summary, opt-out,
                                        duplicate check, post-completion logging
server/waQualScheduler.ts             — timeout nudge cron
server/waQualRoutes.ts                — admin API (restart, score-override)
server/interactiveMessageHelper.ts    — sendInteractiveMessage() (buttons + lists)
client/.../wa-qualification-tab.tsx   — CRM lead detail qualification tab
client/.../wa-qual-badge.tsx          — reusable score tier badge component
```

## Appendix B — Existing Files Touched (Implementation Phase)

```
server/db.ts                           — add ensureWaQualTables()
server/metaLeadsService.ts             — add fire-and-forget checkAndTrigger() after insert
server/routes.ts (webhook handler)     — route inbound WA messages to handleInboundReply()
server/services/metaWhatsAppService.ts — add logInboundMessage() helper for inbound logging
server/index.ts                        — register waQualRoutes, start waQualScheduler, call ensureWaQualTables()
client/.../crm-lead-detail.tsx         — add Qualification tab + badge + already-qualified notice
client/.../crm-leads.tsx               — add score filter + badge + already_qualified status
```

## Appendix C — Files NOT Touched (Safety Boundary)

```
server/services/metaWhatsAppService.ts   — sendMetaWhatsApp() reused as-is; only logInboundMessage() added
server/whatsappNotificationService.ts    — untouched (welcome / bulk sends)
server/whatsappAiService.ts              — untouched (independent AI conversation system)
server/emailNurturingService.ts          — untouched
server/silkSubmissionAdapter.ts          — untouched
server/developerRegistrationService.ts   — untouched
server/routes.ts (auth / OTP sections)   — untouched
All Twilio SMS / OTP logic               — untouched
Public website WhatsApp links            — untouched
Meta lead sync core logic                — only trigger point added (fire-and-forget, never throws)
```

---

*This document is planning only — Version 2.1. No production code, database schema, or environment variables have been modified.*
