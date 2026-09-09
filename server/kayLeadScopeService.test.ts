import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KAY_OPERATIONAL_LAUNCH_AT, buildKayScopeConfig, classifyKayLead,
  kayCalendarMonthsBefore,
} from "./kayLeadScopeService";

const config = buildKayScopeConfig(KAY_OPERATIONAL_LAUNCH_AT)!;
const sales = { username: "future_salesperson", role: "sub_agent", isActive: true, isAdmin: false };
const lead = (date: string, owner: any = sales, extra: any = {}) =>
  ({ createdAt: date, owner, leadSource: "manual", ...extra });

test("Kay exact fixed cutoff is calendar arithmetic in Asia/Tbilisi", () => {
  assert.equal(config.cutoffAt.toISOString(), "2026-06-08T20:00:00.000Z");
  assert.equal(kayCalendarMonthsBefore(new Date("2026-09-09T00:00:00+04:00"), 3).toISOString(), config.cutoffAt.toISOString());
  assert.equal(config.timezone, "Asia/Tbilisi");
});
test("one instant before cutoff is legacy and exact cutoff is in scope", () => {
  assert.equal(classifyKayLead(lead("2026-06-08T19:59:59.999Z"), config), "OUT_OF_SCOPE_LEGACY");
  assert.equal(classifyKayLead(lead("2026-06-08T20:00:00.000Z"), config), "IN_KAY_SCOPE");
});
test("after cutoff, post-launch, and years later remain in scope", () => {
  for (const date of ["2026-06-09T00:00:00Z", "2026-09-09T00:00:00Z", "2032-01-01T00:00:00Z"]) {
    assert.equal(classifyKayLead(lead(date), config), "IN_KAY_SCOPE");
  }
});
test("status changes do not change the fixed cohort", () => {
  const old = lead("2026-01-01T00:00:00Z");
  assert.equal(classifyKayLead(old, config), "OUT_OF_SCOPE_LEGACY");
  assert.equal(classifyKayLead({ ...old, status: "interested" } as any, config), "OUT_OF_SCOPE_LEGACY");
});
test("recent admin and system owners are excluded regardless of date", () => {
  assert.equal(classifyKayLead(lead("2026-08-01T00:00:00Z", { ...sales, username: "kinglike_admin", isAdmin: true }), config), "EXCLUDED_OWNER");
  assert.equal(classifyKayLead(lead("2026-08-01T00:00:00Z", { username: "system", role: "system", isActive: true }), config), "EXCLUDED_OWNER");
});
test("old eligible salesperson stays historical", () => {
  assert.equal(classifyKayLead(lead("2026-05-01T00:00:00Z"), config), "OUT_OF_SCOPE_LEGACY");
});
test("import-like dates fail closed without trusted original date", () => {
  assert.equal(classifyKayLead(lead("2026-08-01T00:00:00Z", sales, { leadSource: "excel_import" }), config), "LEGACY_DATE_UNCERTAIN");
  assert.equal(classifyKayLead(lead("2026-08-01T00:00:00Z", sales, { leadSource: "admin_alias_data" }), config), "LEGACY_DATE_UNCERTAIN");
});
test("trusted original business date overrides migration creation date", () => {
  assert.equal(classifyKayLead(lead("2026-08-01T00:00:00Z", sales, {
    leadSource: "excel_import", businessReceivedAt: "2026-05-01T00:00:00Z", businessReceivedAtSource: "ORIGINAL_BUSINESS_TIMESTAMP",
  }), config), "OUT_OF_SCOPE_LEGACY");
});
test("unknown business date provenance remains uncertain", () => {
  assert.equal(classifyKayLead({ ...lead("2026-07-01T00:00:00Z"), leadSource: "excel_import", businessReceivedAt: "2026-07-01T00:00:00Z", businessReceivedAtSource: "ARBITRARY" }, config), "LEGACY_DATE_UNCERTAIN");
});
test("missing and invalid configuration fail closed", () => {
  assert.equal(classifyKayLead(lead("2026-08-01T00:00:00Z"), null), "CONFIGURATION_MISSING");
  assert.equal(buildKayScopeConfig("2026-09-09T00:00:00Z"), null);
  assert.equal(buildKayScopeConfig("2026-09-09T00:00:00+03:00"), null);
});
test("arbitrary future active sub_agent is eligible without name allowlist", () => {
  assert.equal(classifyKayLead(lead("2026-10-01T00:00:00Z", { username: "new_hire_204", role: "sub_agent", isActive: true, isAdmin: false }), config), "IN_KAY_SCOPE");
});
test("inactive, admin, and non-sales owners are excluded", () => {
  for (const owner of [
    { ...sales, isActive: false }, { ...sales, isAdmin: true }, { ...sales, role: "admin" },
  ]) assert.equal(classifyKayLead(lead("2026-08-01T00:00:00Z", owner), config), "EXCLUDED_OWNER");
});
test("admin mutation is explicitly confirmed and protected by Kay admin middleware", () => {
  const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  assert.match(routes, /app\.put\("\/api\/admin\/kay\/settings\/operational-scope", requireKayAdmin/);
  assert.match(routes, /req\.body\?\.confirmChange === true/);
  const service = readFileSync(new URL("./kayLeadScopeService.ts", import.meta.url), "utf8");
  assert.match(service, /Changing the operational launch date requires explicit confirmation/);
  assert.match(service, /kay_operational_launch_audit/);
});