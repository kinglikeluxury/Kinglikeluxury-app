import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import {createHmac} from "node:crypto";
import {
  registerStagingWhatsappPilotSignedCallback,WHATSAPP_PILOT_SIGNED_PATH,
} from "./whatsappPilotSignedWebhookAdapter";
import {createEmployeeWhatsappDurableInbox} from "./whatsappEmployeeDurableInbox";
import {createPrivateWhatsappHistoryInbox} from "./whatsappHistoryDurableInbox";
import {createPrivateWhatsappContactSyncInbox} from "./whatsappContactStateDurableInbox";

const env:NodeJS.ProcessEnv={
  APP_DEPLOYMENT_MODE:"staging",
  APP_STAGING_DATABASE_URL:"postgresql://app:pwd@isolated.railway.internal/kinglike_staging",
  APP_STAGING_DATABASE_EXPECTED_HOST:"isolated.railway.internal",
  APP_STAGING_DATABASE_EXPECTED_NAME:"kinglike_staging",
  APP_STAGING_DATABASE_CONFIRMATION:"synthetic-evidence",
  APP_STAGING_STORAGE_CONFIRMATION:"synthetic-evidence",
  PRODUCTION_DATABASE_HOST:"never.neon.tech",
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
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_WABA_ID:"111111111111",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_PHONE_NUMBER_ID:"222222222222",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_DISPLAY_PHONE:"15551230000",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_VERIFY_TOKEN:"synthetic-staging-verify-token-2026",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_META_APP_SECRET:"synthetic-staging-app-secret-not-live",
};
const waba=env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_WABA_ID!;
const phone=env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_PHONE_NUMBER_ID!;
const display=env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_DISPLAY_PHONE!;
const secret=env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_META_APP_SECRET!;
const liveAes=Buffer.alloc(32,1),liveMac=Buffer.alloc(32,2);
const historyAes=Buffer.alloc(32,3);
const contactsAes=Buffer.alloc(32,4),contactsMac=Buffer.alloc(32,5);
const signature=(raw:Buffer)=>
  "sha256="+createHmac("sha256",secret).update(raw).digest("hex");

function body(field:"messages"|"smb_message_echoes"|"history"|"smb_app_state_sync"):Buffer{
  const fields={
    messages:{messages:[{
      id:"wamid.synthetic-inbound",from:"15550000001",timestamp:"1763040000",
      type:"text",text:{body:"SYNTHETIC MESSAGE SECRET"},
    }]},
    smb_message_echoes:{message_echoes:[{
      id:"wamid.synthetic-outbound",from:display,to:"15550000001",
      timestamp:"1763040001",type:"text",text:{body:"SYNTHETIC ECHO SECRET"},
    }]},
    history:{history:[{
      metadata:{phase:0,chunk_order:1,progress:100},
      threads:[{id:"15550000001",messages:[{
        id:"wamid.synthetic-history",from:"15550000001",
        timestamp:"1763039999",type:"text",text:{body:"SYNTHETIC HISTORY SECRET"},
      }]}],
    }]},
    smb_app_state_sync:{state_sync:[{
      type:"contact",action:"add",
      contact:{phone_number:"15550000001",full_name:"SYNTHETIC CONTACT SECRET"},
      metadata:{timestamp:"1763040000"},
    }]},
  };
  return Buffer.from(JSON.stringify({
    object:"whatsapp_business_account",
    entry:[{id:waba,changes:[{field,value:{
      messaging_product:"whatsapp",
      metadata:{phone_number_id:phone,display_phone_number:display},
      ...fields[field],
    }}]}],
  }),"utf8");
}

