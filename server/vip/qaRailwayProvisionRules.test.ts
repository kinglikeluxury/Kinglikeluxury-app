import {strict as assert} from "node:assert";
import {test} from "node:test";
import {
  qaRuntimePrivilegesForTable,
  quoteQaSqlIdentifier,
  validateQaProvisionConfig,
} from "./qaRailwayProvisionRules";

const passwords={
  admin:"SynthQaAdmin-2026!Strong",
  buyer:"SynthQaBuyer-2026!Strong",
  seller:"SynthQaSeller-2026!Strong",
  finance:"SynthQaFinance-2026!Strong",
};
const local=()=>({
  PATH:"/usr/bin",HOME:"/tmp",TMPDIR:"/tmp",NODE_ENV:"test",
  KINGLIKE_VIP_QA_PROVISION_EXECUTE:"true",
  KINGLIKE_VIP_QA_PROVISION_MODE:"local-test",
  KINGLIKE_VIP_QA_PROVISION_APPROVED:"true",
  KINGLIKE_VIP_QA_MIGRATION_DATABASE_URL:
    "postgresql://vipqa_migrator:synthetic-local-only@127.0.0.1:55432/vipqa_demo",
  KINGLIKE_VIP_QA_PROVISION_HOST:"127.0.0.1",
  KINGLIKE_VIP_QA_PROVISION_DATABASE:"vipqa_demo",
  KINGLIKE_VIP_QA_PROVISION_MIGRATOR_ROLE:"vipqa_migrator",
  KINGLIKE_VIP_QA_PROVISION_RUNTIME_ROLE:"vipqa_runtime",
  KINGLIKE_VIP_QA_PROVISION_ADDRESS:"127.0.0.1",
  KINGLIKE_VIP_QA_PROVISION_ENVIRONMENT_ID:"a45d1f9e-4a24-4c84-99bc-90b48e2d41c7",
  VIP_QA_LOCAL_TEST:"true",
  VIP_QA_EXPECTED_DATA_DIRECTORY:"/tmp/kinglike-vip-pg-qa-provision",
  VIP_QA_EXPECTED_PORT:"55432",
  KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD:passwords.admin,
  KINGLIKE_VIP_QA_PROVISION_BUYER_PASSWORD:passwords.buyer,
  KINGLIKE_VIP_QA_PROVISION_SELLER_PASSWORD:passwords.seller,
  KINGLIKE_VIP_QA_PROVISION_FINANCE_PASSWORD:passwords.finance,
});

test("local provisioning requires an explicitly approved loopback-only temporary database",()=>{
  const parsed=validateQaProvisionConfig(local());
  assert.equal(parsed.mode,"local-test");
  assert.equal(parsed.database,"vipqa_demo");
  assert.equal(parsed.migratorRole,"vipqa_migrator");
  assert.equal(parsed.runtimeRole,"vipqa_runtime");
  assert.equal(parsed.port,55432);
  assert.throws(()=>validateQaProvisionConfig({...local(),DATABASE_URL:"postgres://outside/db"}));
  assert.throws(()=>validateQaProvisionConfig({
    ...local(),
    KINGLIKE_VIP_QA_MIGRATION_DATABASE_URL:
      "postgresql://vipqa_migrator:x@neon.invalid/vipqa_demo",
    KINGLIKE_VIP_QA_PROVISION_HOST:"neon.invalid",
  }));
  assert.throws(()=>validateQaProvisionConfig({
    ...local(),KINGLIKE_VIP_QA_PROVISION_ADDRESS:"10.0.0.2",
  }));
});

test("hosted provisioning is pinned to a Railway private QA identity only",()=>{
  const railway={
    PATH:"/usr/bin",HOME:"/tmp",NODE_ENV:"production",
    KINGLIKE_VIP_QA_PROVISION_EXECUTE:"true",
    KINGLIKE_VIP_QA_PROVISION_MODE:"railway",
    KINGLIKE_VIP_QA_PROVISION_APPROVED:"true",
    KINGLIKE_VIP_QA_MIGRATION_DATABASE_URL:
      "postgresql://vipqa_migrator:synthetic-only@vip-pg.railway.internal:5432/vipqa_demo",
    KINGLIKE_VIP_QA_PROVISION_HOST:"vip-pg.railway.internal",
    KINGLIKE_VIP_QA_PROVISION_DATABASE:"vipqa_demo",
    KINGLIKE_VIP_QA_PROVISION_MIGRATOR_ROLE:"vipqa_migrator",
    KINGLIKE_VIP_QA_PROVISION_RUNTIME_ROLE:"vipqa_runtime",
    KINGLIKE_VIP_QA_PROVISION_ADDRESS:"10.21.4.7",
    KINGLIKE_VIP_QA_PROVISION_ENVIRONMENT_ID:"a45d1f9e-4a24-4c84-99bc-90b48e2d41c7",
    KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD:passwords.admin,
    KINGLIKE_VIP_QA_PROVISION_BUYER_PASSWORD:passwords.buyer,
    KINGLIKE_VIP_QA_PROVISION_SELLER_PASSWORD:passwords.seller,
    KINGLIKE_VIP_QA_PROVISION_FINANCE_PASSWORD:passwords.finance,
  };
  assert.equal(validateQaProvisionConfig(railway).mode,"railway");
  assert.throws(()=>validateQaProvisionConfig({
    ...railway,KINGLIKE_VIP_QA_PROVISION_HOST:"another.railway.internal",
  }));
  assert.throws(()=>validateQaProvisionConfig({
    ...railway,KINGLIKE_VIP_QA_MIGRATION_DATABASE_URL:
      "postgresql://vipqa_migrator:synthetic@vip-pg.railway.internal:5432/vipqa_demo?sslmode=require",
  }));
  assert.throws(()=>validateQaProvisionConfig({
    ...railway,KINGLIKE_VIP_QA_PROVISION_RUNTIME_ROLE:"vipqa_migrator",
  }));
});

test("provisioning rejects weak account passwords and unsafe SQL identifiers",()=>{
  assert.throws(()=>validateQaProvisionConfig({
    ...local(),KINGLIKE_VIP_QA_PROVISION_FINANCE_PASSWORD:"weak",
  }));
  assert.equal(quoteQaSqlIdentifier("vip_receipts"),'"vip_receipts"');
  assert.throws(()=>quoteQaSqlIdentifier('vip_receipts"; DROP TABLE users;--'));
  assert.deepEqual(qaRuntimePrivilegesForTable("users"),["SELECT"]);
  assert.deepEqual(qaRuntimePrivilegesForTable("vip_payment_postings"),["SELECT","INSERT"]);
  assert.throws(()=>qaRuntimePrivilegesForTable("crm_leads"));
});
