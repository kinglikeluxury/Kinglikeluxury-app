import assert from "node:assert/strict";
import {test} from "node:test";
import {
  classifyQaBootstrapFailure,
  validateRailwayBootstrapEnvironment,
} from "./qaRailwayBootstrapRules";

const environment=()=>({
  PATH:"/usr/bin",
  HOME:"/tmp",
  TMPDIR:"/tmp",
  NODE_ENV:"production",
  KINGLIKE_VIP_QA_BOOTSTRAP_EXECUTE:"true",
  KINGLIKE_VIP_QA_BOOTSTRAP_APPROVED:"true",
  KINGLIKE_VIP_QA_BOOTSTRAP_ADMIN_DATABASE_URL:
    "postgresql://postgres:synthetic-only@vip-pg.railway.internal:5432/railway",
  KINGLIKE_VIP_QA_PREVIEW:"true",
  KINGLIKE_VIP_ENABLED:"true",
  KINGLIKE_VIP_EMAIL_ENABLED:"false",
  KINGLIKE_VIP_EMAIL_LIVE_APPROVED:"false",
  VITE_KINGLIKE_VIP_ENABLED:"true",
  KINGLIKE_VIP_QA_DATABASE_URL:
    "postgresql://vipqa_runtime:Synthetic-Runtime-QA-2026!@vip-pg.railway.internal:5432/vipqa_demo",
  KINGLIKE_VIP_QA_EXPECTED_DB_HOST:"vip-pg.railway.internal",
  KINGLIKE_VIP_QA_EXPECTED_DB_NAME:"vipqa_demo",
  KINGLIKE_VIP_QA_EXPECTED_DB_ROLE:"vipqa_runtime",
  KINGLIKE_VIP_QA_EXPECTED_DB_ADDRESS:"auto",
  KINGLIKE_VIP_QA_ENVIRONMENT_ID:"a45d1f9e-4a24-4c84-99bc-90b48e2d41c7",
  KINGLIKE_VIP_QA_GATE_USER:"qa-owner",
  KINGLIKE_VIP_QA_GATE_PASSWORD:"synthetic-only-gateway-password-long",
  KINGLIKE_VIP_QA_SESSION_SECRET:"s".repeat(64),
  KINGLIKE_VIP_QA_PROVISION_MIGRATOR_PASSWORD:"Synthetic-Migrator-QA-2026!",
   KINGLIKE_VIP_QA_LOGIN_ADMIN_PASSWORD:"Synthetic-Admin-QA-2026!",
   KINGLIKE_VIP_QA_LOGIN_BUYER_PASSWORD:"Synthetic-Buyer-QA-2026!",
   KINGLIKE_VIP_QA_LOGIN_SELLER_PASSWORD:"Synthetic-Seller-QA-2026!",
   KINGLIKE_VIP_QA_LOGIN_FINANCE_PASSWORD:"Synthetic-Finance-QA-2026!",
});

test("Railway bootstrap accepts only private synthetic service identities",()=>{
  const config=validateRailwayBootstrapEnvironment(environment());
  assert.equal(config.host,"vip-pg.railway.internal");
  assert.equal(config.database,"vipqa_demo");
  assert.equal(config.runtimeRole,"vipqa_runtime");
});

test("unexpected package-manager overrides are refused by the QA bootstrap",()=>{
  assert.doesNotThrow(()=>validateRailwayBootstrapEnvironment({
    ...environment(),RAILPACK_INSTALL_CMD:"",
  }));
  assert.throws(()=>validateRailwayBootstrapEnvironment({
    ...environment(),RAILPACK_INSTALL_CMD:"npm ci --include=dev",
  }));
});

test("unused legacy seed variables must be empty while owner login credentials remain separate",()=>{
  assert.doesNotThrow(()=>validateRailwayBootstrapEnvironment({
    ...environment(),KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD:"",
    KINGLIKE_VIP_QA_PROVISION_BUYER_PASSWORD:"",
    KINGLIKE_VIP_QA_PROVISION_SELLER_PASSWORD:"",
    KINGLIKE_VIP_QA_PROVISION_FINANCE_PASSWORD:"",
  }));
  assert.throws(()=>validateRailwayBootstrapEnvironment({
    ...environment(),KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD:"stale-seed-secret",
  }));
});

