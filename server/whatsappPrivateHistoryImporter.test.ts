import test from "node:test";
import assert from "node:assert/strict";
import {createCipheriv,createHash,randomBytes} from "node:crypto";
import {createPrivateWhatsappHistoryImporter,HistoryImportUnavailable}
  from "./whatsappPrivateHistoryImporter";

const key=Buffer.alloc(32,23);
const baseScope={employeeId:101,wabaId:"123456789001",
  phoneNumberId:"123456789002",displayPhoneNumber:"15550000001"};
const business="15550000001",customer="15550000002";
type Row=Record<string,any>;
const message=(id:string,from:string,body:string,to?:string)=>({
  id,from,...(to?{to}:{}),type:"text",text:{body},timestamp:"1794000000",
});
const chunk=(items:unknown[])=>({
  metadata:{phase:0,chunk_order:1,progress:100},
  threads:[{id:customer,messages:items}],
});
function seal(plain:any, id="1",chunkKey="a".repeat(64)):Row {
  const serialized=Buffer.from(JSON.stringify(plain));
  const digest=createHash("sha256").update(JSON.stringify(plain)).digest("hex");
  const iv=randomBytes(12);
  const encrypt=createCipheriv("aes-256-gcm",key,iv);
  encrypt.setAAD(Buffer.from(JSON.stringify([
    baseScope.employeeId,baseScope.wabaId,baseScope.phoneNumberId,
    chunkKey,digest,
  ])));
  const cipher=Buffer.concat([encrypt.update(serialized),encrypt.final()]);
  serialized.fill(0);
  return {id,employee_id:101,waba_id:baseScope.wabaId,
    phone_number_id:baseScope.phoneNumberId,
    chunk_key:chunkKey,content_digest:digest,
    kind:Array.isArray(plain.errors)?"declined":"chunk",
    payload_ciphertext:cipher,payload_iv:iv,payload_tag:encrypt.getAuthTag(),
    attempt_count:0,status:"pending",lease_token:null};
}

