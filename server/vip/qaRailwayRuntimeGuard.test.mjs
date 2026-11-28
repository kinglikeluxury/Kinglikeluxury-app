import assert from "node:assert/strict";
import {test} from "node:test";
import {qaBootstrapPrivilegesPresent} from "./qaRailwayRuntimeGuard.mjs";

test("runtime launch refuses bootstrap flags and setup credentials",()=>{
  assert.equal(qaBootstrapPrivilegesPresent({}),false);
  assert.equal(qaBootstrapPrivilegesPresent({
    KINGLIKE_VIP_QA_BOOTSTRAP_EXECUTE:"false",
    KINGLIKE_VIP_QA_BOOTSTRAP_APPROVED:"false",
    KINGLIKE_VIP_QA_BOOTSTRAP_ADMIN_DATABASE_URL:"",
  }),false);
  assert.equal(qaBootstrapPrivilegesPresent({
    KINGLIKE_VIP_QA_BOOTSTRAP_EXECUTE:"true",
  }),true);
  assert.equal(qaBootstrapPrivilegesPresent({
    KINGLIKE_VIP_QA_PROVISION_MIGRATOR_PASSWORD:"synthetic-only",
  }),true);
  assert.equal(qaBootstrapPrivilegesPresent({
    KINGLIKE_VIP_QA_LOGIN_FINANCE_PASSWORD:"synthetic-only",
  }),false);
  assert.equal(qaBootstrapPrivilegesPresent({
    KINGLIKE_VIP_QA_BOOTSTRAP_ADMIN_DATABASE_URL:"__DISABLED__",
    KINGLIKE_VIP_QA_PROVISION_MIGRATOR_PASSWORD:"__DISABLED__",
  }),false);
});
