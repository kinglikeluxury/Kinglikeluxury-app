import test from "node:test";
import assert from "node:assert/strict";
import { canReadEmployeeScope, isApprovedEmployeeWaba } from "./whatsappEmployeeArchiveRoutes";

test("employee can read own active archive only", () => {
  assert.equal(canReadEmployeeScope(10, 10, true), true);
  assert.equal(canReadEmployeeScope(10, 10, false), false);
  assert.equal(canReadEmployeeScope(10, 11, true), false);
});

test("supervisor requires a live explicit grant scoped to that employee", () => {
  assert.equal(canReadEmployeeScope(2, 10, true, { active: true, canRead: true, employeeId: 10 }), true);
  assert.equal(canReadEmployeeScope(2, 10, true, { active: false, canRead: true, employeeId: 10 }), false);
  assert.equal(canReadEmployeeScope(2, 10, true, { active: true, canRead: false, employeeId: 10 }), false);
  assert.equal(canReadEmployeeScope(2, 10, true, { active: true, canRead: true, employeeId: 11 }), false);
});

test("revoked consent blocks owner and supervisor reads immediately", () => {
  assert.equal(canReadEmployeeScope(10, 10, false), false);
  assert.equal(canReadEmployeeScope(2, 10, false, { active: true, canRead: true, employeeId: 10 }), false);
});

test("employee business-account allowlist fails closed and excludes unconfigured Test WABA IDs", () => {
  assert.equal(isApprovedEmployeeWaba("123456", ""), false);
  assert.equal(isApprovedEmployeeWaba("123456", "123456,789012"), true);
  assert.equal(isApprovedEmployeeWaba("999999", "123456,789012"), false);
  assert.equal(isApprovedEmployeeWaba("bad-id", "bad-id"), false);
});
