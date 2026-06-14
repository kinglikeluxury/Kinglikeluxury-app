import { pool } from "./db";

// ─────────────────────────────────────────────────────────────────────────────
//  AI Lead Scoring Service  — pure rule-based engine (no OpenAI required)
//  Scores are cached in DB and updated on lead create / important-field-update.
// ─────────────────────────────────────────────────────────────────────────────

export interface AiScoreResult {
  score:    number;
  category: "HOT" | "WARM" | "COLD";
  reason:   string;
}

// ── Budget parser ─────────────────────────────────────────────────────────────
function parseBudget(raw: string | null | undefined): number {
  if (!raw) return 0;
  const s = String(raw).toLowerCase().replace(/[\s,$€£]/g, "");
  if (s.includes("m"))  return parseFloat(s) * 1_000_000;
  if (s.includes("k"))  return parseFloat(s) * 1_000;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

// ── Budget scoring — max 30 pts ───────────────────────────────────────────────
function budgetPts(raw: string | null | undefined): { pts: number; label: string } {
  const b = parseBudget(raw);
  if (b >= 200_000) return { pts: 30, label: `Budget $${Math.round(b/1000)}K+ (premium)` };
  if (b >= 150_000) return { pts: 25, label: `Budget $${Math.round(b/1000)}K (high)` };
  if (b >= 100_000) return { pts: 20, label: `Budget $${Math.round(b/1000)}K` };
  if (b >=  70_000) return { pts: 15, label: `Budget $${Math.round(b/1000)}K` };
  if (b >=  50_000) return { pts: 10, label: `Budget $${Math.round(b/1000)}K (moderate)` };
  if (b >=  30_000) return { pts:  7, label: `Budget $${Math.round(b/1000)}K (low)` };
  if (b >       0)  return { pts:  3, label: `Budget $${b.toLocaleString()} (very low)` };
  return { pts: 5, label: "Budget not specified" };
}

// ── Timeline scoring — max 20 pts ─────────────────────────────────────────────
function timelinePts(
  expectedMonth: string | null | undefined,
  timeframeStr:  string | null | undefined,
): { pts: number; label: string } {
  const em = (expectedMonth ?? "").toLowerCase().trim();
  const tf = (timeframeStr  ?? "").toLowerCase().trim();

  if (em === "ready" || tf.match(/immediate|now\b|asap|urgent|ready/))
    return { pts: 20, label: "Ready to purchase immediately" };

  if (tf) {
    if (tf.match(/1[\s-]*month|within.*1|less.*3|<\s*3/))
      return { pts: 18, label: "Purchase timeline 1–3 months" };
    if (tf.match(/[23][\s-]*month|quarter/))
      return { pts: 14, label: "Purchase timeline ~3 months" };
    if (tf.match(/6[\s-]*month|half[\s-]*year/))
      return { pts: 10, label: "Purchase timeline ~6 months" };
    if (tf.match(/year|12[\s-]*month/))
      return { pts:  6, label: "Purchase timeline ~1 year" };
  }

  if (!em || em === "unknown") return { pts: 5, label: "Purchase timeline not specified" };

  try {
    const [mStr, yStr] = em.split(".");
    const month = parseInt(mStr, 10);
    const year  = parseInt(yStr, 10);
    if (!month || !year) return { pts: 5, label: "Purchase timeline not specified" };
    const target     = new Date(year, month - 1, 1);
    const now        = new Date();
    const diffMonths = (target.getFullYear() - now.getFullYear()) * 12
                     + (target.getMonth()    - now.getMonth());
    if (diffMonths <= 0)  return { pts: 20, label: "Purchase timeline: current / past (ready)" };
    if (diffMonths <= 3)  return { pts: 18, label: `Purchase timeline ${diffMonths}mo (soon)` };
    if (diffMonths <= 6)  return { pts: 13, label: `Purchase timeline ${diffMonths}mo` };
    if (diffMonths <= 12) return { pts:  8, label: `Purchase timeline ${diffMonths}mo` };
    return { pts: 4, label: `Purchase timeline ${diffMonths}mo (distant)` };
  } catch {
    return { pts: 5, label: "Purchase timeline unknown" };
  }
}

// ── Country scoring — max 15 pts ──────────────────────────────────────────────
const HIGH_MARKETS = ["israel","arab 48","arabs 48","48 arab","palestinian","palestine","972","+972"];
const GULF_MARKETS = ["uae","united arab emirates","saudi","ksa","kuwait","qatar","bahrain","oman","971","966","965","974","973","968"];
const ARAB_MARKETS = ["jordan","iraq","egypt","libya","morocco","tunisia","algeria","syria","lebanon","yemen","sudan"];
const EU_MARKETS   = ["germany","france","united kingdom","uk","spain","italy","netherlands","belgium","sweden","norway","switzerland","austria","poland","portugal","russia","ukraine","greece","czech","hungary","romania","bulgaria","finland","denmark"];

function countryPts(country: string | null | undefined): { pts: number; label: string } {
  if (!country) return { pts: 7, label: "Country not specified" };
  const c = country.toLowerCase().trim();
  if (HIGH_MARKETS.some(k => c.includes(k))) return { pts: 15, label: `Origin: ${country} (priority market)` };
  if (GULF_MARKETS.some(k => c.includes(k))) return { pts: 14, label: `Origin: ${country} (Gulf market)` };
  if (ARAB_MARKETS.some(k => c.includes(k))) return { pts: 12, label: `Origin: ${country} (Arab market)` };
  if (EU_MARKETS.some(k => c.includes(k)))   return { pts: 10, label: `Origin: ${country} (European)` };
  return { pts: 7, label: `Origin: ${country}` };
}

// ── Goal scoring — max 15 pts ─────────────────────────────────────────────────
function goalPts(goalStr: string | null | undefined): { pts: number; label: string } {
  const g = (goalStr ?? "").toLowerCase().trim();
  if (!g) return { pts: 7, label: "Purchase goal not specified" };
  if (g.includes("invest") && (g.includes("resid") || g.includes("live") || g.includes("both")))
    return { pts: 15, label: "Goal: investment & residence" };
  if (g.includes("invest"))
    return { pts: 15, label: "Goal: investment" };
  if (g.includes("resid") || g.includes("live") || g.includes("home") || g.includes("family"))
    return { pts: 10, label: "Goal: residence" };
  if (g.includes("explor") || g.includes("just look") || g.includes("browsing"))
    return { pts:  5, label: "Goal: exploring options" };
  return { pts: 7, label: `Goal: ${goalStr}` };
}

// ── Main scoring function ─────────────────────────────────────────────────────
export async function scoreLead(leadId: number): Promise<AiScoreResult | null> {
  const client = await pool.connect();
  try {
    const [leadRes, answersRes, summaryRes, aiReportRes] = await Promise.all([
      client.query("SELECT * FROM crm_leads WHERE id = $1", [leadId]),
      client.query(
        `SELECT qa.question_key, qa.normalised_value, qa.raw_input
           FROM wa_qual_answers qa
           JOIN wa_qual_sessions qs ON qa.session_id = qs.id
          WHERE qs.lead_id = $1`,
        [leadId],
      ),
      client.query(
        `SELECT wqs.qual_score, wqs.score_reason, wqs.summary_text
           FROM wa_qual_summaries wqs
           JOIN wa_qual_sessions ws ON wqs.session_id = ws.id
          WHERE ws.lead_id = $1 LIMIT 1`,
        [leadId],
      ),
      client.query(
        "SELECT * FROM whatsapp_ai_agent_reports WHERE lead_id = $1 ORDER BY id DESC LIMIT 1",
        [leadId],
      ),
    ]);

    const lead = leadRes.rows[0];
    if (!lead) return null;

    const answers: Record<string, string> = {};
    for (const row of answersRes.rows) {
      answers[row.question_key] = row.normalised_value ?? row.raw_input ?? "";
    }
    const qualSummary = summaryRes.rows[0]  ?? null;
    const aiReport    = aiReportRes.rows[0] ?? null;

    const bullets: string[] = [];
    let total = 0;

    // 1. Budget — max 30
    const budgetStr = lead.budget || answers["budget"] || aiReport?.budget || "";
    const bRes = budgetPts(budgetStr);
    total += bRes.pts;
    bullets.push(bRes.label);

    // 2. Timeline — max 20
    const timeframeStr = answers["timeline"] ?? answers["purchase_timeline"] ?? aiReport?.buying_timeframe ?? "";
    const tlRes = timelinePts(lead.expected_purchase_month, timeframeStr);
    total += tlRes.pts;
    bullets.push(tlRes.label);

    // 3. Country — max 15
    const ctRes = countryPts(lead.country);
    total += ctRes.pts;
    bullets.push(ctRes.label);

    // 4. Goal — max 15
    const goalStr = answers["goal"] ?? answers["purpose"] ?? aiReport?.investment_goal ?? "";
    const glRes = goalPts(goalStr);
    total += glRes.pts;
    bullets.push(glRes.label);

    // 5. Phone validity — max 5
    if (lead.phone && String(lead.phone).trim().length >= 6) {
      total += 5;
      bullets.push("Valid phone number ✓");
    } else {
      bullets.push("No valid phone number");
    }

    // 6. WhatsApp / CRM engagement — max 10
    const qualStatus = lead.qualification_status;
    if (qualStatus === "complete" || qualStatus === "completed") {
      total += 10;
      bullets.push("Completed WhatsApp qualification");
    } else if (qualStatus === "in_progress") {
      total += 6;
      bullets.push("WhatsApp qualification in progress");
    } else if (aiReport) {
      total += 4;
      bullets.push("WhatsApp AI conversation engaged");
    } else if (lead.last_contact_at || lead.notes) {
      total += 3;
      bullets.push("Manual CRM activity recorded");
    } else {
      bullets.push("No WhatsApp / CRM engagement");
    }

    // 7. Lead status modifier
    const STATUS_MOD: Record<string, { pts: number; label: string }> = {
      hot_buyer:      { pts:  5, label: "Status: Hot Buyer" },
      deposited:      { pts:  5, label: "Status: Deposited" },
      purchased:      { pts:  5, label: "Status: Purchased" },
      reserved:       { pts:  5, label: "Status: Reserved" },
      interested:     { pts:  3, label: "Status: Interested" },
      not_interested: { pts: -10, label: "Status: Not Interested" },
      will_not_buy:   { pts: -10, label: "Status: Will Not Buy" },
      junk_lead:      { pts: -15, label: "Status: Junk Lead" },
      no_answer_3:    { pts:  -5, label: "Repeated no-answer (3×)" },
      no_answer_4:    { pts:  -7, label: "Repeated no-answer (4×)" },
    };
    const mod = STATUS_MOD[lead.status as string];
    if (mod) {
      total += mod.pts;
      bullets.push(mod.label);
    }

    // 8. AI qualification data bonus — max 5
    if (qualSummary) { total += 2; bullets.push("WA qualification summary available"); }
    if (aiReport)    { total += 3; bullets.push("AI agent report available"); }

    // Clamp [0, 100]
    total = Math.max(0, Math.min(100, Math.round(total)));

    const category: "HOT" | "WARM" | "COLD" =
      total >= 80 ? "HOT" : total >= 50 ? "WARM" : "COLD";
    const emoji = category === "HOT" ? "🔥" : category === "WARM" ? "🟡" : "❄️";

    const reason = [
      `${emoji} ${category} — Score: ${total}/100`,
      "",
      ...bullets.map(b => `• ${b}`),
    ].join("\n");

    return { score: total, category, reason };
  } catch (err: any) {
    console.error(`[AIScore] scoreLead(${leadId}):`, err.message);
    return null;
  } finally {
    client.release();
  }
}

// ── Save score to DB + fire HOT notification on category change ───────────────
export async function scoreAndSaveLead(leadId: number): Promise<void> {
  try {
    const prevRes    = await pool.query(
      "SELECT ai_score_category FROM crm_leads WHERE id = $1",
      [leadId],
    );
    const prevCategory = prevRes.rows[0]?.ai_score_category ?? null;

    const result = await scoreLead(leadId);
    if (!result) return;

    await pool.query(
      `UPDATE crm_leads
          SET ai_score            = $1,
              ai_score_category   = $2,
              ai_score_reason     = $3,
              ai_score_updated_at = NOW()
        WHERE id = $4`,
      [result.score, result.category, result.reason, leadId],
    );

    if (result.category === "HOT" && prevCategory !== "HOT") {
      await notifyHotLead(leadId, result.score);
    }

    console.log(`[AIScore] Lead ${leadId} → ${result.category} (${result.score}/100)`);
  } catch (err: any) {
    console.error(`[AIScore] scoreAndSaveLead(${leadId}):`, err.message);
  }
}

// ── HOT lead in-app notification ──────────────────────────────────────────────
async function notifyHotLead(leadId: number, score: number): Promise<void> {
  try {
    const leadRes  = await pool.query(
      "SELECT full_name, phone, assigned_to FROM crm_leads WHERE id = $1",
      [leadId],
    );
    const lead = leadRes.rows[0];
    if (!lead) return;

    const adminRes = await pool.query(
      "SELECT id FROM users WHERE is_admin = TRUE LIMIT 5",
    );

    const targets = new Set<number>();
    if (lead.assigned_to) targets.add(lead.assigned_to);
    for (const r of adminRes.rows) targets.add(r.id);

    const name  = lead.full_name || lead.phone || `Lead #${leadId}`;
    const title = "🔥 High Priority Lead Detected";
    const msg   = `"${name}" has been scored HOT (${score}/100) by AI. Immediate follow-up recommended.`;
    const data  = JSON.stringify({ leadId, score, type: "ai_score_hot" });

    for (const uid of targets) {
      await pool.query(
        `INSERT INTO user_notifications (user_id, type, title, message, data, is_read, created_at)
         VALUES ($1, 'hot_lead_ai_score', $2, $3, $4, FALSE, NOW())`,
        [uid, title, msg, data],
      );
    }
    console.log(`[AIScore] HOT notification sent for lead ${leadId} to ${targets.size} user(s)`);
  } catch (err: any) {
    console.error(`[AIScore] notifyHotLead(${leadId}):`, err.message);
  }
}
