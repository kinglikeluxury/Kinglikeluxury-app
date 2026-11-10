import test from "node:test";
import assert from "node:assert/strict";
import {
  identitySyncRuntimeConfig,createApprovedIdentitySyncRunner,
} from "./whatsappEmployeeIdentitySyncRuntime";

const safe:NodeJS.ProcessEnv={
  APP_DEPLOYMENT_MODE:"staging",
  APP_STAGING_DATABASE_URL:"postgresql://app:secret@app-staging.railway.internal/kinglike_staging",
  APP_STAGING_DATABASE_EXPECTED_HOST:"app-staging.railway.internal",
  APP_STAGING_DATABASE_EXPECTED_NAME:"kinglike_staging",
  APP_STAGING_DATABASE_CONFIRMATION:"verified",
  APP_STAGING_STORAGE_CONFIRMATION:"verified",
  NEON_DATABASE_URL:"postgresql://admin:secret@ep-live.neon.tech/neondb",
  PRODUCTION_DATABASE_HOST:"ep-live.neon.tech",
  PRODUCTION_DATABASE_NAME:"neondb",
  WHATSAPP_STAGING_PROOF_DATABASE_URL:"postgresql://proof:secret@proof.railway.internal/meta_proof",
  WHATSAPP_EMPLOYEE_IDENTITY_SYNC_ENABLED:"true",
  WHATSAPP_EMPLOYEE_IDENTITY_SYNC_CONSENT_SOURCE_VERIFIED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST:"archive.railway.internal",
  WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_NAME:"kinglike_whatsapp_archive",
  WHATSAPP_EMPLOYEE_IDENTITY_SYNC_DATABASE_URL:
    "postgresql://kinglike_wa_archive_identitysync:independent-secret@archive.railway.internal/kinglike_whatsapp_archive",
};
const source={
  currentAdmin:async()=>true,
  currentPerson:async()=>({id:101,isActive:true,isAdmin:false,role:"sub_agent"}),
  hasEmployeeConsent:async()=>true,
};
test("isolated identity sync runtime remains OFF without all privacy approvals",()=>{
  assert.equal(identitySyncRuntimeConfig({}),null);
  assert.equal(identitySyncRuntimeConfig({APP_DEPLOYMENT_MODE:"staging"}),null);
  for(const key of [
    "WHATSAPP_EMPLOYEE_IDENTITY_SYNC_ENABLED",
    "WHATSAPP_EMPLOYEE_IDENTITY_SYNC_CONSENT_SOURCE_VERIFIED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED",
  ])assert.equal(identitySyncRuntimeConfig({...safe,[key]:"false"}),null,key);
  assert.equal(identitySyncRuntimeConfig({...safe,APP_DEPLOYMENT_MODE:"production"}),null);
});

test("identity sync requires distinct privately hosted, correctly scoped role",()=>{
  const conf=identitySyncRuntimeConfig(safe);
  assert.ok(conf);
  assert.equal(conf.database,"kinglike_whatsapp_archive");
  assert.equal(JSON.stringify({configured:!!conf}).includes("independent-secret"),false);
  for(const bad of [
    {...safe,WHATSAPP_EMPLOYEE_IDENTITY_SYNC_DATABASE_URL:safe.APP_STAGING_DATABASE_URL},
    {...safe,WHATSAPP_EMPLOYEE_IDENTITY_SYNC_DATABASE_URL:safe.NEON_DATABASE_URL},
    {...safe,WHATSAPP_EMPLOYEE_IDENTITY_SYNC_DATABASE_URL:safe.WHATSAPP_STAGING_PROOF_DATABASE_URL},
    {...safe,WHATSAPP_EMPLOYEE_IDENTITY_SYNC_DATABASE_URL:
      "postgresql://postgres:secret@archive.railway.internal/kinglike_whatsapp_archive"},
    {...safe,WHATSAPP_EMPLOYEE_IDENTITY_SYNC_DATABASE_URL:
      "postgresql://kinglike_wa_archive_worker:secret@archive.railway.internal/kinglike_whatsapp_archive"},
    {...safe,WHATSAPP_EMPLOYEE_IDENTITY_SYNC_DATABASE_URL:
      "postgresql://kinglike_wa_archive_identitysync:secret@archive.railway.internal/kinglike_whatsapp_archive?options=-csearch_path"},
    {...safe,WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST:"archive.example.net",
      WHATSAPP_EMPLOYEE_IDENTITY_SYNC_DATABASE_URL:
        "postgresql://kinglike_wa_archive_identitysync:secret@archive.example.net/kinglike_whatsapp_archive"},
    {...safe,WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_NAME:"neondb"},
    {...safe,APP_STAGING_DATABASE_URL:safe.NEON_DATABASE_URL},
  ]){
    assert.equal(identitySyncRuntimeConfig(bad),null,
      "Rejected unsafe runtime connection");
  }
});

test("runner is not created without all source-of-truth consent callbacks",()=>{
  assert.equal(createApprovedIdentitySyncRunner(source,{}),null);
  assert.equal(createApprovedIdentitySyncRunner({
    currentAdmin:async()=>true,
    currentPerson:async()=>null,
    hasEmployeeConsent:undefined as never,
  },safe),null);
});

test("runner can be constructed lazily from synthetic config, with no database connection",async()=>{
  const runner=createApprovedIdentitySyncRunner(source,safe);
  assert.ok(runner);
  await runner.close();
});
