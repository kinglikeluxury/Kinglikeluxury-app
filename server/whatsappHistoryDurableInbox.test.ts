import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {
  createPrivateWhatsappHistoryInbox,HistoryInboxRefused,MAX_HISTORY_WEBHOOK_BYTES,
} from "./whatsappHistoryDurableInbox";

const scope={employeeId:101,wabaId:"123456789001",
  phoneNumberId:"123456789002",displayPhoneNumber:"15550000001"};
const secret="independent-synthetic-meta-secret";
const key=Buffer.alloc(32,22);
const chunk=(order:number,body="SENSITIVE SYNTHETIC CUSTOMER HISTORY")=>({
  metadata:{phase:0,chunk_order:order,progress:order===2?100:50},
  threads:[{id:"15550000002",messages:[{id:"wamid.synthetic",
    from:"15550000002",timestamp:"1800000000",type:"text",text:{body}}]}],
});
const raw=(items:unknown[],field="history")=>Buffer.from(JSON.stringify({
  object:"whatsapp_business_account",
  entry:[{id:scope.wabaId,changes:[{field,value:{
    messaging_product:"whatsapp",
    metadata:{phone_number_id:scope.phoneNumberId,
      display_phone_number:scope.displayPhoneNumber},
    history:items,
  }}]}],
}),"utf8");
const sig=(buffer:Buffer)=>"sha256="+createHmac("sha256",secret).update(buffer).digest("hex");