test("signed one-employee callback durably encrypts all 3 event classes before 200",async()=>{
  let allowed=true,brokenQueue:"live"|"history"|"contacts"|null=null;
  const stored:{kind:string;ciphertext:Buffer}[]=[];
  const scopeOk=(s:any)=>allowed&&s?.employeeId===101 &&
    s?.wabaId===waba&&s?.phoneNumberId===phone;
  const live=createEmployeeWhatsappDurableInbox({
    db:{query:async(sql:string,p?:unknown[])=>{
      assert.ok(sql.includes("kinglike_whatsapp.whatsapp_employee_inbox"));
      if(brokenQueue==="live")throw Error("synthetic live DB unavailable");
      stored.push({kind:"live",ciphertext:p?.[5] as Buffer});
      return {rows:[],rowCount:1};
    }} as never,
    encryptionKey:liveAes,dedupeKey:liveMac,metaAppSecret:secret,
    authorizeScope:async s=>scopeOk(s),consume:async()=>{},
  });
  const history=createPrivateWhatsappHistoryInbox({
    db:{connect:async()=>({
      query:async(sql:string,p?:unknown[])=>{
        if(brokenQueue==="history")throw Error("synthetic history DB unavailable");
        if(sql.startsWith("INSERT INTO kinglike_whatsapp.whatsapp_employee_history_chunks")){
          stored.push({kind:"history",ciphertext:p?.[11] as Buffer});
          return {rows:[],rowCount:1};
        }
        return {rows:[],rowCount:0};
      },release:()=>{},
    })},
    encryptionKey:historyAes,metaAppSecret:secret,
    authorizeScope:async s=>scopeOk(s),
  });
  const contacts=createPrivateWhatsappContactSyncInbox({
    db:{query:async(sql:string,p?:unknown[])=>{
      assert.ok(sql.includes("kinglike_whatsapp.whatsapp_employee_contact_sync_inbox"));
      if(brokenQueue==="contacts")throw Error("synthetic contact DB unavailable");
      stored.push({kind:"contacts",ciphertext:p?.[5] as Buffer});
      return {rows:[],rowCount:1};
    }} as never,
    encryptionKey:contactsAes,dedupeKey:contactsMac,metaAppSecret:secret,
    authorizeScope:async s=>scopeOk(s),
  });

  const app=express();
  assert.equal(registerStagingWhatsappPilotSignedCallback(app,{
    authorizeScope:async s=>scopeOk(s),
    enqueueLive:live.enqueueSigned,
    enqueueHistory:history.enqueueSignedHistory,
    enqueueContacts:contacts.enqueueSignedContacts,
  },env),true);
  const server=app.listen(0,"127.0.0.1");
  await once(server,"listening");
  try{
    const address=server.address();
    assert.ok(address&&typeof address!=="string");
    const endpoint="http://127.0.0.1:"+address.port+WHATSAPP_PILOT_SIGNED_PATH;
    async function post(raw:Buffer,good=true){
      return fetch(endpoint,{method:"POST",headers:{
        "content-type":"application/json",
        "x-hub-signature-256":good?signature(raw):"sha256="+"0".repeat(64),
      },body:raw});
    }
    for(const field of [
      "messages","smb_message_echoes","history","smb_app_state_sync",
    ] as const){
      const response=await post(body(field));
      assert.equal(response.status,200,field);
      assert.equal(await response.text(),"EVENT_RECEIVED");
    }
    assert.deepEqual(stored.map(x=>x.kind),["live","live","history","contacts"]);
    for(const x of stored){
      assert.ok(Buffer.isBuffer(x.ciphertext));
      assert.equal(x.ciphertext.toString("utf8").includes("SYNTHETIC"),false);
    }
    const before=stored.length;
    assert.equal((await post(body("messages"),false)).status,401);
    assert.equal(stored.length,before);
    const mixed=JSON.parse(body("history").toString("utf8"));
    mixed.entry[0].changes.push(JSON.parse(body("smb_app_state_sync").toString("utf8")).entry[0].changes[0]);
    assert.equal((await post(Buffer.from(JSON.stringify(mixed)))).status,503);
    assert.equal(stored.length,before);
    for(const [failure,field] of [
      ["live","messages"],["history","history"],["contacts","smb_app_state_sync"],
    ] as const){
      brokenQueue=failure;
      assert.equal((await post(body(field))).status,503);
      assert.equal(stored.length,before);
      brokenQueue=null;
    }
    allowed=false;
    assert.equal((await post(body("smb_message_echoes"))).status,503);
    assert.equal(stored.length,before);
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
test("without verified Staging conditions no real Webhook route is mounted",()=>{
  const app=express();
  const noOp={authorizeScope:async()=>true,
    enqueueLive:async()=>{},enqueueHistory:async()=>{},enqueueContacts:async()=>{}};
  assert.equal(registerStagingWhatsappPilotSignedCallback(
    app,noOp,{...env,APP_DEPLOYMENT_MODE:"production"}),false);
  assert.equal(registerStagingWhatsappPilotSignedCallback(
    app,noOp,{...env,WHATSAPP_EMPLOYEE_ARCHIVE_CONTACT_SYNC_READY:"false"}),false);
  assert.equal(registerStagingWhatsappPilotSignedCallback(app,noOp,{}),false);
});
