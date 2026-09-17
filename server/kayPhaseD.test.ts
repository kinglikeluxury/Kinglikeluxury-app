import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  commitmentInput, defaultPhaseDSettings, employeeSafePhaseDSettings, formatBriefing, phaseDSettingsSchema, promiseInput,
} from "./kayPhaseDService";

const service = readFileSync(new URL("./kayPhaseDService.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
const bootstrap = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const controlCenter = readFileSync(new URL("../client/src/pages/admin/kay-control-center.tsx", import.meta.url), "utf8");
const mySales = readFileSync(new URL("../client/src/pages/admin/kay-my-sales.tsx", import.meta.url), "utf8");

test("Phase D settings accept the complete bounded contract", () => {
  assert.equal(defaultPhaseDSettings.enabled, false);
  assert.ok(phaseDSettingsSchema.safeParse(defaultPhaseDSettings).success);
  assert.ok(phaseDSettingsSchema.safeParse({ ...defaultPhaseDSettings, evaluation_interval_minutes: 1, max_commitment_extensions: 0, directness_level: 1 }).success);
  assert.ok(phaseDSettingsSchema.safeParse({ ...defaultPhaseDSettings, evaluation_interval_minutes: 60, max_commitment_extensions: 5, directness_level: 5 }).success);
});

test("Phase D settings reject unsafe values and unknown fields", () => {
  assert.ok(!phaseDSettingsSchema.safeParse({ ...defaultPhaseDSettings, evaluation_interval_minutes: 0 }).success);
  assert.ok(!phaseDSettingsSchema.safeParse({ ...defaultPhaseDSettings, max_commitment_extensions: 6 }).success);
  assert.ok(!phaseDSettingsSchema.safeParse({ ...defaultPhaseDSettings, default_language: "fr" }).success);
  assert.ok(!phaseDSettingsSchema.safeParse({ ...defaultPhaseDSettings, unexpected: true }).success);
});

test("Phase D employee inputs validate identity, text, due date, and idempotency key", () => {
  const dueAt = new Date(Date.now() + 60_000);
  assert.ok(commitmentInput.safeParse({ action: "Call manager", dueAt, idempotencyKey: "commitment-key" }).success);
  assert.ok(promiseInput.safeParse({ leadId: 1, promiseText: "Send an internal update", dueAt, idempotencyKey: "promise-key" }).success);
  assert.ok(!commitmentInput.safeParse({ action: "x", dueAt, idempotencyKey: "short" }).success);
  assert.ok(!promiseInput.safeParse({ leadId: 0, promiseText: "ok", dueAt, idempotencyKey: "promise-key" }).success);
  assert.ok(!promiseInput.safeParse({ leadId: 1, promiseText: "ok", dueAt, idempotencyKey: "promise-key", employeeId: 9 }).success);
});

test("Phase D promise UI sends only supported importance values", () => {
  assert.match(mySales, /value="NORMAL">Normal/);
  assert.match(mySales, /value="IMPORTANT">Important/);
  assert.doesNotMatch(mySales, /<option>HIGH<\/option>|<option>LOW<\/option>/);
});

test("Phase D employee profile UI uses only the canonical preferred voice field", () => {
  assert.match(controlCenter, /["']preferred_voice_name["']/);
  assert.match(controlCenter, /k\s*===\s*["']preferred_voice_name["']\s*\?\s*\(e\.target\.value\.trim\(\)\s*\|\|\s*null\)/);
  assert.match(controlCenter, /address\s*:\s*String\(employee\?\.name\s*\?\?\s*`Employee \$\{e\.target\.value\}`\)/);
  assert.doesNotMatch(controlCenter, /\baddress\s*:\s*["']\s*["']/);
  assert.doesNotMatch(controlCenter, /\bpreferred_voice\s*:/);
});

test("Phase D ownership is checked at creation, listing, and completion", () => {
  assert.match(service, /SELECT id FROM crm_leads WHERE id=\$\{data\.leadId\} AND assigned_to=\$\{employeeId\} FOR UPDATE/);
  assert.match(service, /c\.employee_id=\$\{employeeId\}[\s\S]*c\.lead_id IS NULL OR EXISTS/);
  assert.match(service, /c\.employee_id=\$\{employeeId\}[\s\S]*l\.assigned_to=\$\{employeeId\}/);
  assert.match(service, /p\.employee_id=\$\{employeeId\}[\s\S]*l\.assigned_to=\$\{employeeId\}/);
});

test("Phase D lifecycle is Kay-owned and completion is terminal", () => {
  assert.match(service, /SET status='COMPLETED',completed_at=NOW\(\),updated_at=NOW\(\)[\s\S]*status IN \('PENDING','ACCEPTED','EXTENDED','OVERDUE','ACTIVE'\)/);
  assert.match(service, /SET status='COMPLETED',completed_at=NOW\(\),updated_at=NOW\(\)[\s\S]*status IN \('PENDING','DUE_SOON','OVERDUE','OPEN'\)/);
  assert.match(service, /UPDATE kay_commitments c SET status='STALE'/);
  assert.match(service, /owner_review_required_at=COALESCE\(owner_review_required_at,NOW\(\)\)/);
  assert.doesNotMatch(service, /DELETE FROM kay_(commitments|promises)/i);
});

test("Phase D extension cap is persisted and escalated once exhausted", () => {
  assert.match(service, /maxExtensions: settings\.max_commitment_extensions/);
  assert.match(service, /c\.extensionCount >= c\.maxExtensions[\s\S]*COMMITMENT_EXTENSIONS_EXHAUSTED/);
  assert.match(schema, /maxExtensions: integer\("max_extensions"\).*default\(2\)/);
});

test("Phase D reminders and manager reviews use versioned or stable idempotency keys", () => {
  assert.match(service, /commitment-overdue:\$\{c\.id\}:v\$\{c\.reminderVersion \+ 1\}/);
  assert.match(service, /important-promise-overdue:\$\{p\.id\}:v\$\{p\.reminderVersion \+ 1\}/);
  assert.match(service, /review:commitment:\$\{c\.id\}/);
  assert.match(service, /review:promise:\$\{p\.id\}/);
  assert.match(service, /review:promise-owner:\$\{p\.id\}/);
  assert.match(service, /eq\(kayCommitments\.reminderVersion, c\.reminderVersion\)/);
  assert.match(service, /eq\(kayPromises\.reminderVersion, p\.reminderVersion\)/);
});

test("Phase D promises persist through reconciliation and request review on owner or lead change", () => {
  assert.match(service, /Promises are[\s\S]*instead of deletion/);
  assert.match(service, /NOT EXISTS\(SELECT 1 FROM crm_leads l WHERE l\.id=p\.lead_id AND l\.assigned_to=p\.employee_id\)/);
  assert.match(service, /PROMISE_OWNER_REVIEW_REQUIRED/);
  assert.match(schema, /ownerReviewRequiredAt: timestamp\("owner_review_required_at"\)/);
});

test("Phase D briefing copy is internal, localized, and acknowledgement is owner-scoped", () => {
  assert.match(formatBriefing({ name: "Amina", reason: "deadline passed", leadName: "Lead", action: "review", dueAt: new Date("2030-01-01T00:00:00Z") }, "en"), /Recommended action/);
  assert.match(formatBriefing({ name: "أمينة", reason: "تأخر الموعد", action: "راجعي" }, "ar"), /الإجراء المطلوب/);
  assert.match(service, /idempotencyKey: key/);
  assert.match(service, /eq\(kayInternalBriefings\.employeeId, employeeId\)/);
  assert.match(schema, /acknowledgedAt: timestamp\("acknowledged_at"\)/);
});

test("Phase D voice/personality fields deterministically change briefing text without truncating action", () => {
  const facts = { name: "Amina", reason: "deadline passed", action: "complete the detailed internal follow-up checklist" };
  const direct = formatBriefing(facts, "en", { ...defaultPhaseDSettings, call_style: "DIRECT", personality_toggles: { warm: false, encouraging: false, concise: true, empathetic: false }, max_brief_seconds: 30 });
  assert.match(direct, /^Action required now:/);
  assert.doesNotMatch(direct, /Thank you|You can complete|priorities can shift/);
  const supportive = formatBriefing(facts, "en", { ...defaultPhaseDSettings, call_style: "COACHING", personality_toggles: { warm: true, encouraging: true, concise: false, empathetic: true }, brief_length: "DETAILED", max_brief_seconds: 120 });
  assert.match(supportive, /^Next step coaching:/);
  assert.match(supportive, /Thank you for keeping this moving\./);
  assert.match(supportive, /You can complete this next step now\./);
  assert.match(supportive, /We understand priorities can shift\./);
  const capped = formatBriefing(facts, "en", { ...defaultPhaseDSettings, personality_toggles: { warm: true, encouraging: true, concise: false, empathetic: true }, brief_length: "DETAILED", max_brief_seconds: 5 });
  assert.match(capped, /complete the detailed internal follow-up checklist/);
  assert.ok(capped.split(/\s+/).length < supportive.split(/\s+/).length);
});

test("Phase D validates canonical voice fields and bounds", () => {
  assert.ok(phaseDSettingsSchema.safeParse({ ...defaultPhaseDSettings, preferred_voice_name: "Local voice", speech_rate: .5, speech_pitch: 2, max_brief_seconds: 5, call_style: "FRIENDLY" }).success);
  assert.ok(!phaseDSettingsSchema.safeParse({ ...defaultPhaseDSettings, speech_rate: 2.1 }).success);
  assert.ok(!phaseDSettingsSchema.safeParse({ ...defaultPhaseDSettings, speech_pitch: .4 }).success);
  assert.ok(!phaseDSettingsSchema.safeParse({ ...defaultPhaseDSettings, max_brief_seconds: 4 }).success);
  assert.ok(!phaseDSettingsSchema.safeParse({ ...defaultPhaseDSettings, call_style: "CASUAL" }).success);
  assert.match(service, /settings\.owner_address/);
});

test("Phase D local TTS stays in the browser and briefings advertise local voice only", () => {
  assert.match(routes, /localVoiceOnly: true/);
  assert.match(controlCenter, /"speechSynthesis" in window/);
  assert.match(controlCenter, /window\.speechSynthesis\.speak/);
  assert.doesNotMatch(service, /\b(sendWhatsApp|sendEmail|contactCustomer)\b/i);
});

test("Phase D settings, reviews, owner brief, and evaluator endpoints are admin-only", () => {
  for (const path of ["settings/phase-d", "owner-brief", "reviews", "evaluate-phase-d"]) {
    assert.match(routes, new RegExp(`/api/admin/kay/${path.replace("/", "\\/")}[^\\n]*", requireKayAdmin`));
  }
  assert.match(routes, /phaseDSettingsSchema\.safeParse\(req\.body\)/);
});

test("Phase D employee and admin route contracts are explicitly authorized", () => {
  for (const path of ["commitments", "promises", "briefings", "settings/phase-d"]) {
    assert.match(routes, new RegExp(`/api/kay/${path.replace("/", "\\/")}[^\\n]*", requireKayWorkspaceUser`));
  }
  for (const action of ["accept", "extend", "complete", "cancel"]) {
    assert.match(routes, new RegExp(`commitments/:id/${action}[^\\n]*", requireKayWorkspaceUser`));
  }
  assert.match(routes, /promises\/:id\/cancel", requireKayWorkspaceUser/);
  assert.match(routes, /missions\/:id\/cannot-handle", requireKayWorkspaceUser/);
  assert.match(routes, /reviews\/:id\/return", requireKayAdmin/);
  assert.match(service, /getEmployeePhaseDVoiceSettings[\s\S]*employeeSafePhaseDSettings/);
});

test("Phase D canonical settings round-trip and reject aliases", () => {
  const payload = {
    ...defaultPhaseDSettings,
    preferred_voice_name: "Browser Voice",
    speech_rate: 1.25,
    speech_pitch: 0.9,
    max_brief_seconds: 45,
    call_style: "COACHING" as const,
    owner_address: "Owner",
    employee_address_style: "FORMAL" as const,
    employee_profiles: {
      "17": { language: "ar" as const, address: "أحمد", style: "FIRM" as const, preferred_voice_name: "Arabic Voice" },
    },
  };
  assert.deepEqual(phaseDSettingsSchema.parse(payload), payload);
  assert.ok(!phaseDSettingsSchema.safeParse({ ...payload, voice_rate: 1 }).success);
  assert.ok(!phaseDSettingsSchema.safeParse({ ...payload, employee_overrides: [] }).success);
  assert.match(routes, /put\("\/api\/admin\/kay\/settings\/phase-d", requireKayAdmin[\s\S]*phaseDSettingsSchema\.safeParse\(req\.body\)/i);
});

test("Phase D employee settings expose only the current employee profile", () => {
  const settings = {
    ...defaultPhaseDSettings,
    employee_profiles: {
      "17": { language: "ar" as const, address: "أحمد", style: "FIRM" as const },
      "18": { language: "en" as const, address: "Private employee", style: "DIRECT" as const },
    },
  };
  const response = employeeSafePhaseDSettings(settings, 17);
  assert.equal(response.profile?.address, "أحمد");
  assert.ok(!("employee_profiles" in response));
  assert.doesNotMatch(JSON.stringify(response), /Private employee/);
});

test("Phase D evaluator writes are fenced by a locked current lease token", () => {
  assert.match(service, /fencedEvaluatorWrite[\s\S]*for\("update"\)/);
  assert.match(service, /value\?\.token !== token[\s\S]*PhaseDLeaseLostError/);
  assert.match(service, /evaluatePhaseD\(token: string/);
  assert.match(service, /if \(\(result as any\)\.aborted[\s\S]*aborted: "lease_lost"/);
  assert.match(service, /await fencedEvaluatorWrite\(token,[\s\S]*phase_d_health/);
});

test("Phase D owner brief counts current and compatibility lifecycle statuses", () => {
  assert.match(service, /status IN \('PENDING','DUE_SOON','OPEN'\)/);
  assert.match(service, /status IN \('PENDING','ACCEPTED','EXTENDED','ACTIVE'\)/);
  assert.match(service, /due_soon_promises/);
});

test("Phase D evaluator has an expiring singleton lease and always releases its token", () => {
  assert.match(service, /phase_d_evaluator_lease/);
  assert.match(service, /kay_runtime_state/);
  assert.match(service, /locked_until/);
  assert.doesNotMatch(service, /UPDATE kay_settings SET value=.*phase_d_evaluator_lease/);
  assert.match(service, /finally \{ clearInterval\(heartbeat\); await releasePhaseDLease\(token\);/);
});

test("Phase D has no CRM or customer-contact mutation path", () => {
  const phaseD = service.slice(service.indexOf("export async function createCommitment"));
  const phaseDBootstrap = bootstrap.slice(bootstrap.indexOf("-- Phase D is additive"), bootstrap.indexOf("`);", bootstrap.indexOf("-- Phase D is additive")));
  assert.doesNotMatch(phaseD, /\b(UPDATE|INSERT INTO|DELETE FROM)\s+crm_(leads|tasks)/i);
  assert.doesNotMatch(phaseD, /\b(sendWhatsApp|sendEmail|contactCustomer|assignLead|reassignLead)\b/i);
  assert.doesNotMatch(phaseDBootstrap, /\bUPDATE\s+crm_leads\b/i);
});