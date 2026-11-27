import {strict as assert} from "node:assert";
import {test} from "node:test";
import {qaGateMatches,assertQaPreviewEnvironment,assertQaLocalProxyEnvironment,validateQaDatabaseUrl,isForbiddenQaPath} from "./qaPreviewRules";

test("QA gateway uses a protected, exact Basic credential",()=>{
 const good=Buffer.from("qaoperator:only-local-private-password").toString("base64");
 assert(qaGateMatches("Basic "+good,"qaoperator","only-local-private-password"));
 assert(!qaGateMatches("Basic "+good,"qaoperator","something else"));
 assert(!qaGateMatches("Bearer "+good,"qaoperator","only-local-private-password"));
});
test("QA path guard rejects project roots, private files, and encoded traversal",()=>{
 for(const path of [
  "/.env","/.git/config","/.replit","/package.json","/package-lock.json",
  "/server/index.ts","/client/src/main.tsx","/shared/schema.ts",
  "/mobile-app/signing","/kinglike-twa/settings","/android/keys",
  "/node_modules/express/package.json","/dist/server.mjs",
  "/%2e%2e/.env","/%252e%252e%252fserver%252findex.ts",
  "/vip/%2e%2e/server/index.ts","/vip/%5c..%5c.env"
 ])assert(isForbiddenQaPath(path),`must block ${path}`);
 for(const path of [
  "/","/vip","/admin/vip","/api/auth/me","/health",
  "/assets/app-abc123.js","/assets/app-abc123.css"
 ])assert(!isForbiddenQaPath(path),`must allow QA route ${path}`);
});
test("QA database rejects Neon and outside hosts",()=>{
 const testEnv={NODE_ENV:"test",VIP_QA_LOCAL_TEST:"true",KINGLIKE_VIP_QA_LOCAL_ONLY:"true",VIP_QA_EXPECTED_PORT:"5432"};
 const validUrl="postgresql://vipqa_test:p@localhost:5432/vipdb";
 assert.equal(validateQaDatabaseUrl(validUrl,testEnv),validUrl);
 assert.throws(()=>validateQaDatabaseUrl("postgresql://u:p@ep-prod.aws.neon.tech/neondb",testEnv));
 assert.throws(()=>validateQaDatabaseUrl("postgresql://u:p@localhost:5432/production",testEnv));
 assert.throws(()=>validateQaDatabaseUrl("postgresql://u:p@somewhere.example.com:5432/vipdb",testEnv));
 assert.throws(()=>validateQaDatabaseUrl("postgresql://u:p@postgres.railway.internal:5432/railway",testEnv));
});
test("QA refuses start without non-production flag and strong gate",()=>{
 const goodEnv={
  NODE_ENV:"test",
  VIP_QA_LOCAL_TEST:"true",
  KINGLIKE_VIP_QA_LOCAL_ONLY:"true",
  KINGLIKE_VIP_QA_PREVIEW:"true",
  KINGLIKE_VIP_ENABLED:"true",
  VIP_QA_EXPECTED_DATA_DIRECTORY:"/tmp/kinglike-vip-pg-test",
  VIP_QA_EXPECTED_PORT:"5432",
  KINGLIKE_VIP_QA_DATABASE_URL:"postgresql://vipqa_test:synthetic-only@127.0.0.1:5432/vipdb",
  KINGLIKE_VIP_QA_GATE_USER:"qaowner",
  KINGLIKE_VIP_QA_GATE_PASSWORD:"q".repeat(32),
  KINGLIKE_VIP_QA_SESSION_SECRET:"z".repeat(64),
 };
 assert.throws(()=>assertQaPreviewEnvironment({NODE_ENV:"test"}));
 assert.doesNotThrow(()=>assertQaPreviewEnvironment(goodEnv));
  assert.doesNotThrow(()=>assertQaPreviewEnvironment({...goodEnv,KINGLIKE_VIP_ENABLED:"false"}),
    "VIP can be disabled only inside the same isolated QA environment");
  assert.throws(()=>assertQaPreviewEnvironment({...goodEnv,KINGLIKE_VIP_ENABLED:""}),
    "an implicit or missing backend flag is not a valid test mode");
 assert.throws(()=>assertQaPreviewEnvironment({...goodEnv,RESEND_API_KEY:"synthetic-disabled"}));
});
test("local QA proxy accepts only a minimal synthetic environment",()=>{
 const good={
  PATH:"/usr/bin",
  HOME:"/tmp",
  TMPDIR:"/tmp",
  NODE_ENV:"test",
  KINGLIKE_VIP_QA_PROXY_START:"true",
  KINGLIKE_VIP_QA_GATE_USER:"qaoperator",
  KINGLIKE_VIP_QA_GATE_PASSWORD:"synthetic-only-local-password"
 };
 assert.doesNotThrow(()=>assertQaLocalProxyEnvironment(good));
 assert.throws(()=>assertQaLocalProxyEnvironment({...good,UNAPPROVED_EXTERNAL_KEY:"synthetic-value"}));
 assert.throws(()=>assertQaLocalProxyEnvironment({...good,KINGLIKE_VIP_QA_GATE_PASSWORD:"short"}));
 assert.throws(()=>assertQaLocalProxyEnvironment({...good,KINGLIKE_VIP_QA_PROXY_START:"false"}));
});