function fakeDb(){
  let inTx=false,commit=0,rollback=0,connect=0;
  const saved=new Map<string,{digest:string;encrypted:Buffer}>();
  const pending=new Map<string,{digest:string;encrypted:Buffer}>();
  let writeFail=false,authorized=true;
  const client={
    async query(sql:string,params:unknown[]=[]):Promise<any>{
      if(sql==="BEGIN"){inTx=true;pending.clear();return {rows:[],rowCount:0};}
      if(sql.startsWith("SET LOCAL"))return {rows:[],rowCount:0};
      if(sql==="COMMIT"){
        for(const [k,v] of pending)saved.set(k,v);
        pending.clear();inTx=false;commit++;return {rows:[],rowCount:0};
      }
      if(sql==="ROLLBACK"){pending.clear();inTx=false;rollback++;return {rows:[],rowCount:0};}
      if(sql.includes("INSERT INTO kinglike_whatsapp.whatsapp_employee_history_chunks")){
        if(!inTx || writeFail)throw new Error("synthetic-DB-write-failed");
        assert.ok(!sql.includes("RETURNING")); // no SELECT primary key required
        assert.equal(params[0],scope.employeeId);
        const id=String(params[3]);
        const already=pending.get(id)??saved.get(id);
        if(already)return {rows:[],rowCount:0};
        pending.set(id,{digest:String(params[4]),encrypted:params[11] as Buffer});
        return {rows:[],rowCount:1};
      }
      if(sql.startsWith("SELECT content_digest FROM kinglike_whatsapp")){
        const v=pending.get(String(params[3]))??saved.get(String(params[3]));
        return {rows:v?[{content_digest:v.digest}]:[],rowCount:v?1:0};
      }
      throw new Error("unexpected SQL "+sql.slice(0,55));
    },
    release(){},
  };
  const db={async connect(){connect++;return client;}};
  const inbox=createPrivateWhatsappHistoryInbox({
    db,encryptionKey:key,metaAppSecret:secret,authorizeScope:async()=>authorized,
  });
  return {inbox,db,saved,stats:()=>({connect,commit,rollback,inTx}),
    disallow(){authorized=false;},failWrites(){writeFail=true;},
    tamperDigest(){const id=[...saved.keys()][0];if(id){
      const old=saved.get(id)!;saved.set(id,{...old,digest:"0".repeat(64)});
    }}};
}
test("signed history chunk accepted, encrypted, replay deduped and no body leakage",async()=>{
  const f=fakeDb();
  const payload=raw([chunk(1),chunk(2)]);
  const a=await f.inbox.enqueueSignedHistory(payload,sig(payload),scope);
  assert.deepEqual(a,{accepted:2,duplicates:0,declined:0});
  assert.equal(f.saved.size,2);
  for(const x of f.saved.values()){
    assert.ok(Buffer.isBuffer(x.encrypted));
    assert.ok(!x.encrypted.toString("utf8").includes("SENSITIVE"));
  }
  const duplicate=await f.inbox.enqueueSignedHistory(payload,sig(payload),scope);
  assert.deepEqual(duplicate,{accepted:0,duplicates:2,declined:0});
  assert.equal(f.saved.size,2);
});
test("conflicting chunks cannot be acknowledged or partially committed",async()=>{
  const f=fakeDb();
  const first=raw([chunk(1)]),conflict=raw([chunk(1,"OTHER CUSTOMER CONTENT")]);
  await f.inbox.enqueueSignedHistory(first,sig(first),scope);
  const prev=f.saved.size;
  await assert.rejects(f.inbox.enqueueSignedHistory(conflict,sig(conflict),scope),HistoryInboxRefused);
  assert.equal(f.saved.size,prev);
  assert.equal(f.stats().rollback,1);
  f.tamperDigest();
  await assert.rejects(f.inbox.enqueueSignedHistory(first,sig(first),scope),HistoryInboxRefused);
});
test("rollback all chunks on DB failure; never ACK before commit",async()=>{
  const f=fakeDb();f.failWrites();
  const buffer=raw([chunk(1),chunk(2)]);
  await assert.rejects(f.inbox.enqueueSignedHistory(buffer,sig(buffer),scope),HistoryInboxRefused);
  assert.equal(f.saved.size,0);
  assert.equal(f.stats().rollback,1);
  assert.equal(f.stats().commit,0);
});
test("bad HMAC, scope, consent, oversize and mixed contact/message fields are rejected",async()=>{
  const f=fakeDb();
  const b=raw([chunk(1)]);
  await assert.rejects(f.inbox.enqueueSignedHistory(b,"sha256="+"0".repeat(64),scope),HistoryInboxRefused);
  await assert.rejects(f.inbox.enqueueSignedHistory(b,sig(b),{...scope,employeeId:0}),HistoryInboxRefused);
  await assert.rejects(f.inbox.enqueueSignedHistory(Buffer.alloc(MAX_HISTORY_WEBHOOK_BYTES+1),sig(b),scope),HistoryInboxRefused);
  f.disallow();
  await assert.rejects(f.inbox.enqueueSignedHistory(b,sig(b),scope),HistoryInboxRefused);
  const other=fakeDb();
  for(const type of ["messages","smb_app_state_sync","unknown"]){
    const mixed=raw([chunk(1)],type);
    await assert.rejects(other.inbox.enqueueSignedHistory(mixed,sig(mixed),scope),HistoryInboxRefused);
  }
  const mixed=JSON.parse(b.toString());
  mixed.entry[0].changes.push({field:"messages",value:{metadata:{
    phone_number_id:scope.phoneNumberId,display_phone_number:scope.displayPhoneNumber}}});
  const rawMixed=Buffer.from(JSON.stringify(mixed));
  await assert.rejects(other.inbox.enqueueSignedHistory(rawMixed,sig(rawMixed),scope),HistoryInboxRefused);
  assert.equal(f.stats().connect,0);
  assert.equal(other.stats().connect,0);
});
test("declined history sharing recorded separately without materializing contacts",async()=>{
  const f=fakeDb();
  const declined=raw([{errors:[{code:2593109,title:"History sharing declined"}]}]);
  const a=await f.inbox.enqueueSignedHistory(declined,sig(declined),scope);
  assert.deepEqual(a,{accepted:1,duplicates:0,declined:1});
  assert.equal(f.saved.size,1);
});