test("Railway bootstrap refuses production-like targets and outbound communication",()=>{
  const env=environment();
  assert.throws(()=>validateRailwayBootstrapEnvironment({
    ...env,
    KINGLIKE_VIP_QA_BOOTSTRAP_ADMIN_DATABASE_URL:
      "postgresql://postgres:synthetic-only@ep-live.neon.tech/production",
  }));
  assert.throws(()=>validateRailwayBootstrapEnvironment({
    ...env,KINGLIKE_VIP_EMAIL_LIVE_APPROVED:"true",
  }));
  assert.throws(()=>validateRailwayBootstrapEnvironment({
    ...env,KINGLIKE_VIP_EMAIL_ENABLED:"true",
  }));
  assert.throws(()=>validateRailwayBootstrapEnvironment({
    ...env,DATABASE_URL:"postgresql://unapproved.invalid/production",
  }));
});

test("Railway bootstrap rejects malformed roles and non-unique synthetic credentials",()=>{
  const env=environment();
  assert.throws(()=>validateRailwayBootstrapEnvironment({
    ...env,KINGLIKE_VIP_QA_EXPECTED_DB_ROLE:"postgres",
    KINGLIKE_VIP_QA_DATABASE_URL:
      "postgresql://postgres:synthetic-only@vip-pg.railway.internal:5432/vipqa_demo",
  }));
  assert.throws(()=>validateRailwayBootstrapEnvironment({
    ...env,KINGLIKE_VIP_QA_LOGIN_SELLER_PASSWORD:
      env.KINGLIKE_VIP_QA_LOGIN_BUYER_PASSWORD,
  }));
  assert.throws(()=>validateRailwayBootstrapEnvironment({
    ...env,KINGLIKE_VIP_QA_BOOTSTRAP_APPROVED:"false",
  }));
});

test("bootstrap failure logs reduce database errors to safe categories",()=>{
  assert.equal(classifyQaBootstrapFailure(Object.assign(new Error("hidden"),{code:"28P01"})),
    "database_authentication");
  assert.equal(classifyQaBootstrapFailure(Object.assign(new Error("hidden"),{code:"ECONNREFUSED"})),
    "database_connection");
  assert.equal(classifyQaBootstrapFailure(Object.assign(new Error("hidden"),{code:"42501"})),
    "database_permission");
  assert.equal(classifyQaBootstrapFailure(Object.assign(new Error("hidden"),{code:"42P01"})),
    "database_schema");
  assert.equal(classifyQaBootstrapFailure(new Error("QA migration connection identity is invalid")),
    "database_identity");
  assert.equal(classifyQaBootstrapFailure(new Error("sensitive unclassified value")),
    "unknown");
});

test("bootstrap configuration failures use safe non-value diagnostics",()=>{
  const category=(env:Record<string,string|undefined>)=>{
    try{
      validateRailwayBootstrapEnvironment(env);
      return "accepted";
    }catch(error){
      return classifyQaBootstrapFailure(error);
    }
  };
  assert.equal(category({...environment(),UNAPPROVED_SETTING:"synthetic"}),
    "configuration_environment_other");
  assert.equal(category({...environment(),npm_config_user_agent:"synthetic"}),
    "configuration_environment_npm_metadata");
  assert.equal(category({...environment(),NIXPACKS_NODE_VERSION:"20"}),
    "configuration_environment_build_metadata");
  assert.equal(category({...environment(),npm_config_user_agent:"synthetic",CI:"true"}),
    "configuration_environment_npm_other");
  assert.equal(category({...environment(),NIXPACKS_NODE_VERSION:"20",CI:"true"}),
    "configuration_environment_build_other");
  assert.equal(category({...environment(),NODE_ENV:"test"}),
    "configuration_runtime_mode");
  assert.equal(category({...environment(),RAILPACK_INSTALL_CMD:"npm install"}),
    "configuration_package_override");
  assert.equal(category({...environment(),KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD:"legacy"}),
    "configuration_seed_variables");
  assert.equal(category({...environment(),KINGLIKE_VIP_QA_BOOTSTRAP_APPROVED:"false"}),
    "configuration_approval_flags");
  assert.equal(category({...environment(),KINGLIKE_VIP_EMAIL_ENABLED:"true"}),
    "configuration_external_communications");
  const missing:Record<string,string|undefined>=environment();
  delete missing.KINGLIKE_VIP_QA_LOGIN_FINANCE_PASSWORD;
  assert.equal(category(missing),"configuration_required_fields");
  assert.equal(category({...environment(),KINGLIKE_VIP_QA_DATABASE_URL:"invalid"}),
    "configuration_database_url");
  assert.equal(category({...environment(),
    KINGLIKE_VIP_QA_DATABASE_URL:
      "postgresql://vipqa_runtime:Synthetic-Runtime-QA-2026!@other.railway.internal:5432/vipqa_demo",
  }),"configuration_database_identity");
  assert.equal(category({...environment(),KINGLIKE_VIP_QA_LOGIN_FINANCE_PASSWORD:"weak"}),
    "configuration_credentials");
});
