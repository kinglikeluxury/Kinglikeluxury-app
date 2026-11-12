import test from "node:test";
import assert from "node:assert/strict";
import { inspectStagingOneNumberPilot } from "./whatsappSingleNumberPilotReadiness";

const isolated:NodeJS.ProcessEnv={
  APP_DEPLOYMENT_MODE:"staging",
  APP_STAGING_DATABASE_URL:"postgresql://stage:dummy@app-stage.railway.internal/kinglike_staging",
  APP_STAGING_DATABASE_EXPECTED_HOST:"app-stage.railway.internal",
  APP_STAGING_DATABASE_EXPECTED_NAME:"kinglike_staging",
  APP_STAGING_DATABASE_CONFIRMATION:"yes",
  APP_STAGING_STORAGE_CONFIRMATION:"yes",
  NEON_DATABASE_URL:"postgresql://prod:dummy@ep-live.neon.tech/neondb",
  PRODUCTION_DATABASE_HOST:"ep-live.neon.tech",
  PRODUCTION_DATABASE_NAME:"neondb",
  WHATSAPP_META_TEST_WABA_ID:"11111111111111",
  WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64:Buffer.alloc(32,3).toString("base64"),
  WHATSAPP_EMPLOYEE_INBOX_HMAC_KEY_B64:Buffer.alloc(32,4).toString("base64"),
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_EMPLOYEE_ID:"101",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_WABA_ID:"22222222222222",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_PHONE_NUMBER_ID:"33333333333333",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_DISPLAY_PHONE:"15550000101",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_VERIFY_TOKEN:"synthetic-token-123456789012345",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_META_APP_SECRET:"synthetic-meta-secret-not-real",
};
const credentials={workerConfigured:true,readerAuditConfigured:true};
const flags=[
  "WHATSAPP_EMPLOYEE_ARCHIVE_STAGING_RUNTIME_ENABLED",
  "WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_ENABLED",
  "WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED",
  "WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED",
  "WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED",
  "WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED",
  "WHATSAPP_EMPLOYEE_ARCHIVE_HISTORY_IMPORT_READY",
  "WHATSAPP_EMPLOYEE_ARCHIVE_PRIVATE_MEDIA_READY",
  "WHATSAPP_EMPLOYEE_ARCHIVE_CONTACT_SYNC_READY",
  "WHATSAPP_EMPLOYEE_ARCHIVE_SIGNED_QUEUE_READY",
];
const allFlags=Object.fromEntries(flags.map(k=>[k,"true"]));

test("one-number pilot refuses activation without external evidence",()=>{
  const readiness=inspectStagingOneNumberPilot(isolated,credentials);
  assert.equal(readiness.mode,"blocked");
  assert.ok(readiness.blockers.includes("meta_verification_attested"));
  assert.ok(readiness.blockers.includes("history_pipeline_attested"));
  assert.ok(readiness.blockers.includes("customer_notice_attested"));
  assert.equal(readiness.employeeNumberConnection,"not_verified");
  assert.equal(readiness.realMessageDelivery,"not_verified");
});
test("no production, no same WABA as Meta TEST, no single credential bypass",()=>{
  const fullyConfigured={...isolated,...allFlags};
  const prod=inspectStagingOneNumberPilot({...fullyConfigured,APP_DEPLOYMENT_MODE:"production"},credentials);
  assert.equal(prod.mode,"blocked");
  assert.equal(prod.checks.isolated_staging,false);
  const same=inspectStagingOneNumberPilot({...fullyConfigured,
    WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_WABA_ID:isolated.WHATSAPP_META_TEST_WABA_ID},credentials);
  assert.equal(same.mode,"blocked");
  assert.equal(same.checks.pilot_differs_from_test_waba,false);
  assert.equal(inspectStagingOneNumberPilot(fullyConfigured,{...credentials,workerConfigured:false}).mode,"blocked");
  assert.equal(inspectStagingOneNumberPilot(fullyConfigured,{...credentials,readerAuditConfigured:false}).mode,"blocked");
});
test("configured pilot never claims a phone is connected, even when all flags are true",()=>{
  const readiness=inspectStagingOneNumberPilot({...isolated,...allFlags},credentials);
  assert.equal(readiness.mode,"configuration_complete_not_connected");
  assert.equal(readiness.blockers.length,0);
  assert.equal(readiness.employeeNumberConnection,"not_verified");
  assert.equal(readiness.signedCallback,"not_registered_by_this_report");
  assert.equal(readiness.realMessageDelivery,"not_verified");
});
test("encryption key reuse or malformed identifiers fail closed",()=>{
  const bad=inspectStagingOneNumberPilot({...isolated,...allFlags,
    WHATSAPP_EMPLOYEE_INBOX_HMAC_KEY_B64:isolated.WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64,
    WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_PHONE_NUMBER_ID:"not-a-number"},credentials);
  assert.equal(bad.mode,"blocked");
  assert.equal(bad.checks.independent_keys_configured,false);
  assert.equal(bad.checks.pilot_identifiers_configured,false);
});
test("admin-facing report contains no phone, Meta identifier, secret or password",()=>{
  const data=JSON.stringify(inspectStagingOneNumberPilot({...isolated,...allFlags},credentials));
  for(const marker of [
    isolated.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_DISPLAY_PHONE,
    isolated.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_WABA_ID,
    isolated.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_PHONE_NUMBER_ID,
    isolated.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_META_APP_SECRET,
    isolated.WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64,
  ])assert.equal(data.includes(marker!),false);
});
