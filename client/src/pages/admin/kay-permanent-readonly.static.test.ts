import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync(new URL("./kay-control-center.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./kay-my-sales.tsx", import.meta.url), "utf8");

test("Kay control center exposes the permanent read-only CRM boundary", () => {
  assert.match(ui, /KAY CRM ACCESS: READ ONLY/);
  assert.match(ui, /FROZEN_NO_EXECUTION/);
  assert.match(ui, /authorized human.*normal CRM/i);
  assert.match(ui, /Open Lead in CRM/);
  assert.match(ui, /`\/admin\/crm\/\$\{rescuePreview\.lead\.id\}`/);
});

test("Kay control center cannot send a CRM-changing request", () => {
  assert.doesNotMatch(ui, /apiRequest\(\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(ui, /\/rescue\/execute/);
  assert.doesNotMatch(ui, /\/undo/);
  assert.doesNotMatch(ui, /Override target employee/);
  assert.doesNotMatch(ui, /Approve rescue/);
  assert.doesNotMatch(ui, /Manually run cycle/);
});

test("Kay recommendation history remains visible and copyable", () => {
  assert.match(ui, /Historical execution records/);
  assert.match(ui, /history\.map/);
  assert.match(ui, /Copy recommendation/);
  assert.match(ui, /Preserved for audit/);
});

test("Kay workspace sends rescue decisions to the normal CRM, not a Kay rescue endpoint", () => {
  assert.match(workspace, /Permanent Kay rule/);
  assert.match(workspace, /href=\{`\/admin\/crm\/\$\{mission\.leadId\}`\}/);
  assert.doesNotMatch(workspace, /auto-rescue\/.*last-chance/);
  assert.doesNotMatch(workspace, /CONTACT_NOW|NEED_30_MINUTES|CANNOT_HANDLE/);
});