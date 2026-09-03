import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateMissionPriority, completionResultSchema, defaultPhaseCSettings, dismissalReasonSchema, missionStatusSchema, missionTypeSchema, phaseCSettingsSchema } from "./kayMissionService";
import { getKayStatusIntelligence } from "./kayStatusClassification";

const score = (signals: any) => calculateMissionPriority(signals);
test("C priority protected closing overdue is critical", () => assert.equal(score({ protected:true, closing:true, overdueTask:true }).priority, "CRITICAL"));
test("C priority score is capped", () => assert.equal(score({protected:true,closing:true,hot:true,overdueTask:true,rescueEligible:true,rescueRisk:true,unprotected:true,dueWithin60:true}).score, 100));
test("C priority high threshold", () => assert.equal(score({ closing:true, hot:true }).priority, "HIGH"));
test("C priority normal threshold", () => assert.equal(score({ hot:true }).priority, "NORMAL"));
test("C priority low threshold", () => assert.equal(score({}).priority, "LOW"));
test("C priority exposes factor explanation", () => assert.deepEqual(score({protected:true}).factors[0], {code:"protected",label:"Protected lead",points:25}));
test("C priority has a fixed formula version", () => assert.equal(score({}).version, "phase_c_v1"));
test("C workflow default is bounded", () => assert.equal(defaultPhaseCSettings.max_next_60_minutes_items, 6));
test("C settings accepts min max next-hour limit", () => assert.equal(phaseCSettingsSchema.safeParse({...defaultPhaseCSettings,max_next_60_minutes_items:1}).success, true));
test("C settings accepts maximum next-hour limit", () => assert.equal(phaseCSettingsSchema.safeParse({...defaultPhaseCSettings,max_next_60_minutes_items:8}).success, true));
test("C settings rejects excessive next-hour limit", () => assert.equal(phaseCSettingsSchema.safeParse({...defaultPhaseCSettings,max_next_60_minutes_items:9}).success, false));
test("C settings rejects arbitrary formula", () => assert.equal(phaseCSettingsSchema.safeParse({...defaultPhaseCSettings,priority_formula_version:"custom"}).success, false));
test("C settings rejects unsafe extra properties", () => assert.equal(phaseCSettingsSchema.safeParse({...defaultPhaseCSettings,execute:true}).success, false));
test("C all mission lifecycle states are explicit", () => assert.equal(missionStatusSchema.safeParse("STALE").success, true));
test("C unsupported mission type is rejected", () => assert.equal(missionTypeSchema.safeParse("CONTACT_NOW").success, false));
test("C supported follow-up mission type is accepted", () => assert.equal(missionTypeSchema.safeParse("FOLLOW_UP_DUE").success, true));
test("C dismissal requires an enum reason", () => assert.equal(dismissalReasonSchema.safeParse("OTHER").success, true));
test("C invalid dismissal reason rejected", () => assert.equal(dismissalReasonSchema.safeParse("ignored").success, false));
test("C completion outcome is Kay-only enum", () => assert.equal(completionResultSchema.safeParse("NO_ANSWER").success, true));
test("C status intelligence excludes terminal", () => assert.equal(getKayStatusIntelligence("purchased").terminal, true));
test("C status intelligence excludes non-sales", () => assert.equal(getKayStatusIntelligence("broker").classification, "NON_SALES"));
test("C status intelligence excludes unknown", () => assert.equal(getKayStatusIntelligence("future").classification, "UNKNOWN_REVIEW"));
test("C rescue type uses B1 no-answer status", () => assert.equal(getKayStatusIntelligence("no_answer_1").rescueEvaluated, true));

