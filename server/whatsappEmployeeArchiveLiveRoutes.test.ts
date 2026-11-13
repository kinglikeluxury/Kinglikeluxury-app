import test from "node:test";
import assert from "node:assert/strict";
import {
  liveArchiveReadConfig,verifyLiveArchiveReader,
  registerWhatsappEmployeeLiveArchiveReadRoutes,
} from "./whatsappEmployeeArchiveLiveRoutes";
import express from "express";

const stage:NodeJS.ProcessEnv={
  APP_DEPLOYMENT_MODE:"staging",
  APP_STAGING_DATABASE_URL:"postgresql://app:example@app-staging.railway.internal/kinglike_staging",
  APP_STAGING_DATABASE_EXPECTED_HOST:"app-staging.railway.internal",
  APP_STAGING_DATABASE_EXPECTED_NAME:"kinglike_staging",
  APP_STAGING_DATABASE_CONFIRMATION:"yes",APP_STAGING_STORAGE_CONFIRMATION:"yes",
  PRODUCTION_DATABASE_HOST:"ep-live.neon.tech",PRODUCTION_DATABASE_NAME:"neondb",
  NEON_DATABASE_URL:"postgresql://prod:example@ep-live.neon.tech/neondb",
  WHATSAPP_STAGING_PROOF_DATABASE_URL:"postgresql://proof:example@proof-staging.railway.internal/whatsapp_proof",
  WHATSAPP_EMPLOYEE_ARCHIVE_STAGING_RUNTIME_ENABLED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_READONLY_ENABLED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_HISTORY_IMPORT_READY:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_PRIVATE_MEDIA_READY:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST:"archive-staging.railway.internal",
  WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_NAME:"kinglike_whatsapp_archive",
  WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL:
    "postgresql://kinglike_wa_archive_reader:reader-synthetic@archive-staging.railway.internal/kinglike_whatsapp_archive",
  WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL:
    "postgresql://kinglike_wa_archive_auditwriter:audit-synthetic@archive-staging.railway.internal/kinglike_whatsapp_archive",
};

test("read-only gateway is not registered by default or outside isolated Staging",()=>{
  assert.equal(liveArchiveReadConfig({}),null);
  assert.equal(liveArchiveReadConfig({...stage,APP_DEPLOYMENT_MODE:"production"}),null);
  assert.equal(liveArchiveReadConfig({...stage,WHATSAPP_EMPLOYEE_ARCHIVE_READONLY_ENABLED:"false"}),null);
  assert.equal(liveArchiveReadConfig({...stage,WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED:"false"}),null);
  assert.equal(liveArchiveReadConfig({...stage,WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED:"false"}),null);
  assert.equal(liveArchiveReadConfig({...stage,WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED:"false"}),null);
  assert.equal(liveArchiveReadConfig({...stage,WHATSAPP_EMPLOYEE_ARCHIVE_HISTORY_IMPORT_READY:"false"}),null);
  const app=express();
  assert.equal(registerWhatsappEmployeeLiveArchiveReadRoutes(app,{
    env:{APP_DEPLOYMENT_MODE:"staging"},
    authorizeCurrentActor:async()=>null,
    verifyCurrentSubject:async()=>false,
  }),false);
});

test("connection requires exactly separate non-owner reader/audit roles and private host",()=>{
  const valid=liveArchiveReadConfig(stage);
  assert.ok(valid);
  assert.equal(valid?.hostname,"archive-staging.railway.internal");
  assert.equal(valid?.database,"kinglike_whatsapp_archive");
  assert.equal(liveArchiveReadConfig({...stage,
    WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL:stage.NEON_DATABASE_URL}),null);
  assert.equal(liveArchiveReadConfig({...stage,
    WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL:stage.APP_STAGING_DATABASE_URL}),null);
  assert.equal(liveArchiveReadConfig({...stage,
    WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL:stage.WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL}),null);
  assert.equal(liveArchiveReadConfig({...stage,
    WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL:
      "postgresql://postgres:password@archive-staging.railway.internal/kinglike_whatsapp_archive"}),null);
  assert.equal(liveArchiveReadConfig({...stage,
    WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST:"public.example.com",
    WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL:
      "postgresql://kinglike_wa_archive_reader:x@public.example.com/kinglike_whatsapp_archive",
    WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL:
      "postgresql://kinglike_wa_archive_auditwriter:y@public.example.com/kinglike_whatsapp_archive"}),null);
  assert.equal(liveArchiveReadConfig({...stage,
    WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL:
      "postgresql://kinglike_wa_archive_reader:reader-synthetic@archive-staging.railway.internal/kinglike_whatsapp_archive?options=-c%20search_path%3Dpublic"}),null);
  assert.equal(liveArchiveReadConfig({...stage,
    WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL:
      "postgresql://kinglike_wa_archive_auditwriter:reader-synthetic@archive-staging.railway.internal/kinglike_whatsapp_archive"}),null);
});

function privileged(overrides:Record<string,unknown>={}){
  return {
    database_name:"kinglike_whatsapp_archive",
    runtime_role:"kinglike_wa_archive_reader",owner:"postgres",superuser:false,
    principals_read:true,numbers_read:true,consents_read:true,
    conversations_read:true,events_read:true,
    events_insert:false,events_update:false,events_delete:false,
    audit_read:false,audit_insert:false,can_create:false,...overrides,
  };
}
test("reader SQL privilege inspection rejects owner and mutation grants",async()=>{
  const verify=(row:Record<string,unknown>)=>verifyLiveArchiveReader(
    async sql=>{
      assert.equal(sql.trim().startsWith("SELECT"),true);
      return {rows:[row]};
    },"kinglike_whatsapp_archive");
  assert.equal(await verify(privileged()),true);
  assert.equal(await verify(privileged({runtime_role:"postgres"})),false);
  assert.equal(await verify(privileged({owner:"kinglike_wa_archive_reader"})),false);
  assert.equal(await verify(privileged({superuser:true})),false);
  assert.equal(await verify(privileged({events_insert:true})),false);
  assert.equal(await verify(privileged({events_update:true})),false);
  assert.equal(await verify(privileged({audit_read:true})),false);
  assert.equal(await verify(privileged({can_create:true})),false);
  assert.equal(await verify(privileged({database_name:"neondb"})),false);
  assert.equal(await verifyLiveArchiveReader(async()=>{
    throw Error("synthetic connection failure");
  },"kinglike_whatsapp_archive"),false);
});
