import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultPhaseCSettings, kayAvailabilitySchema, missionPrioritySchema, phaseCSettingsSchema } from "./kayMissionService";

const service = readFileSync(new URL("./kayMissionService.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const db = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const scopeFence = readFileSync(new URL("./kayMissionScopeFenceSql.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../client/src/pages/admin/kay-my-sales.tsx", import.meta.url), "utf8");

// C.1 unit/contract suite: these protect the safety boundaries without needing
// a live CRM. Database concurrency behavior is covered by the companion suite.
test("C1 cadence default is five minutes", () => assert.equal(defaultPhaseCSettings.mission_generation_interval_minutes, 5));
test("C1 cadence accepts one minute", () => assert.ok(phaseCSettingsSchema.safeParse({...defaultPhaseCSettings, mission_generation_interval_minutes:1}).success));
test("C1 cadence accepts sixty minutes", () => assert.ok(phaseCSettingsSchema.safeParse({...defaultPhaseCSettings, mission_generation_interval_minutes:60}).success));
test("C1 cadence rejects zero", () => assert.ok(!phaseCSettingsSchema.safeParse({...defaultPhaseCSettings, mission_generation_interval_minutes:0}).success));
test("C1 cadence rejects sixty-one", () => assert.ok(!phaseCSettingsSchema.safeParse({...defaultPhaseCSettings, mission_generation_interval_minutes:61}).success));
test("C1 notifications default enabled", () => assert.equal(defaultPhaseCSettings.mission_notifications_enabled, true));
test("C1 quiet hours default disabled", () => assert.equal(defaultPhaseCSettings.quiet_hours_enabled, false));
test("C1 quiet hour valid time accepted", () => assert.ok(phaseCSettingsSchema.safeParse({...defaultPhaseCSettings,quiet_hours_enabled:true,quiet_hours_start:"22:00",quiet_hours_end:"07:00"}).success));
test("C1 quiet hour invalid time rejected", () => assert.ok(!phaseCSettingsSchema.safeParse({...defaultPhaseCSettings,quiet_hours_start:"25:00"}).success));
test("C1 availability values are explicit", () => ["AVAILABLE","BUSY","DO_NOT_ASSIGN","LEAVE"].forEach(x=>assert.ok(kayAvailabilitySchema.safeParse(x).success)));
test("C1 arbitrary availability rejected", () => assert.ok(!kayAvailabilitySchema.safeParse("OFFLINE").success));
test("C1 priority enum retains high and critical", () => ["HIGH","CRITICAL"].forEach(x=>assert.ok(missionPrioritySchema.safeParse(x).success)));
test("C1 scheduler is gated by environment", () => assert.match(index, /if \(schedulersEnabled\)[\s\S]*startKayMissionGenerator/));
test("C1 scheduler start is delayed", () => assert.match(service, /setTimeout\(run, 10_000\)/));
test("C1 scheduler uses configured cadence", () => assert.match(service, /mission_generation_interval_minutes \* 60_000/));
test("C1 automatic cycles have a bounded batch", () => assert.match(service, /generateKayMissions\(200, "automatic"\)/));
test("C1 generator keeps expiring singleton lease", () => assert.match(service, /locked_until/));
test("C1 lease JSON parameters have deterministic PostgreSQL types", () => {
  assert.match(service, /'token',\$\{token\}::text/);
  assert.match(service, /'locked_until',\$\{lockedUntil\}::timestamptz/);
  assert.match(service, /'released_at',\$\{new Date\(\)\.toISOString\(\)\}::timestamptz/);
});
test("C1 lease is released safely", () => assert.match(service, /finally \{[\s\S]*releaseKayMissionGeneratorLease/));
test("C1 lease safely validates malformed timestamps before cast", () => { assert.match(service, /CASE[\s\S]*locked_until[\s\S]*~[\s\S]*timestamptz[\s\S]*ELSE to_timestamp\(0\)/); });
test("C1 circuit opens after repeated failures", () => assert.match(service, /failures >= 3/));
test("C1 circuit-open path schedules only through finally", () => {
  assert.doesNotMatch(service, /circuit_open" \}\); return schedule\(\)/);
  assert.match(service, /finally \{ await schedule\(\); \}/);
});
test("C1 success resets failure counter", () => assert.match(service, /consecutive_failures: 0/));
test("C1 health state is persisted", () => assert.match(service, /phase_c_generator_health/));
test("C1 stale warning uses three intervals", () => assert.match(service, /mission_generation_interval_minutes \* 3/));
test("C1 manual and automatic runs are distinguished", () => assert.match(service, /last_manual_run/));
test("C1 health reads scheduler gate", () => assert.match(service, /ENABLE_BACKGROUND_SCHEDULERS === "true"/));
test("C1 only high critical enter notification query", () => assert.match(service, /priority IN \('CRITICAL','HIGH'\)/));
test("C1 notifications claim version before marker and in-app insert", () => assert.match(service, /const claimed = await tx\.update[\s\S]*if \(!claimed\[0\]\)[\s\S]*tx\.insert\(kayEvents\)[\s\S]*tx\.insert\(userNotifications\)/));
test("C1 notification version is persisted", () => assert.match(schema, /notificationVersion/));
test("C1 operational mission paths share fail-closed assignment scope", () => {
  assert.match(service, /getKayMissionScope/);
  assert.match(service, /candidateScope\.outcome !== "IN_KAY_SCOPE"/);
  assert.match(service, /holdsKayMissionScopeFence/);
  assert.match(service, /scope === "IN_KAY_SCOPE"/);
});
test("C1 generation, notification, and transition hold the database scope fence", () => {
  assert.match(service, /holdsKayMissionScopeFence/);
  assert.equal((service.match(/await holdsKayMissionScopeFence\(tx/g) || []).length, 3);
  assert.match(scopeFence, /kay_lock_mission_scope[\s\S]*FOR SHARE[\s\S]*assigned_to IS DISTINCT FROM p_employee_id/);
  assert.match(scopeFence, /REVOKE ALL ON FUNCTION public\.kay_lock_mission_scope[\s\S]*GRANT EXECUTE[\s\S]*kay_internal_writer/);
  assert.match(db, /client\.query\(KAY_MISSION_SCOPE_FENCE_SQL\)/);
});
test("C1 notification deep link targets mission workspace", () => assert.match(service, /deepLink: `\/admin\/kay\/my-sales\?mission=/));
test("C1 repeated notification dedupe tracks sent level", () => assert.match(service, /notification_level IS DISTINCT FROM m\.priority/));
test("C1 quiet hours defer instead of deleting missions", () => { assert.match(service, /isKayQuietHours/); assert.doesNotMatch(service, /DELETE FROM kay_missions/); });
test("C1 availability changes are audited", () => assert.match(service, /mission_availability_changed/));
test("C1 employees update only their own availability", () => assert.match(routes, /setKayAvailability\(req\.session\.userId, parsed\.data, req\.session\.userId\)/));
test("C1 admin availability override is separately protected", () => assert.match(routes, /admin\/kay\/employees\/:employeeId\/availability", requireKayAdmin/));
test("C1 employee cannot access admin health endpoint", () => assert.match(routes, /admin\/kay\/control", requireKayAdmin/));
test("C1 next hour remains bounded", () => assert.match(routes, /slice\(0, settings\.max_next_60_minutes_items\)/));
test("C1 employee workspace refreshes on focus", () => assert.match(client, /addEventListener\("focus", refresh\)/));
test("C1 manual generation remains admin only", () => assert.match(routes, /missions\/generate", requireKayAdmin/));
test("C1 migration is additive for notification state", () => assert.match(db, /ADD COLUMN IF NOT EXISTS notification_sent_at/));