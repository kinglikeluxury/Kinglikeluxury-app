/**
 * PRIVATE, manually triggered, one-chunk-at-a-time Coexistence history importer.
 * No app startup hook, HTTP route, Meta request, media fetch, scheduler or pool
 * is created by importing this module. The caller supplies a private archive
 * connection authenticated as kinglike_wa_history_importer, an independent
 * AES-256-GCM key, and a live app/consent authorization callback.
 *
 * Claim/retry metadata can change. Historical content and the archive events
 * are NEVER updated or deleted. Archive inserts + chunk state COMMIT together.
 */
import {createDecipheriv,createHash,randomUUID} from "node:crypto";
import type {Pool} from "pg";
import type {HistoryInboxScope} from "./whatsappHistoryDurableInbox";

type Client= {
  query:(sql:string,values?:unknown[])=>Promise<{rows:Array<Record<string,any>>;rowCount?:number|null}>;
  release:()=>void;
};
type Connection={connect:()=>Promise<Client>};
const TABLE="kinglike_whatsapp.whatsapp_employee_history_chunks";
export class HistoryImportUnavailable extends Error {
  constructor(){super("Private history importer is unavailable");this.name="HistoryImportUnavailable";}
}
const fail=():never=>{throw new HistoryImportUnavailable()};
type Job= {
  id:string;
  employee_id:number;
  waba_id:string;
  phone_number_id:string;
  chunk_key:string;
  content_digest:string;
  kind:"chunk"|"declined";
  payload_ciphertext:Buffer;
  payload_iv:Buffer;
  payload_tag:Buffer;
  lease_token:string;
  attempt_count:number;
  // Immutable summary from the signed, preflight-validated history inbox.
  phase:number|null;
  chunk_order:number|null;
  progress:number|null;
  thread_count:number;
  message_count:number;
};
type ParsedHistoryMessage = {
  messageId:string;contact:string;direction:"inbound"|"outbound";kind:string;
  text:string|null;epochSeconds:number;
  mimeType:string|null;sizeBytes:number|null;sha256:string|null;
};
function digits(v:unknown):string {
  return typeof v==="string"?v.replace(/\D/g,""):"";
}
function scopeOk(s:HistoryInboxScope):boolean {
  return !!s && Number.isSafeInteger(s.employeeId)&&s.employeeId>0 &&
    s.employeeId<=2147483647 &&
    /^[0-9]{4,24}$/.test(s.wabaId) &&
    /^[0-9]{4,24}$/.test(s.phoneNumberId) &&
    /^[0-9]{8,24}$/.test(s.displayPhoneNumber);
}
function digest(v:unknown):string {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}
function aad(scope:HistoryInboxScope,job:Job):Buffer {
  return Buffer.from(JSON.stringify([scope.employeeId,scope.wabaId,
    scope.phoneNumberId,String(job.chunk_key).trim(),String(job.content_digest).trim()]),"utf8");
}
function parseMessages(chunk:any,scope:HistoryInboxScope,maxMessages:number):ParsedHistoryMessage[]{
  if(!chunk||typeof chunk!=="object"||Array.isArray(chunk)||
    !Array.isArray(chunk.threads)||chunk.threads.length>5000)fail();
  const output:ParsedHistoryMessage[]=[];
  const seen=new Set<string>();
  for(const thread of chunk.threads){
    // Meta/provider variants sometimes carry outbound history in a separate
    // array. Do not silently mark this chunk imported if that is unhandled.
    if(!thread||typeof thread!=="object"||!Array.isArray(thread.messages) ||
       (Array.isArray(thread.message_echoes) && thread.message_echoes.length>0) ||
       (thread.message_echoes!==undefined && !Array.isArray(thread.message_echoes)))
      fail();
    const contact=digits(thread.id);
    if(!/^[0-9]{8,24}$/.test(contact) || contact===scope.displayPhoneNumber)fail();
    if(thread.messages.length>maxMessages)fail();
    for(const msg of thread.messages){
      if(!msg ||typeof msg!=="object" ||Array.isArray(msg) ||
        typeof msg.id!=="string"||msg.id.length<1||msg.id.length>255 ||
        !/^[\x21-\x7e]+$/.test(msg.id))fail();
      const sender=digits(msg.from);
      const direction=sender===scope.displayPhoneNumber?"outbound":
        sender===contact?"inbound":null;
      if(!direction)fail();
      if(msg.to!==undefined){
        const to=digits(msg.to);
        if(to!==(direction==="outbound"?contact:scope.displayPhoneNumber))fail();
      }
      const type=msg.type;
      if(!["text","image","video","document","audio","sticker"].includes(type))fail();
      const t=Number(msg.timestamp);
      if(!/^[0-9]{10}$/.test(String(msg.timestamp)) ||
        !Number.isSafeInteger(t)||t<946684800||t>4102444800)fail();
      let text:string|null=null;
      if(type==="text"){
        if(typeof msg.text?.body!=="string"||msg.text.body.length>65536)fail();
        text=msg.text.body;
      }else if(["image","video","document"].includes(type)){
        if(typeof msg[type]?.caption==="string"){
          if(msg[type].caption.length>65536)fail();
          text=msg[type].caption;
        }
      }
      const media=type==="text"?null:msg[type];
      const mime=typeof media?.mime_type==="string"&&
        media.mime_type.length<=255?media.mime_type:null;
      const bytes=Number.isSafeInteger(media?.file_size)&&
        media.file_size>=0?media.file_size:null;
      const hex=typeof media?.sha256==="string" && /^[a-f0-9]{64}$/i.test(media.sha256)
        ?media.sha256.toLowerCase():null;
      const key=(direction==="inbound"?"message:":"echo:message:")+msg.id;
      if(seen.has(key))fail(); // ambiguous double content in one chunk
      seen.add(key);
      output.push({messageId:msg.id,contact,direction,
        kind:type,text,epochSeconds:t,mimeType:mime,sizeBytes:bytes,sha256:hex});
      if(output.length>maxMessages)fail();
    }
  }
  return output;
}

