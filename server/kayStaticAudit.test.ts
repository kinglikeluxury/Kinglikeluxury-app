import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Kay Phase A modules contain no CRM mutation or customer-contact path", () => {
  const files = ["server/kayService.ts", "server/kayAuth.ts"];
  const forbidden = [
    /\bcrmLeads\b/,
    /\b(sendWhatsApp|sendEmail|Twilio|whatsapp|contactCustomer)\b/i,
    /\b(assignLead|reassignLead|createRescue|sendFollowUp)\b/i,
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${file} must remain observation-only`);
    }
  }
});

test("Kay lead-created hook is post-commit, non-blocking, response-preserving, and singular", () => {
  const source = readFileSync("server/routes.ts", "utf8");
  const routeStart = source.indexOf('app.post("/api/admin/crm/leads"');
  const routeEnd = source.indexOf("// ── CRM Export / Import", routeStart);
  const route = source.slice(routeStart, routeEnd);
  const commit = route.indexOf("const { lead, autoAssignedTo } = await db.transaction");
  const observation = route.indexOf('void import("./kayService")');
  const response = route.indexOf("res.status(201).json(lead)");
  assert.ok(commit >= 0 && observation > commit && response > observation);
  assert.equal(route.match(/safelyObserveLeadCreated/g)?.length, 2);
  assert.doesNotMatch(route.slice(observation, response), /await\s+safelyObserveLeadCreated/);
});

test("Kay schema bootstrap is additive, shadow-defaulted, idempotent, and non-cascading", () => {
  const source = readFileSync("server/db.ts", "utf8");
  const start = source.indexOf("export async function ensureKayTables");
  const end = source.indexOf("/**", start + 10);
  const kayBootstrap = source.slice(start, end);
  assert.match(kayBootstrap, /INSERT INTO kay_settings[\s\S]*"shadow"/);
  assert.match(kayBootstrap, /ON CONFLICT \(key\) DO NOTHING/);
  assert.match(kayBootstrap, /idempotency_key/);
  assert.doesNotMatch(kayBootstrap, /\b(DROP|TRUNCATE|RENAME)\b/i);
  assert.doesNotMatch(kayBootstrap, /ON DELETE CASCADE/i);
  assert.match(kayBootstrap, /ON DELETE SET NULL/);
});

test("Kay mode changes use one transaction and lock the authoritative setting row", () => {
  const source = readFileSync("server/kayService.ts", "utf8");
  const start = source.indexOf("const runKayModeTransaction");
  const end = source.indexOf("export function createKayModeUpdater", start);
  const updater = source.slice(start, end);
  assert.match(updater, /db\.transaction/);
  assert.match(updater, /\.for\("update"\)/);
  assert.match(updater, /previousValue/);
  assert.match(updater, /newValue/);
  assert.match(updater, /userId:\s*updatedBy/);
  assert.match(updater, /createdAt:\s*changedAt/);
});

test("Kay admin inspection data is bounded and sanitized", () => {
  const source = readFileSync("server/kayService.ts", "utf8");
  const snapshot = source.slice(source.indexOf("export async function getKayControlSnapshot"));
  assert.equal(snapshot.match(/\.limit\(30\)/g)?.length, 2);
   assert.ok((snapshot.match(/sanitizeKayJson/g)?.length ?? 0) >= 3);
});