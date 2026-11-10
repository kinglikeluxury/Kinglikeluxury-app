import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {createHmac} from "node:crypto";
import {once} from "node:events";
import {
  WHATSAPP_PILOT_SIGNED_PATH,stagingPilotWebhookConfig,
  classifySignedPilotDelivery,registerStagingWhatsappPilotSignedCallback,
  PilotWebhookRefused,
} from "./whatsappPilotSignedWebhookAdapter";

const env:NodeJS.ProcessEnv={
  APP_DEPLOYMENT_MODE:"staging",
  APP_STAGING_DATABASE_URL:"postgresql://app:pwd@app-stage.railway.internal/kinglike_staging",
  APP_STAGING_DATABASE_EXPECTED_HOST:"app-stage.railway.internal",
  APP_STAGING_DATABASE_EXPECTED_NAME:"kinglike_staging",
  APP_STAGING_DATABASE_CONFIRMATION:"verified",
  APP_STAGING_STORAGE_CONFIRMATION:"verified",
  PRODUCTION_DATABASE_HOST:"prod.neon.tech",
  PRODUCTION_DATABASE_NAME:"neondb",
  WHATSAPP_EMPLOYEE_ARCHIVE_STAGING_RUNTIME_ENABLED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_ENABLED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_HISTORY_IMPORT_READY:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_PRIVATE_MEDIA_READY:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_CONTACT_SYNC_READY:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_SIGNED_QUEUE_READY:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_EMPLOYEE_ID:"101",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_WABA_ID:"123456789003",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_PHONE_NUMBER_ID:"123456789004",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_DISPLAY_PHONE:"15550000001",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_VERIFY_TOKEN:"random-synthetic-verify-token-123456",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_META_APP_SECRET:"synthetic-secret-never-real-value",
};
const cfg=stagingPilotWebhookConfig(env)!;
const delivery=(fields:string[])=>Buffer.from(JSON.stringify({
  object:"whatsapp_business_account",
  entry:[{id:cfg.wabaId,changes:fields.map(field=>({
    field,value:{metadata:{phone_number_id:cfg.phoneNumberId,
      display_phone_number:cfg.displayPhoneNumber},messaging_product:"whatsapp",
      ...(field==="history"?{history:[{metadata:{phase:0,chunk_order:1,progress:100},
        threads:[]}]}:{messages:[{id:"wamid.synthetic"}]})},
  }))}],
}),"utf8");
const sig=(raw:Buffer)=>"sha256="+createHmac("sha256",cfg.appSecret)
  .update(raw).digest("hex");
const scope=(v:any)=>v.employeeId===101 &&v.wabaId===cfg.wabaId &&
  v.phoneNumberId===cfg.phoneNumberId;

test("cutover is disabled until every independent privacy, history, contacts and media gate",()=>{
  assert.equal(stagingPilotWebhookConfig({}),null);
  assert.equal(stagingPilotWebhookConfig({...env,APP_DEPLOYMENT_MODE:"production"}),null);
  for(const flag of [
    "WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_ENABLED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_HISTORY_IMPORT_READY",
    "WHATSAPP_EMPLOYEE_ARCHIVE_PRIVATE_MEDIA_READY",
    "WHATSAPP_EMPLOYEE_ARCHIVE_CONTACT_SYNC_READY",
    "WHATSAPP_EMPLOYEE_ARCHIVE_SIGNED_QUEUE_READY",
  ])assert.equal(stagingPilotWebhookConfig({...env,[flag]:"false"}),null,flag);
  assert.equal(stagingPilotWebhookConfig({...env,
    WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_EMPLOYEE_ID:"invalid"}),null);
  assert.equal(stagingPilotWebhookConfig({...env,
    APP_STAGING_DATABASE_URL:"postgresql://neon:pwd@prod.neon.tech/neondb"}),null);
});

