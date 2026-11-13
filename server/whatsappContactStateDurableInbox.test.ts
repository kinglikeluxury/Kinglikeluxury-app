import test from "node:test";
import assert from "node:assert/strict";
import {createHmac,createDecipheriv} from "node:crypto";
import {
  createPrivateWhatsappContactSyncInbox,validateContactSyncEnvelope,
  ContactSyncInboxRefused,
} from "./whatsappContactStateDurableInbox";
import type {EmployeeInboxScope} from "./whatsappEmployeeDurableInbox";

const scope:EmployeeInboxScope={
  employeeId:101,wabaId:"11111111111",phoneNumberId:"22222222222",
  displayPhoneNumber:"15551230001",
};
const secret="test-only-staging-meta-secret-2026";
const aes=Buffer.alloc(32,27),hmac=Buffer.alloc(32,38);
const event=(field="smb_app_state_sync",action="add")=>Buffer.from(JSON.stringify({
  object:"whatsapp_business_account",entry:[{
    id:scope.wabaId,changes:[{field,value:{
      messaging_product:"whatsapp",
      metadata:{phone_number_id:scope.phoneNumberId,
        display_phone_number:"+"+scope.displayPhoneNumber},
      state_sync:[{type:"contact",action,
        contact:{full_name:"Synthetic Test Person",phone_number:"15559876543"},
        metadata:{timestamp:"1763040000"}}],
    }}],
  }],
}),"utf8");
const signed=(v:Buffer)=>"sha256="+createHmac("sha256",secret).update(v).digest("hex");

test("synthetic contact updates are encrypted, scoped and committed before ACK",async()=>{
  let authorized=true,failed=false,inserted=0;
  const inserts:unknown[][]=[];
  const db={query:async (_sql:string,params?:unknown[])=>{
    if(failed)throw Error("simulated database failure");
    assert.ok(_sql.startsWith("INSERT INTO kinglike_whatsapp.whatsapp_employee_contact_sync_inbox"));
    assert.ok(!_sql.includes("RETURNING")&&!_sql.includes("DELETE "));
    const p=params??[];
    inserts.push(p);
    inserted++;
    return {rowCount:1};
  }};
  const intake=createPrivateWhatsappContactSyncInbox({
    db:db as never,encryptionKey:aes,dedupeKey:hmac,metaAppSecret:secret,
    authorizeScope:async s=>authorized&&s.employeeId===scope.employeeId,
  });
  const raw=event();
  assert.equal(await intake.enqueueSignedContacts(raw,signed(raw),scope),"accepted");
  assert.equal(inserted,1);
  const p=inserts[0] as unknown[];
  const ciphertext=p[5] as Buffer;
  assert.ok(Buffer.isBuffer(ciphertext));
  assert.equal(ciphertext.includes(Buffer.from("Synthetic Test Person")),false);
  assert.equal(JSON.stringify(p.slice(0,5)).includes("Synthetic Test Person"),false);
  const aad=Buffer.from(JSON.stringify([
    "wa-contacts-v1",scope.employeeId,scope.wabaId,scope.phoneNumberId,
    scope.displayPhoneNumber,p[4],
  ]),"utf8");
  const dec=createDecipheriv("aes-256-gcm",aes,p[6] as Buffer);
  dec.setAAD(aad);dec.setAuthTag(p[7] as Buffer);
  assert.equal(Buffer.concat([dec.update(ciphertext),dec.final()]).toString("utf8"),
    raw.toString("utf8"));
  authorized=false;
  await assert.rejects(()=>intake.enqueueSignedContacts(raw,signed(raw),scope),
    ContactSyncInboxRefused);
  assert.equal(inserted,1);
  authorized=true;failed=true;
  await assert.rejects(()=>intake.enqueueSignedContacts(raw,signed(raw),scope),
    ContactSyncInboxRefused);
  assert.equal(inserted,1);
});

test("bad signature, wrong WABA, mixed kinds and malformed contact are refused",async()=>{
  let saved=0;
  const intake=createPrivateWhatsappContactSyncInbox({
    db:{query:async()=>{saved++;return {rowCount:1};}} as never,
    encryptionKey:aes,dedupeKey:hmac,metaAppSecret:secret,
    authorizeScope:async()=>true,
  });
  const raw=event();
  await assert.rejects(()=>intake.enqueueSignedContacts(raw,"sha256="+"0".repeat(64),scope),ContactSyncInboxRefused);
  for(const bad of [
    event("messages"),
    event("history"),
    event("smb_app_state_sync","unknown"),
    Buffer.from(raw.toString().replace(scope.wabaId,"999999999999"),"utf8"),
    Buffer.from(raw.toString().replace("15559876543","invalid"),"utf8"),
    Buffer.from(raw.toString().replace("1763040000","not-time"),"utf8"),
  ]){
    assert.throws(()=>validateContactSyncEnvelope(bad,scope),ContactSyncInboxRefused);
    await assert.rejects(()=>intake.enqueueSignedContacts(bad,signed(bad),scope),ContactSyncInboxRefused);
  }
  assert.equal(saved,0);
});

test("duplicate insert and missing DB role fail closed",async()=>{
  const raw=event();
  const duplicating=createPrivateWhatsappContactSyncInbox({
    db:{query:async()=>({rowCount:0})} as never,
    encryptionKey:aes,dedupeKey:hmac,metaAppSecret:secret,
    authorizeScope:async()=>true,
  });
  assert.equal(await duplicating.enqueueSignedContacts(raw,signed(raw),scope),"duplicate");
  assert.throws(()=>createPrivateWhatsappContactSyncInbox({
    db:{query:async()=>({rowCount:1})} as never,
    encryptionKey:aes,dedupeKey:aes,metaAppSecret:secret,
    authorizeScope:async()=>true,
  }),ContactSyncInboxRefused);
});
