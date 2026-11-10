import test from "node:test";
import assert from "node:assert/strict";
import {createRestrictedStagingWhatsappEmployeeConsumer} from "./whatsappEmployeeWebhook";

const stage:NodeJS.ProcessEnv={
  APP_DEPLOYMENT_MODE:"staging",
  APP_STAGING_DATABASE_URL:"postgresql://stage:password@app-staging.railway.internal/kinglike_staging",
  APP_STAGING_DATABASE_EXPECTED_HOST:"app-staging.railway.internal",
  APP_STAGING_DATABASE_EXPECTED_NAME:"kinglike_staging",
  APP_STAGING_DATABASE_CONFIRMATION:"isolated",
  APP_STAGING_STORAGE_CONFIRMATION:"isolated",
  PRODUCTION_DATABASE_HOST:"ep-live.neon.tech",
  PRODUCTION_DATABASE_NAME:"neondb",
  NEON_DATABASE_URL:"postgresql://prod:password@ep-live.neon.tech/neondb",
  WHATSAPP_EMPLOYEE_ARCHIVE_STAGING_RUNTIME_ENABLED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_WORKER_ENABLED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_HISTORY_IMPORT_READY:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_PRIVATE_MEDIA_READY:"true",
};
const good={
  db:"kinglike_whatsapp_archive",role:"kinglike_wa_archive_worker",
  superuser:false,owner:"postgres",can_insert:true,can_read:true,
  can_update:false,can_delete:false,inbox_insert:true,can_create:false,
};
function db(overrides:Record<string,unknown>={}){
  let connectionCount=0;
  let releaseCount=0;
  let actualInsert=false;
  const fake={
    async connect(){
      connectionCount++;
      const initial=connectionCount===1;
      return {
        async query(sql:string){
          if(initial){
            assert.ok(sql.trim().startsWith("SELECT"));
            assert.ok(sql.includes("has_table_privilege"));
            return {rows:[{...good,...overrides}],rowCount:1};
          }
          actualInsert=true;
          throw Error("fake fixture: blocked before SQL mutation");
        },
        release(){releaseCount++;}
      };
    },
  };
  return {fake:fake as any,stats:()=>({connectionCount,releaseCount,actualInsert})};
}
const scope={employeeId:101,wabaId:"100010001",phoneNumberId:"100010002",
  displayPhoneNumber:"15550000001"};
const fakeRaw=Buffer.from("not even a valid Meta payload","utf8");

test("runtime worker is never available in production, ordinary Staging or before policies",()=>{
  const f=db();
  assert.equal(createRestrictedStagingWhatsappEmployeeConsumer(f.fake,{}),null);
  assert.equal(createRestrictedStagingWhatsappEmployeeConsumer(f.fake,
    {...stage,APP_DEPLOYMENT_MODE:"production"}),null);
  for(const flag of [
    "WHATSAPP_EMPLOYEE_ARCHIVE_STAGING_RUNTIME_ENABLED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_WORKER_ENABLED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_HISTORY_IMPORT_READY",
    "WHATSAPP_EMPLOYEE_ARCHIVE_PRIVATE_MEDIA_READY",
  ]) {
    assert.equal(createRestrictedStagingWhatsappEmployeeConsumer(
      f.fake,{...stage,[flag]:"false"}),null,flag);
  }
  assert.deepEqual(f.stats(),{connectionCount:0,releaseCount:0,actualInsert:false});
});
test("archive consumer rejects wrong DB, role, ownership or mutable event grants",async()=>{
  for(const invalid of [
    {db:"neondb"},{role:"postgres"},{owner:"kinglike_wa_archive_worker"},
    {superuser:true},{can_insert:false},{can_read:false},{can_update:true},
    {can_delete:true},{inbox_insert:false},{can_create:true},
  ]){
    const f=db(invalid);
    const consume=createRestrictedStagingWhatsappEmployeeConsumer(f.fake,stage);
    assert.ok(consume);
    await assert.rejects(consume!(fakeRaw,scope));
    assert.deepEqual(f.stats(),{connectionCount:1,releaseCount:1,actualInsert:false});
  }
});
test("correct restricted role passes verification and reaches scoped event validator",async()=>{
  const f=db();
  const consume=createRestrictedStagingWhatsappEmployeeConsumer(f.fake,stage);
  assert.ok(consume);
  await assert.rejects(consume!(fakeRaw,scope));
  // Core validation must reject malformed input BEFORE attempting any SQL.
  assert.deepEqual(f.stats(),{connectionCount:1,releaseCount:1,actualInsert:false});
});