function validateHistoryCompleteness(job:Job,chunk:any,messages:ParsedHistoryMessage[]):void {
  // No per-chunk progress flag proves that all past messages arrived.
  // At minimum, require that THIS claimed chunk was imported in full.
  if(job.kind==="declined") {
    if(job.phase!==null || job.chunk_order!==null || job.progress!==null ||
       job.thread_count!==0 || job.message_count!==0 ||
       !Array.isArray(chunk?.errors) || chunk.errors.length!==1 ||
       chunk.errors[0]?.code!==2593109 || chunk.threads!==undefined ||
       messages.length!==0)fail();
    return;
  }
  if(job.kind!=="chunk" || chunk?.errors!==undefined ||
     !Array.isArray(chunk?.threads) ||
     !Number.isSafeInteger(job.phase) ||
     !Number.isSafeInteger(job.chunk_order) ||
     !Number.isSafeInteger(job.progress) ||
     Number(chunk?.metadata?.phase)!==job.phase ||
     Number(chunk?.metadata?.chunk_order)!==job.chunk_order ||
     Number(chunk?.metadata?.progress)!==job.progress ||
     job.thread_count!==chunk.threads.length ||
     job.message_count!==messages.length)fail();
}

export function createPrivateWhatsappHistoryImporter(deps:Readonly<{
  db:Connection;
  encryptionKey:Buffer; // SAME private history key as encrypted history inbox
  authorizeScope:(scope:HistoryInboxScope)=>Promise<boolean>;
  maxAttempts?:number;
  leaseSeconds?:number;
  maxMessagesPerChunk?:number;
}>){
  if(!deps?.db||typeof deps.db.connect!=="function"||
     !Buffer.isBuffer(deps.encryptionKey)||deps.encryptionKey.length!==32||
     typeof deps.authorizeScope!=="function")fail();
  const maxAttempts=deps.maxAttempts??6;
  const leaseSeconds=deps.leaseSeconds??120;
  const maxMessages=deps.maxMessagesPerChunk??5000;
  if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>20 ||
     !Number.isSafeInteger(leaseSeconds)||leaseSeconds<10||leaseSeconds>600 ||
     !Number.isSafeInteger(maxMessages)||maxMessages<1||maxMessages>50000)fail();

  /** Inspect actual LOGIN role, not an environment-claimed role name. */
  async function verifyRole(client:Client):Promise<void>{
    const p=await client.query([
      "SELECT current_database() AS db,current_user AS role,",
      "(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,",
      "(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,",
      "has_table_privilege(current_user,'whatsapp_employee_events','INSERT') AS event_insert,",
      "has_table_privilege(current_user,'whatsapp_employee_events','UPDATE') AS event_update,",
      "has_table_privilege(current_user,'whatsapp_employee_events','DELETE') AS event_delete,",
      "has_table_privilege(current_user,'whatsapp_employee_conversations','INSERT') AS conv_insert,",
      "has_table_privilege(current_user,'kinglike_whatsapp.whatsapp_employee_history_chunks','SELECT') AS history_read,",
      "has_column_privilege(current_user,'kinglike_whatsapp.whatsapp_employee_history_chunks','status','UPDATE') AS status_update,",
      "has_column_privilege(current_user,'kinglike_whatsapp.whatsapp_employee_history_chunks','payload_ciphertext','UPDATE') AS content_update,",
      "has_schema_privilege(current_user,'public','CREATE') AS schema_create",
    ].join(" "));
    const x=p.rows[0]??{};
    if(x.db!=="kinglike_whatsapp_archive"||
       x.role!=="kinglike_wa_history_importer"||x.role===x.owner||
       x.superuser!==false||x.event_insert!==true||x.conv_insert!==true||
       x.history_read!==true||x.status_update!==true||
       x.event_update!==false||x.event_delete!==false||
       x.content_update!==false||x.schema_create!==false)fail();
  }

  async function claim():Promise<Job|null>{
    const db=await deps.db.connect();
    try{
      await verifyRole(db);
      // A repeatedly crashing worker can leave an expired 'processing' lease
      // without executing retry(). Do not re-claim that row indefinitely.
      // Finalize exhausted abandoned leases without ever deleting ciphertext.
      await db.query(
        "UPDATE "+TABLE+" SET status='dead_letter',locked_until=NULL,"+
        "lease_token=NULL,last_error_class=COALESCE(last_error_class,'IMPORT_FAILED')"+
        " WHERE attempt_count >= $1 AND ("+
        " (status IN ('pending','retry') AND available_at<=NOW()) OR"+
        " (status='processing' AND locked_until<NOW()))",
        [maxAttempts],
      );
      const token=randomUUID();
      const r=await db.query([
        "WITH next_job AS (SELECT id FROM "+TABLE,
        "WHERE attempt_count<$3 AND ((status IN ('pending','retry') AND available_at<=NOW())",
        " OR (status='processing' AND locked_until<NOW()))",
        "ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)",
        "UPDATE "+TABLE+" h SET status='processing',attempt_count=h.attempt_count+1,",
        "lease_token=$1::uuid,locked_until=NOW()+($2::int * interval '1 second')",
        "FROM next_job WHERE h.id=next_job.id RETURNING h.id,h.employee_id,",
        "h.waba_id,h.phone_number_id,h.chunk_key,h.content_digest,h.kind,",
        "h.payload_ciphertext,h.payload_iv,h.payload_tag,h.lease_token,h.attempt_count,",
        "h.phase,h.chunk_order,h.progress,h.thread_count,h.message_count",
      ].join(" "),[token,leaseSeconds,maxAttempts]);
      return (r.rows[0] as Job|undefined)??null;
    }finally{db.release();}
  }

  async function retry(job:Job, reason:"POLICY_REVOKED"|"IMPORT_FAILED"|"DECRYPT_FAILED"|"UNSUPPORTED",
    blocked:boolean):Promise<"blocked"|"retry"|"dead_letter"> {
    const status=blocked?"blocked":job.attempt_count>=maxAttempts?"dead_letter":"retry";
    const db=await deps.db.connect();
    try{
      await verifyRole(db);
      const seconds=status==="retry"?Math.min(3600,2**Math.min(job.attempt_count,12)):0;
      const result=await db.query("UPDATE "+TABLE+
        " SET status=$3,available_at=NOW()+($4::int*interval '1 second'),"+
        " locked_until=NULL,lease_token=NULL,last_error_class=$5"+
        " WHERE id=$1 AND lease_token=$2::uuid AND status='processing'",
        [job.id,job.lease_token,status,seconds,reason]);
      if(result.rowCount!==1)fail();
      return status;
    }finally{db.release();}
  }

  async function processOne():Promise<"empty"|"imported"|"declined"|"retry"|"blocked"|"dead_letter"> {
    const job=await claim();
    if(!job)return "empty";
    let plain:Buffer|null=null,reason:"POLICY_REVOKED"|"IMPORT_FAILED"|"DECRYPT_FAILED"|"UNSUPPORTED"="IMPORT_FAILED";
    let scope:HistoryInboxScope|null=null;
    try{
      const client=await deps.db.connect();
      let active=false;
      try{
        await verifyRole(client);
        await client.query("BEGIN");active=true;
        await client.query("SET LOCAL statement_timeout='25000ms'");
        await client.query("SET LOCAL lock_timeout='3000ms'");
        const row=await client.query("SELECT id FROM "+TABLE+
          " WHERE id=$1 AND lease_token=$2::uuid AND status='processing' FOR UPDATE",
          [job.id,job.lease_token]);
        if(row.rows.length!==1)fail();
        const auth=await client.query([
          "SELECT n.display_phone_number",
          "FROM whatsapp_employee_numbers n",
          "JOIN whatsapp_employee_consents c ON",
          "  c.phone_number_id=n.phone_number_id AND c.employee_id=n.employee_id",
          "JOIN public.users u ON u.id=n.employee_id",
          "WHERE n.employee_id=$1 AND n.phone_number_id=$2 AND n.waba_id=$3",
          "AND n.registration_kind='company' AND n.is_active=true",
          "AND n.business_authorized_at IS NOT NULL",
          "AND n.coexistence_enabled=true AND n.coexistence_verified_at IS NOT NULL",
          "AND n.coexistence_verification_ref IS NOT NULL",
          "AND c.status='consented' AND c.consented_at IS NOT NULL",
          "AND c.revoked_at IS NULL AND u.is_active=true AND u.role='sub_agent'",
          "AND u.verified_at > NOW() - interval '5 minutes'",
          "LIMIT 1",
        ].join(" "),[job.employee_id,job.phone_number_id,job.waba_id]);
        const display=digits(auth.rows[0]?.display_phone_number);
        scope={employeeId:Number(job.employee_id),wabaId:job.waba_id,
          phoneNumberId:job.phone_number_id,displayPhoneNumber:display};
        if(!scopeOk(scope) || (await deps.authorizeScope(scope))!==true){
          reason="POLICY_REVOKED";fail();
        }
        reason="DECRYPT_FAILED";
        if(!Buffer.isBuffer(job.payload_ciphertext)||
           job.payload_ciphertext.length===0 ||
           job.payload_ciphertext.length>8*1024*1024 ||
           !Buffer.isBuffer(job.payload_iv)||job.payload_iv.length!==12||
           !Buffer.isBuffer(job.payload_tag)||job.payload_tag.length!==16)fail();
        const decipher=createDecipheriv("aes-256-gcm",deps.encryptionKey,job.payload_iv);
        decipher.setAAD(aad(scope,job));
        decipher.setAuthTag(job.payload_tag);
        plain=Buffer.concat([decipher.update(job.payload_ciphertext),decipher.final()]);
        const chunk=JSON.parse(plain.toString("utf8"));
        if(digest(chunk)!==String(job.content_digest).trim())fail();
        reason="UNSUPPORTED";
        const messages=job.kind==="declined"?[]:parseMessages(chunk,scope,maxMessages);
        validateHistoryCompleteness(job,chunk,messages);
        reason="IMPORT_FAILED";
        for(const msg of messages){
          const conv=await client.query(
            "INSERT INTO whatsapp_employee_conversations"+
            " (employee_id,phone_number_id,waba_id,contact_wa_id)"+
            " VALUES ($1,$2,$3,$4)"+
            " ON CONFLICT(employee_id,phone_number_id,contact_wa_id) DO NOTHING RETURNING id",
            [scope.employeeId,scope.phoneNumberId,scope.wabaId,msg.contact],
          );
          let convId=conv.rows[0]?.id;
          if(!convId){
            const existing=await client.query(
              "SELECT id FROM whatsapp_employee_conversations"+
              " WHERE employee_id=$1 AND phone_number_id=$2"+
              " AND waba_id=$3 AND contact_wa_id=$4 LIMIT 1",
              [scope.employeeId,scope.phoneNumberId,scope.wabaId,msg.contact],
            );
            convId=existing.rows[0]?.id;
          }
          if(!convId)fail();
          const eventKey=(msg.direction==="inbound"?"message:":"echo:message:")+msg.messageId;
          const inserted=await client.query(
            "INSERT INTO whatsapp_employee_events("+
            "conversation_id,employee_id,meta_event_key,meta_message_id,event_kind,"+
            "direction,event_status,message_type,message_text,source_field,occurred_at,"+
            "media_mime_type,media_size_bytes,media_sha256)"+
            " VALUES ($1,$2,$3,$4,'message',$5,NULL,$6,$7,'history',TO_TIMESTAMP($8::double precision),$9,$10,$11)"+
            " ON CONFLICT(meta_event_key) DO NOTHING RETURNING id",
            [convId,scope.employeeId,eventKey,msg.messageId,msg.direction,msg.kind,
              msg.text,msg.epochSeconds,msg.mimeType,msg.sizeBytes,msg.sha256],
          );
          if(inserted.rowCount===0){
            const existing=await client.query(
              "SELECT e.employee_id,e.meta_message_id,e.event_kind,e.direction,"+
              " c.phone_number_id,c.waba_id,c.contact_wa_id"+
              " FROM whatsapp_employee_events e JOIN whatsapp_employee_conversations c"+
              " ON c.id=e.conversation_id WHERE e.meta_event_key=$1",
              [eventKey],
            );
            const e=existing.rows[0];
            if(!e||Number(e.employee_id)!==scope.employeeId||
              e.meta_message_id!==msg.messageId ||e.event_kind!=="message"||
              e.direction!==msg.direction||e.phone_number_id!==scope.phoneNumberId||
              e.waba_id!==scope.wabaId||e.contact_wa_id!==msg.contact)fail();
          }else if(inserted.rowCount!==1)fail();
        }
        if((await deps.authorizeScope(scope))!==true){
          reason="POLICY_REVOKED";fail();
        }
        // The import audit cannot be amended/deleted to conceal a replay.
        await client.query(
          "INSERT INTO whatsapp_employee_audit(employee_id,action,phone_number_id,waba_id,outcome,details)"+
          " VALUES ($1,$2,$3,$4,'recorded',jsonb_build_object('messages',$5::int))",
          [scope.employeeId,job.kind==="declined"?"history_declined":"history_imported",
            scope.phoneNumberId,scope.wabaId,messages.length],
        );
        const done=await client.query("UPDATE "+TABLE+
          " SET status='imported',imported_at=NOW(),locked_until=NULL,lease_token=NULL,"+
          " last_error_class=NULL WHERE id=$1 AND lease_token=$2::uuid AND status='processing'",
          [job.id,job.lease_token],
        );
        if(done.rowCount!==1)fail();
        await client.query("COMMIT");active=false;
        return job.kind==="declined"?"declined":"imported";
      }catch(error){
        if(active)await client.query("ROLLBACK").catch(()=>{});
        throw error;
      }finally{client.release();}
    }catch{
      return retry(job,reason,reason==="POLICY_REVOKED");
    }finally{plain?.fill(0);}
  }

  return Object.freeze({processOne});
}