function fixture(opts?:{job?:Row;role?:Record<string,any>;authorize?:boolean}){
  let authorize=opts?.authorize??true,shouldFailAudit=false;
  const jobs:Row[]=[opts?.job??seal(chunk([
    message("wamid.IN",customer,"Inbound original"),
    message("wamid.OUT",business,"Outbound original",customer),
  ]))];
  const events=new Map<string,Row>();
  const conversations=new Map<string,Row>();
  const audits:Row[]=[];
  let serial=0,tx:{events:Map<string,Row>;conversations:Map<string,Row>;audits:Row[];statuses:Row[]}|null=null;
  let commits=0,rollbacks=0;
  const proof={
    db:"kinglike_whatsapp_archive",role:"kinglike_wa_history_importer",
    superuser:false,owner:"postgres",event_insert:true,event_update:false,
    event_delete:false,conv_insert:true,history_read:true,status_update:true,
    content_update:false,schema_create:false,...opts?.role,
  };
  const client={
    async query(sql:string,p:unknown[]=[]):Promise<any>{
      if(sql.includes("current_database() AS db"))return {rows:[proof],rowCount:1};
      if(sql.startsWith("WITH next_job AS")){
        const next=jobs.find(x=>["pending","retry"].includes(x.status));
        if(!next)return {rows:[],rowCount:0};
        next.status="processing";next.attempt_count++;
        next.lease_token=p[0];
        return {rows:[{...next}],rowCount:1};
      }
      if(sql==="BEGIN"){
        tx={events:new Map(events),conversations:new Map(conversations),
          audits:[...audits],statuses:jobs.map(x=>({...x}))};
        return {rows:[],rowCount:0};
      }
      if(sql==="ROLLBACK"){
        if(tx){
          events.clear();for(const [k,v]of tx.events)events.set(k,v);
          conversations.clear();for(const [k,v]of tx.conversations)conversations.set(k,v);
          audits.length=0;audits.push(...tx.audits);
          for(let i=0;i<jobs.length;i++)Object.assign(jobs[i],tx.statuses[i]);
        }
        tx=null;rollbacks++;
        return {rows:[],rowCount:0};
      }
      if(sql==="COMMIT"){tx=null;commits++;return {rows:[],rowCount:0};}
      if(sql.startsWith("SET LOCAL"))return {rows:[],rowCount:0};
      if(sql.startsWith("SELECT id FROM kinglike_whatsapp")){
        const hit=jobs.find(x=>x.id===String(p[0])&&x.lease_token===p[1]&&x.status==="processing");
        return {rows:hit?[{id:hit.id}]:[],rowCount:hit?1:0};
      }
      if(sql.startsWith("SELECT n.display_phone_number"))
        return {rows:[{display_phone_number:baseScope.displayPhoneNumber}],rowCount:1};
      if(sql.startsWith("INSERT INTO whatsapp_employee_conversations")){
        const k=p.slice(0,4).join(":");
        if(conversations.has(k))return {rows:[],rowCount:0};
        const row={id:++serial,employee_id:p[0],phone_number_id:p[1],
          waba_id:p[2],contact_wa_id:p[3]};
        conversations.set(k,row);
        return {rows:[{id:row.id}],rowCount:1};
      }
      if(sql.startsWith("SELECT id FROM whatsapp_employee_conversations")){
        const hit=conversations.get(p.slice(0,4).join(":"));
        return {rows:hit?[{id:hit.id}]:[],rowCount:hit?1:0};
      }
      if(sql.startsWith("INSERT INTO whatsapp_employee_events")){
        const eventKey=String(p[2]);
        if(events.has(eventKey))return {rows:[],rowCount:0};
        events.set(eventKey,{id:++serial,conversation_id:p[0],
          employee_id:p[1],meta_event_key:eventKey,meta_message_id:p[3],
          event_kind:"message",direction:p[4],message_type:p[5],
          message_text:p[6],source_field:"history"});
        return {rows:[{id:serial}],rowCount:1};
      }
      if(sql.startsWith("SELECT e.employee_id,e.meta_message_id")){
        const existing=events.get(String(p[0]));
        if(!existing)return {rows:[],rowCount:0};
        return {rows:[{...existing,phone_number_id:baseScope.phoneNumberId,
          waba_id:baseScope.wabaId,contact_wa_id:customer}],rowCount:1};
      }
      if(sql.startsWith("INSERT INTO whatsapp_employee_audit")){
        if(shouldFailAudit)throw Error("Synthetic audit outage");
        audits.push({employee_id:p[0],action:p[1],count:p[4]});
        return {rows:[],rowCount:1};
      }
      if(sql.startsWith("UPDATE kinglike_whatsapp.whatsapp_employee_history_chunks")){
        const row=jobs.find(x=>x.id===String(p[0])&&x.lease_token===p[1]&&x.status==="processing");
        if(!row)return {rows:[],rowCount:0};
        if(sql.includes("status='imported'"))row.status="imported";
        else row.status=p[2];
        row.lease_token=null;
        return {rows:[],rowCount:1};
      }
      throw Error("Unexpected SQL: "+sql.slice(0,110));
    },
    release(){},
  };
  const importer=createPrivateWhatsappHistoryImporter({
    db:{async connect(){return client;}},encryptionKey:key,
    authorizeScope:async()=>authorize,
  });
  return {importer,jobs,events,conversations,audits,
    counters:()=>({commits,rollbacks}),setAuthorize(x:boolean){authorize=x;},
    failAudit(){shouldFailAudit=true;},addJob(j:Row){jobs.push(j);}};
}
test("decrypts history, creates inbound and outbound immutable events, audits, and ACKs atomically",async()=>{
  const f=fixture();
  assert.equal(await f.importer.processOne(),"imported");
  assert.equal(f.events.size,2);
  assert.equal(f.events.get("message:wamid.IN")?.message_text,"Inbound original");
  assert.equal(f.events.get("echo:message:wamid.OUT")?.message_text,"Outbound original");
  assert.equal(f.events.get("echo:message:wamid.OUT")?.source_field,"history");
  assert.equal(f.jobs[0].status,"imported");
  assert.equal(f.audits[0].action,"history_imported");
  assert.deepEqual(f.counters(),{commits:1,rollbacks:0});
  assert.equal(await f.importer.processOne(),"empty");
});
test("out-of-order repeat with same Meta ID dedupes instead of creating duplicate events",async()=>{
  const f=fixture();
  assert.equal(await f.importer.processOne(),"imported");
  const duplicate=seal(chunk([message("wamid.IN",customer,"Inbound original")]),
    "2","b".repeat(64));
  f.addJob(duplicate);
  assert.equal(await f.importer.processOne(),"imported");
  assert.equal(f.events.size,2);
  assert.equal(f.audits.length,2);
});
test("audit failure rolls back all inserted events and retries chunk without ACK",async()=>{
  const f=fixture();f.failAudit();
  assert.equal(await f.importer.processOne(),"retry");
  assert.equal(f.events.size,0);
  assert.equal(f.conversations.size,0);
  assert.equal(f.jobs[0].status,"retry");
  assert.deepEqual(f.counters(),{commits:0,rollbacks:1});
});
test("scope revoked between claim and import blocks without leaking plaintext",async()=>{
  const f=fixture();f.setAuthorize(false);
  assert.equal(await f.importer.processOne(),"blocked");
  assert.equal(f.events.size,0);
  assert.equal(f.jobs[0].status,"blocked");
});
test("tampered AES tag and modified digest never archive messages",async()=>{
  const f=fixture();
  f.jobs[0].payload_tag=Buffer.alloc(16,5);
  assert.equal(await f.importer.processOne(),"retry");
  assert.equal(f.events.size,0);
});
test("declined sharing is audited and marked without writing any fake message",async()=>{
  const f=fixture({job:seal({errors:[{code:2593109}]})});
  assert.equal(await f.importer.processOne(),"declined");
  assert.equal(f.events.size,0);
  assert.equal(f.audits[0].action,"history_declined");
});
test("role owner, superuser, or mutation grant fails closed before claiming",async()=>{
  for(const role of [{role:"postgres"},{superuser:true},
    {owner:"kinglike_wa_history_importer"},{event_update:true},
    {event_insert:false},{content_update:true},{schema_create:true}]){
    const f=fixture({role});
    await assert.rejects(f.importer.processOne(),HistoryImportUnavailable);
    assert.equal(f.events.size,0);
    assert.equal(f.jobs[0].status,"pending");
  }
});
test("unsupported media types fail closed and leave encrypted chunk available for retry",async()=>{
  const payload=chunk([{id:"wamid.UNSUPPORTED",from:customer,to:business,
    type:"contacts",contacts:[],timestamp:"1794000000"}]);
  const f=fixture({job:seal(payload)});
  assert.equal(await f.importer.processOne(),"retry");
  assert.equal(f.events.size,0);
  assert.equal(f.jobs[0].status,"retry");
});
