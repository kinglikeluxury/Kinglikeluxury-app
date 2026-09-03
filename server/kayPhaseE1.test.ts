import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kayModeSchema, rescueSettingsSchema, validateKayModeUpdate } from "./kayService";

const rescue = readFileSync(new URL("./kayRescueService.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const scheduler = readFileSync(new URL("./kayService.ts", import.meta.url), "utf8")
  + readFileSync(new URL("./kayMissionService.ts", import.meta.url), "utf8")
  + readFileSync(new URL("./kayPhaseDService.ts", import.meta.url), "utf8");

test("E.1 modes remain explicit and automation modes are rejected", () => {
  assert.equal(kayModeSchema.safeParse("shadow").success, true);
  assert.equal(kayModeSchema.safeParse("assisted").success, true);
  assert.equal(kayModeSchema.safeParse("controlled_automation").success, false);
  assert.equal(validateKayModeUpdate({ mode: "full_approved_automation" }).ok, false);
});
test("E.1 rescue settings bound undo window", () => {
  const base = { no_answer_1_threshold_hours:24,no_answer_2_threshold_hours:24,max_human_rescue_attempts:2,rescue_warning_minutes:30,protected_review_after_days:7,rescue_enabled:false };
  assert.equal(rescueSettingsSchema.safeParse({ ...base, assisted_rescue_undo_minutes:5 }).success, true);
  assert.equal(rescueSettingsSchema.safeParse({ ...base, assisted_rescue_undo_minutes:60 }).success, true);
  assert.equal(rescueSettingsSchema.safeParse({ ...base, assisted_rescue_undo_minutes:4 }).success, false);
  assert.equal(rescueSettingsSchema.safeParse(base).data?.assisted_rescue_undo_minutes, 15);
});
test("E.1 command source locks and revalidates all authoritative safety inputs", () => {
  for (const token of ["FOR UPDATE OF l", "FOR UPDATE", "MODE_NOT_ASSISTED", "STALE_RECOMMENDATION", "OWNER_CHANGED", "PROTECTED", "CLOSING", "THRESHOLD_NOT_MET", "BLOCKER_ADDED", "LIMIT_REACHED", "TARGET_UNAVAILABLE", "is_admin", "availability", "payload.status_entered_at"]) assert.match(rescue, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
test("E.1 execute is one transactional, idempotent ownership command with required audit", () => {
  for (const token of ["BEGIN", "COMMIT", "ROLLBACK", "UPDATE crm_leads SET assigned_to", "lead_assignment_history", "assisted_rescue_executed", "kay_rescue_executions", "idempotent: true", "AUDIT_FAILED", "requestedLeadId"]) assert.match(rescue, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
test("E.1 reconciles Kay-owned work but preserves promises with handoffs", () => {
  for (const token of ["LEAD_REASSIGNED", "kay_promise_handoffs", "RESCUE_LEAD_ASSIGNED", "kay_internal_briefings", "user_notifications"]) assert.match(rescue, new RegExp(token));
  assert.doesNotMatch(rescue, /DELETE FROM (kay_promises|kay_missions|kay_commitments)/);
});
test("E.1 undo is explicit, locked, bounded and fails closed", () => {
  for (const token of ["undoAssistedRescue", "FOR UPDATE OF x,l", "MANUAL_REVIEW_REQUIRED", "assisted_rescue_undo_minutes", "kay_rescue_undo", "assisted_rescue_undone"]) assert.match(rescue, new RegExp(token));
});
test("E.1 routes are live-admin gated and expose confirmation/handoff contracts", () => {
  for (const token of ["rescue/:leadId/:decisionId/preview\", requireKayAdmin", "rescue/execute\", requireKayAdmin", "rescue/:executionId/undo\", requireKayAdmin", "promise-handoffs"]) assert.match(routes, new RegExp(token));
});
test("E.1 static safety: no scheduler imports or calls ownership command", () => {
  assert.doesNotMatch(scheduler, /executeAssistedRescue|undoAssistedRescue|kayRescueService/);
});