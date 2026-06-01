/**
 * End-to-end lead extraction test.
 * Run with: npx tsx server/_test_lead_extraction.ts
 * Tests the exact sample message from the user's approval request.
 * Delete this file after verification.
 */

import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";
neonConfig.webSocketConstructor = ws;

import { extractProfileData, computeLeadScore, buildScoreReason } from "./aiAdvisor";
import OpenAI from "openai";

const TEST_USER_ID = 1;
const TEST_MESSAGE = "أريد مشروع على خط أول على البحر في باتومي بميزانية 100 ألف دولار ورقمي 995591000058";
const TEST_LANGUAGE = "ar";

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

async function main() {
  const db = await pool.connect();

  try {
    // ── Step 1: Create a fresh test conversation ─────────────────────────────
    const convResult = await db.query(
      `INSERT INTO ai_conversations (user_id, language, status, message_count)
       VALUES ($1, $2, 'active', 0)
       RETURNING id`,
      [TEST_USER_ID, TEST_LANGUAGE]
    );
    const conversationId: number = convResult.rows[0].id;
    console.log(`\n✅ Step 1 — Created test conversation #${conversationId}`);

    // ── Step 2: Call OpenAI directly (same setup as streamChatWithAdvisor) ───
    console.log(`\n⏳ Step 2 — Calling AI with test message...`);
    console.log(`   Message: "${TEST_MESSAGE}"`);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Import the SYSTEM_PROMPT via a workaround — read it from the module
    const advisorModule = await import("./aiAdvisor");
    // Use chatWithAdvisor (non-streaming) so we can capture the full raw response
    const aiResp = await advisorModule.chatWithAdvisor(
      [{ role: "user", content: TEST_MESSAGE }],
      TEST_LANGUAGE,
      undefined,
      TEST_USER_ID,
      "cold"
    );

    console.log(`\n📨 Step 3 — Raw AI output (clean message + profile_data detection):`);
    console.log(`   Clean message length: ${aiResp.message.length} chars`);
    console.log(`   Profile data extracted: ${aiResp.profileData ? "YES ✅" : "NO ❌"}`);
    console.log(`\n   --- CLEAN MESSAGE ---`);
    console.log(`   ${aiResp.message}`);

    if (!aiResp.profileData || Object.keys(aiResp.profileData).length === 0) {
      console.log(`\n❌ FAIL: No profile_data block was emitted by the AI.`);
      console.log(`   This means max_tokens is still too low, or the AI skipped the block.`);
      process.exit(1);
    }

    console.log(`\n   --- RAW PROFILE_DATA FIELDS ---`);
    Object.entries(aiResp.profileData).forEach(([k, v]) => {
      console.log(`   ${k}: ${v}`);
    });

    // ── Step 3: Compute lead score ───────────────────────────────────────────
    const score = computeLeadScore(aiResp.profileData);
    const reason = buildScoreReason(aiResp.profileData, score);
    console.log(`\n📊 Step 4 — Lead score: ${score.toUpperCase()} (${reason})`);

    // ── Step 4: Save messages to DB ──────────────────────────────────────────
    await db.query(
      `INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
      [conversationId, TEST_MESSAGE]
    );
    await db.query(
      `INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
      [conversationId, aiResp.message]
    );
    await db.query(
      `UPDATE ai_conversations SET message_count = 2 WHERE id = $1`,
      [conversationId]
    );

    // ── Step 5: Upsert investor profile (exactly as routes.ts does) ──────────
    const profilePayload = {
      ...aiResp.profileData,
      leadScore: score,
      scoreReason: reason,
      language: TEST_LANGUAGE,
    };

    const upsertResult = await db.query(
      `INSERT INTO investor_profiles
         (conversation_id, user_id, language, goal, budget, payment_preference,
          country, city, interested_project, timeline, communication_method,
          whatsapp_contact_number, email, lead_score, score_reason, summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (conversation_id) DO UPDATE SET
         language = EXCLUDED.language,
         goal = EXCLUDED.goal,
         budget = EXCLUDED.budget,
         country = EXCLUDED.country,
         city = EXCLUDED.city,
         interested_project = EXCLUDED.interested_project,
         whatsapp_contact_number = EXCLUDED.whatsapp_contact_number,
         lead_score = EXCLUDED.lead_score,
         score_reason = EXCLUDED.score_reason,
         summary = EXCLUDED.summary,
         updated_at = NOW()
       RETURNING id, conversation_id, lead_score, budget, country, city,
                 interested_project, whatsapp_contact_number, language, summary`,
      [
        conversationId,
        TEST_USER_ID,
        profilePayload.language,
        profilePayload.goal || null,
        profilePayload.budget || null,
        profilePayload.paymentPreference || null,
        profilePayload.country || null,
        profilePayload.city || null,
        profilePayload.interestedProject || null,
        profilePayload.timeline || null,
        profilePayload.communicationMethod || null,
        profilePayload.whatsappContactNumber || null,
        profilePayload.email || null,
        score,
        reason,
        profilePayload.summary || null,
      ]
    );

    const saved = upsertResult.rows[0];
    console.log(`\n✅ Step 5 — investor_profiles record created (id=${saved.id}):`);
    console.log(`   conversation_id : ${saved.conversation_id}`);
    console.log(`   lead_score      : ${saved.lead_score?.toUpperCase()}`);
    console.log(`   country         : ${saved.country}`);
    console.log(`   city            : ${saved.city}`);
    console.log(`   budget          : ${saved.budget}`);
    console.log(`   interested_proj : ${saved.interested_project}`);
    console.log(`   whatsapp        : ${saved.whatsapp_contact_number}`);
    console.log(`   language        : ${saved.language}`);

    // ── Step 6: Verification ─────────────────────────────────────────────────
    console.log(`\n🔍 Step 6 — Verification checklist:`);
    const checks = [
      { label: "Country = Georgia",         pass: (saved.country || "").toLowerCase().includes("georgia") },
      { label: "City = Batumi",             pass: (saved.city || "").toLowerCase().includes("batumi") },
      { label: "Budget extracted",          pass: !!(saved.budget) },
      { label: "WhatsApp = 995591000058",   pass: (saved.whatsapp_contact_number || "").includes("995591000058") },
      { label: "Lead score = HOT",          pass: saved.lead_score === "hot" },
      { label: "Project interest recorded", pass: !!(saved.interested_project) },
    ];
    checks.forEach(c => console.log(`   ${c.pass ? "✅" : "❌"} ${c.label}`));

    const allPassed = checks.every(c => c.pass);
    console.log(`\n${allPassed ? "🎉 ALL CHECKS PASSED" : "⚠️  SOME CHECKS FAILED"}`);
    console.log(`\n📍 Lead is now visible at: Admin → AI Intelligence Center → AI Leads (conversation #${conversationId})`);

  } finally {
    db.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error("\n❌ Test error:", e.message);
  process.exit(1);
});
