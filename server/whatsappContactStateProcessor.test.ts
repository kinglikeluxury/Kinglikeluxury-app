import test from "node:test";
import assert from "node:assert/strict";
import {createCipheriv,createHmac,randomBytes} from "node:crypto";
import {
  createPrivateContactStateProcessor,extractScopedContactChanges,
  ContactStateProcessRefused,
} from "./whatsappContactStateProcessor";
import type {EmployeeInboxScope} from "./whatsappEmployeeDurableInbox";

const aes=Buffer.alloc(32,19);
const hmac=Buffer.alloc(32,25);
const scope:EmployeeInboxScope={
  employeeId:101,wabaId:"111111111111",phoneNumberId:"222222222222",
  displayPhoneNumber:"15551230000",
};
const queue=new Map<number,Record<string,any>>();
const state=new Map<string,Record<string,any>>();
let next=1;
function event(action:"add"|"remove",time:string,name="Synthetic Person") {
  return Buffer.from(JSON.stringify({object:"whatsapp_business_account",
    entry:[{id:scope.wabaId,changes:[{field:"smb_app_state_sync",
      value:{messaging_product:"whatsapp",
        metadata:{phone_number_id:scope.phoneNumberId,
          display_phone_number:"+"+scope.displayPhoneNumber},
        state_sync:[{type:"contact",action,
          contact:{full_name:name,first_name:"Synthetic",phone_number:"15550001999"},
          metadata:{timestamp:time}}]}}]}]}),"utf8");
}
function push(raw:Buffer) {
  const deliveryKey="a".repeat(63)+(next%10).toString();
  const iv=randomBytes(12);
  const c=createCipheriv("aes-256-gcm",aes,iv);
  c.setAAD(Buffer.from(JSON.stringify(["wa-contacts-v1",
    scope.employeeId,scope.wabaId,scope.phoneNumberId,
    scope.displayPhoneNumber,deliveryKey]),"utf8"));
  const payload_ciphertext=Buffer.concat([c.update(raw),c.final()]);
  const id=next++;
  queue.set(id,{id,employee_id:scope.employeeId,waba_id:scope.wabaId,
    phone_number_id:scope.phoneNumberId,display_phone_number:scope.displayPhoneNumber,
    delivery_key:deliveryKey,payload_ciphertext,payload_iv:iv,
    payload_tag:c.getAuthTag(),status:"pending"});
  return id;
}
function clone<T>(x:T):T {
  return structuredClone(x);
}
let authorized=true,dbFail=false;
function mockDb(){
  return {connect:async()=>{
    let q:Map<number,Record<string,any>>|null=null;
    let st:Map<string,Record<string,any>>|null=null;
    return {
      release:()=>{},
      query:async(sql:string,params?:unknown[])=>{
        if(dbFail)throw Error("synthetic DB failure");
        if(sql==="BEGIN"){
          q=clone(queue);st=clone(state);
          return {rows:[],rowCount:null};
        }
        if(sql==="COMMIT"){
          assert.ok(q&&st);
          queue.clear();for(const [k,v] of q)queue.set(k,v);
          state.clear();for(const [k,v] of st)state.set(k,v);
          return {rows:[],rowCount:null};
        }
        if(sql==="ROLLBACK")return {rows:[],rowCount:null};
        if(sql.startsWith("SET LOCAL"))return {rows:[],rowCount:null};
        assert.ok(q&&st);
        if(sql.includes("FROM kinglike_whatsapp.whatsapp_employee_contact_sync_inbox") &&
           sql.includes("FOR UPDATE SKIP LOCKED")){
          const job=[...q.values()].find(x=>x.status==="pending");
          return {rows:job?[job]:[],rowCount:job?1:0};
        }
        if(sql.startsWith("INSERT INTO kinglike_whatsapp.whatsapp_employee_contact_state")){
          const p=params??[];
          const key=p.slice(0,4).join("|");
          const old=st.get(key);
          if(!old||BigInt(String(p[4]))>BigInt(old.last_event_epoch)){
            st.set(key,{last_event_epoch:String(p[4]),last_event_digest:p[5],
              is_deleted:p[6],payload_ciphertext:p[7],payload_iv:p[8],payload_tag:p[9]});
            return {rows:[],rowCount:1};
          }
          return {rows:[],rowCount:0};
        }
        if(sql.startsWith("SELECT last_event_epoch,last_event_digest")){
          const key=(params??[]).join("|");
          const old=st.get(key);
          return {rows:old?[old]:[],rowCount:old?1:0};
        }
        if(sql.startsWith("UPDATE kinglike_whatsapp.whatsapp_employee_contact_sync_inbox")){
          const id=Number(params?.[0]);
          const job=q.get(id);
          if(!job||job.status!=="pending")return {rows:[],rowCount:0};
          job.status="processed";job.payload_ciphertext=null;
          job.payload_iv=null;job.payload_tag=null;
          return {rows:[{id}],rowCount:1};
        }
        throw Error("Unexpected SQL (no real DB): "+sql.slice(0,80));
      },
    };
  }};
}
function processor(){
  return createPrivateContactStateProcessor({
    db:mockDb() as never,encryptionKey:aes,dedupeKey:hmac,
    authorizeScope:async s=>authorized && s.employeeId===101 &&
      s.wabaId===scope.wabaId && s.phoneNumberId===scope.phoneNumberId,
  });
}
function reset(){
  queue.clear();state.clear();next=1;authorized=true;dbFail=false;
}