const service = readFileSync(new URL("./kayMissionService.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
const db = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../client/src/pages/admin/kay-my-sales.tsx", import.meta.url), "utf8");
test("C direct other mission ID fails closed against current owner", () => {
  assert.match(service, /m\.employee_id=\$\{actorId\} AND l\.assigned_to=\$\{actorId\}/);
  assert.match(service, /u\.role='sub_agent'/);
});
test("C non-admin list is forced to employee id using live role", () => assert.match(routes, /listKayMissions\(req\.session\.userId, !!req\.kayIsAdmin/));
test("C admin list supports company-wide scope", () => assert.match(service, /if \(!admin\) filters\.push/));
test("C generation has unique idempotency key", () => assert.match(schema, /idempotencyKeyUnique/));
test("C database has unique mission key", () => assert.match(db, /idempotency_key TEXT NOT NULL UNIQUE/));
test("C generator uses conflict-safe inserts", () => assert.match(service, /onConflictDoNothing\(\)\.returning/));
test("C reconciliation marks stale instead of deleting", () => { assert.match(service, /status: "STALE"/); assert.doesNotMatch(service, /delete\(kayMissions\)|DELETE FROM kay_missions/); });
test("C owner changes stale active missions", () => assert.match(service, /l\.assigned_to=m\.employee_id/));
test("C task ambiguity is explicitly NEEDS_REVIEW", () => assert.match(service, /task_classification.*NEEDS_REVIEW/));
test("C completion does not update CRM", () => { assert.doesNotMatch(service, /update\(crmLeads\)|UPDATE crm_leads/i); assert.match(service, /crm_status_unchanged/); });
test("C no customer communication path exists", () => assert.doesNotMatch(service, /sendWhatsApp|sendEmail|Twilio|fetch\(/));
test("C transitions are audited in kay_events", () => assert.match(service, /eventType: `mission_\$\{action\}`/));
test("C transition validation is compare-and-set", () => assert.match(service, /inArray\(kayMissions\.status, allowed\[action\]/));
test("C scheduler is existing gate only", () => { assert.match(routes, /missions\/generate", requireKayAdmin/); assert.match(readFileSync(new URL("./index.ts", import.meta.url),"utf8"), /if \(schedulersEnabled\)[\s\S]*startKayMissionGenerator/); });
test("C next-hour API uses configured bound", () => assert.match(routes, /slice\(0, settings\.max_next_60_minutes_items\)/));
test("C empty next-hour state is supportive", () => assert.match(client, /You are clear for the next hour/));
test("C UI has all requested named sections", () => ["Priority Queue","Rescue Risk","Follow-ups","Unprotected Opportunities","Kay Missions","Completed Today"].forEach(x => assert.match(client, new RegExp(x))));
test("C open lead is link only", () => assert.match(client, /href=\{`\/admin\/crm\/\$\{mission\.leadId\}`\}/));
test("C detail query joins current owner rather than list-plus-JS lookup", () => { assert.match(service, /l\.assigned_to=\$\{actorId\}/); assert.match(routes, /getKayMission\(id, req\.session\.userId/); });
test("C transition locks mission and current CRM lead", () => assert.match(service, /FOR UPDATE OF m,l/));
test("C transition audit and CAS share a transaction", () => { assert.match(service, /const outcome = await db\.transaction/); assert.match(service, /beforeStatus.*afterStatus/); });
test("C deterministic candidate order and pooler-safe generator lease exist", () => {
  assert.match(service, /phase_c_generator_lease/);
  assert.match(service, /locked_until/);
  assert.match(service, /releaseKayMissionGeneratorLease\(leaseToken\)/);
  assert.match(service, /ORDER BY l\.id ASC LIMIT/);
});
test("C creation event is idempotently keyed", () => assert.match(service, /mission_created:\$\{key\}/));
test("C in-app notification is retryable, atomic, and failure isolated", () => {
  assert.match(service, /mission_notifications_enabled/);
  assert.match(service, /deliverPendingKayMissionNotifications/);
  assert.match(service, /notification_level IS DISTINCT FROM m\.priority/);
  assert.match(service, /await db\.transaction\(async tx => \{[\s\S]*FOR UPDATE OF m,l,u,a[\s\S]*const claimed[\s\S]*tx\.insert\(userNotifications\)/);
  assert.match(service, /notification skipped/);
});
test("C notification retries are independent of newly inserted missions", () => {
  assert.match(service, /await deliverPendingKayMissionNotifications\(settings\)/);
  assert.doesNotMatch(service, /if \(inserted\)[\s\S]{0,800}mission_notification:/);
});
test("C database constrains mission priorities while mission types remain additive", () => {
  assert.doesNotMatch(db, /kay_missions_type_check/);
  assert.match(db, /kay_missions_priority_check/);
});
test("C next sixty minutes excludes overdue, null, and beyond-hour due dates", () => {
  assert.match(routes, /mission\.dueAt && new Date\(mission\.dueAt\)\.getTime\(\) >= now && new Date\(mission\.dueAt\)\.getTime\(\) <= nextHour/);
});
test("C stale mission updates and audits are atomic", () => {
  assert.match(service, /const changed = await db\.transaction\(async tx =>/);
  assert.match(service, /const stale = await db\.transaction\(async tx =>/);
});
test("C admin snapshot has bounded mission inspection", () => { assert.match(service, /getKayMissionInspection/); assert.match(service, /LIMIT 50/); });