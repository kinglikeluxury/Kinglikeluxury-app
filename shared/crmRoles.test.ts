import assert from "node:assert/strict";
import test from "node:test";
import { canAccessCrmLead, isCrmEmployeeRole } from "./crmRoles";

test("only CRM staff roles enter the CRM", () => {
  assert.equal(isCrmEmployeeRole("crm_employee"), true);
  assert.equal(isCrmEmployeeRole("sub_agent"), true);
  assert.equal(isCrmEmployeeRole("user"), false);
});

test("non-admin CRM access is limited to the assigned employee", () => {
  assert.equal(canAccessCrmLead(false, 7, 7), true);
  assert.equal(canAccessCrmLead(false, 7, 8), false);
  assert.equal(canAccessCrmLead(false, 7, null), false);
  assert.equal(canAccessCrmLead(true, 7, 8), true);
});