test("contact add, revoke, delayed add: newer delete tombstone wins",async()=>{
  reset();
  const p=processor();
  const add=push(event("add","1763040000"));
  assert.equal(await p.processOne(),"processed");
  assert.equal(queue.get(add)?.payload_ciphertext,null);
  assert.equal(state.size,1);
  assert.equal([...state.values()][0].is_deleted,false);
  const removed=push(event("remove","1763041000"));
  assert.equal(await p.processOne(),"processed");
  const snapshot=[...state.values()][0];
  assert.equal(snapshot.is_deleted,true);
  assert.equal(snapshot.last_event_epoch,"1763041000");
  const old=push(event("add","1763039999"));
  assert.equal(await p.processOne(),"processed");
  assert.equal(queue.get(old)?.status,"processed");
  assert.deepEqual([...state.values()][0],snapshot);
  assert.equal(await p.processOne(),"empty");
  // No raw contact numbers or names in lookup keys or stored plaintext.
  assert.equal(JSON.stringify([...state.entries()]).includes("Synthetic Person"),false);
  assert.equal(JSON.stringify([...state.entries()]).includes("15550001999"),false);
});
test("same timestamp/same payload is idempotent; conflicting version rolls back",async()=>{
  reset();
  const p=processor();
  push(event("add","1763040000"));
  assert.equal(await p.processOne(),"processed");
  const prior=[...state.values()][0];
  push(event("add","1763040000"));
  assert.equal(await p.processOne(),"processed");
  assert.deepEqual([...state.values()][0],prior);
  const conflicting=push(event("remove","1763040000"));
  await assert.rejects(()=>p.processOne(),ContactStateProcessRefused);
  assert.equal(queue.get(conflicting)?.status,"pending");
  assert.deepEqual([...state.values()][0],prior);
});
test("withdrawn consent, corrupted auth tag and DB failure do not persist",async()=>{
  reset();const p=processor();
  const a=push(event("add","1763040000"));
  authorized=false;
  await assert.rejects(()=>p.processOne(),ContactStateProcessRefused);
  assert.equal(queue.get(a)?.status,"pending");assert.equal(state.size,0);
  authorized=true;
  const job=queue.get(a)!;
  job.payload_tag=Buffer.alloc(16);
  await assert.rejects(()=>p.processOne(),ContactStateProcessRefused);
  assert.equal(queue.get(a)?.status,"pending");assert.equal(state.size,0);
  reset();const b=push(event("remove","1763040000"));
  dbFail=true;
  await assert.rejects(()=>p.processOne(),ContactStateProcessRefused);
  assert.equal(queue.get(b)?.status,"pending");assert.equal(state.size,0);
});
test("malformed and wrong phone history/mixed envelopes never become contacts",()=>{
  const good=event("add","1763040000");
  assert.equal(extractScopedContactChanges(good,scope).length,1);
  for(const raw of [
    event("add","99999999999999"),
    event("add","1763040000","x".repeat(300)),
    Buffer.from(good.toString().replace(scope.wabaId,"999999999999"),"utf8"),
    Buffer.from(good.toString().replace("smb_app_state_sync","history"),"utf8"),
  ])assert.throws(()=>extractScopedContactChanges(raw,scope));
});
test("independent keys and explicit DB source are mandatory; no auto connect",()=>{
  assert.throws(()=>createPrivateContactStateProcessor({
    db:mockDb() as never,encryptionKey:aes,dedupeKey:aes,
    authorizeScope:async()=>true,
  }),ContactStateProcessRefused);
  assert.throws(()=>createPrivateContactStateProcessor({
    db:null as never,encryptionKey:aes,dedupeKey:hmac,
    authorizeScope:async()=>true,
  }),ContactStateProcessRefused);
});
