import {strict as assert} from "node:assert";
import {test} from "node:test";
import {qaGateMatches,assertQaPreviewConfiguration,validateQaDatabaseUrl} from "./qaPreviewRules";

test("QA gateway uses a protected, exact Basic credential",()=>{
 const good=Buffer.from("qaoperator:only-local-private-password").toString("base64");
 assert(qaGateMatches("Basic "+good,"qaoperator","only-local-private-password"));
 assert(!qaGateMatches("Basic "+good,"qaoperator","something else"));
 assert(!qaGateMatches("Bearer "+good,"qaoperator","only-local-private-password"));
});
test("QA database rejects Neon and outside hosts",()=>{
 const old=process.env.NODE_ENV,flag=process.env.VIP_QA_LOCAL_TEST;
 try{
  process.env.NODE_ENV="test";process.env.VIP_QA_LOCAL_TEST="true";
  assert.equal(validateQaDatabaseUrl("postgresql://u:p@localhost:5432/vipdb"),
    "postgresql://u:p@localhost:5432/vipdb");
  assert.throws(()=>validateQaDatabaseUrl("postgresql://u:p@ep-prod.aws.neon.tech/neondb"));
  assert.throws(()=>validateQaDatabaseUrl("postgresql://u:p@localhost:5432/production"));
  assert.throws(()=>validateQaDatabaseUrl("postgresql://u:p@somewhere.example.com:5432/vipdb"));
  assert.equal(validateQaDatabaseUrl("postgresql://u:p@postgres.railway.internal:5432/railway"),
    "postgresql://u:p@postgres.railway.internal:5432/railway");
 }finally{
  if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;
  if(flag===undefined)delete process.env.VIP_QA_LOCAL_TEST;else process.env.VIP_QA_LOCAL_TEST=flag;
 }
});
test("QA refuses start without non-production flag and strong gate",()=>{
 const names=["KINGLIKE_VIP_QA_PREVIEW","KINGLIKE_VIP_ENABLED","KINGLIKE_VIP_EMAIL_ENABLED",
 "KINGLIKE_VIP_EMAIL_LIVE_APPROVED","RESEND_API_KEY","NEON_DATABASE_URL",
 "KAY_TEST_DATABASE_URL","KINGLIKE_VIP_CRM_READONLY_DATABASE_URL",
 "KINGLIKE_VIP_QA_GATE_USER","KINGLIKE_VIP_QA_GATE_PASSWORD","KINGLIKE_VIP_QA_SESSION_SECRET"];
 const old=Object.fromEntries(names.map(x=>[x,process.env[x]]));
 try{
  for(const x of names)delete process.env[x];
  assert.throws(()=>assertQaPreviewConfiguration());
  process.env.KINGLIKE_VIP_QA_PREVIEW="true";
  process.env.KINGLIKE_VIP_ENABLED="true";
  process.env.KINGLIKE_VIP_QA_GATE_USER="qaowner";
  process.env.KINGLIKE_VIP_QA_GATE_PASSWORD="q".repeat(32);
  process.env.KINGLIKE_VIP_QA_SESSION_SECRET="z".repeat(64);
  assert.doesNotThrow(()=>assertQaPreviewConfiguration());
  process.env.RESEND_API_KEY="must-never-use-real-mail";
  assert.throws(()=>assertQaPreviewConfiguration());
 }finally{
  for(const x of names){if(old[x]===undefined)delete process.env[x];else process.env[x]=old[x]}
 }
});