test("signed classifier never routes mixed, unknown or contact events to the wrong queue",()=>{
  for(const kind of ["messages","smb_message_echoes"])
    assert.equal(classifySignedPilotDelivery(delivery([kind]),sig(delivery([kind])),cfg),"live");
  assert.equal(classifySignedPilotDelivery(delivery(["history"]),sig(delivery(["history"])),cfg),"history");
  for(const fields of [
    ["history","messages"],["history","smb_app_state_sync"],
    ["messages","history"],["smb_app_state_sync"],["unknown"],
  ]){
    const raw=delivery(fields);
    assert.throws(()=>classifySignedPilotDelivery(raw,sig(raw),cfg),PilotWebhookRefused);
  }
  const raw=delivery(["messages"]);
  assert.throws(()=>classifySignedPilotDelivery(raw,"sha256="+"0".repeat(64),cfg),PilotWebhookRefused);
});

test("signed Staging callback ACKs only after durable queue resolves; failed sync is retryable",async()=>{
  const app=express();
  let authorized=true,failed=false;
  const stored:string[]=[];
  const r=registerStagingWhatsappPilotSignedCallback(app,{
    authorizeScope:async s=>authorized&&scope(s),
    enqueueLive:async(raw,sig,s)=>{
      assert.ok(scope(s)&&sig.startsWith("sha256="));
      if(failed)throw Error("synthetic durable queue unavailable");
      stored.push("live:"+raw.length);
    },
    enqueueHistory:async(raw,sig,s)=>{
      assert.ok(scope(s)&&sig.startsWith("sha256="));
      if(failed)throw Error("synthetic history DB unavailable");
      stored.push("history:"+raw.length);
    },
  },env);
  assert.equal(r,true);
  const server=app.listen(0,"127.0.0.1");
  await once(server,"listening");
  try{
    const addr=server.address();
    if(!addr ||typeof addr==="string")throw Error("no local port");
    const url="http://127.0.0.1:"+addr.port+WHATSAPP_PILOT_SIGNED_PATH;
    const validGet=new URL(url);
    validGet.searchParams.set("hub.mode","subscribe");
    validGet.searchParams.set("hub.verify_token",cfg.verifyToken);
    validGet.searchParams.set("hub.challenge","stage-test-123");
    const verify=await fetch(validGet);
    assert.equal(verify.status,200);
    assert.equal(await verify.text(),"stage-test-123");
    validGet.searchParams.set("hub.verify_token","bad-token");
    assert.equal((await fetch(validGet)).status,403);

    async function send(fields:string[],validSignature=true){
      const raw=delivery(fields);
      return fetch(url,{method:"POST",
        headers:{"content-type":"application/json",
          "x-hub-signature-256":validSignature?sig(raw):"sha256="+"0".repeat(64)},
        body:raw,
      });
    }
    assert.equal((await send(["messages"])).status,200);
    assert.equal((await send(["history"])).status,200);
    assert.equal(stored.length,2);
    assert.equal((await send(["messages"],false)).status,401);
    assert.equal((await send(["history","messages"])).status,503);
    assert.equal((await send(["smb_app_state_sync"])).status,503);
    assert.equal(stored.length,2);
    authorized=false;
    assert.equal((await send(["messages"])).status,503);
    assert.equal(stored.length,2);
    authorized=true;failed=true;
    assert.equal((await send(["history"])).status,503);
    assert.equal(stored.length,2);
  }finally{
    await new Promise<void>(r=>server.close(()=>r()));
  }
});
test("route is never registered unless callback and flags are completely wired",()=>{
  const app=express();
  const deps={authorizeScope:async()=>true,
    enqueueLive:async()=>{},enqueueHistory:async()=>{}};
  assert.equal(registerStagingWhatsappPilotSignedCallback(app,deps,{}),false);
  assert.equal(registerStagingWhatsappPilotSignedCallback(app,{
    ...deps,enqueueHistory:undefined as never,
  },env),false);
});
