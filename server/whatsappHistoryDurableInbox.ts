/**
 * Dedicated, encrypted, loss-averse one-time Meta Coexistence HISTORY receiver.
 *
 * NOT a public route, worker, history importer, media downloader or scheduler.
 * A future signed webhook adapter must route "history" to this module and
 * ACK ONLY after enqueueSignedHistory() resolves with a committed transaction.
 *
 * Does not reuse the ordinary WhatsApp message queue. Until a separately
 * approved importer is built, ciphertext remains pending in its own table.
 */
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { verifyWhatsappSignature } from "./whatsappEmployeeWebhook";
import {
  summarizeVerifiedHistoryWebhook, InvalidHistoryPayload,
  type ExpectedHistoryBusiness,type HistoryBatchSummary,
} from "./whatsappHistorySyncPreflight";

const TABLE = "kinglike_whatsapp.whatsapp_employee_history_chunks";
export const MAX_HISTORY_WEBHOOK_BYTES = 8 * 1024 * 1024;

export type HistoryInboxScope = ExpectedHistoryBusiness & Readonly<{employeeId:number}>;
export type HistoryInboxResult = Readonly<{accepted:number; duplicates:number; declined:number}>;

export class HistoryInboxRefused extends Error {
  constructor(){super("Signed private history intake refused");this.name="HistoryInboxRefused";}
}

type HistoryClient = {
  query:(sql:string,values?:unknown[])=>Promise<{
    rows:Array<Record<string,any>>;rowCount?:number|null;
  }>;
  release:()=>void;
};
type HistoryDb = {connect:()=>Promise<HistoryClient>};

function reject():never{throw new HistoryInboxRefused();}
function validScope(s:HistoryInboxScope):boolean{
  return !!s && Number.isSafeInteger(s.employeeId)&&s.employeeId>0 &&
    s.employeeId<=2147483647 &&
    /^[0-9]{4,24}$/.test(s.wabaId) &&
    /^[0-9]{4,24}$/.test(s.phoneNumberId) &&
    /^[0-9]{8,24}$/.test(s.displayPhoneNumber);
}
function digest(v:unknown):string{
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}
function extractItems(payload:any,scope:HistoryInboxScope,
  summaries:HistoryBatchSummary[]):Array<{summary:HistoryBatchSummary;plain:Buffer}>{
  const byKey=new Map(summaries.map(x=>[x.chunkKey,x]));
  const unique=new Map<string,{summary:HistoryBatchSummary;plain:Buffer}>();
  for(const entry of payload.entry){
    for(const change of entry.changes){
      for(const chunk of change.value.history){
        const declined=Array.isArray(chunk?.errors);
        const key=digest(declined
          ? [scope.wabaId,scope.phoneNumberId,"declined"]
          : [scope.wabaId,scope.phoneNumberId,
              Number(chunk.metadata?.phase),Number(chunk.metadata?.chunk_order)]);
        const summary=byKey.get(key);
        if(!summary || digest(chunk)!==summary.contentDigest)reject();
        const existing=unique.get(key);
        if(existing){
          if(existing.summary.contentDigest!==summary.contentDigest)reject();
          continue;
        }
        unique.set(key,{summary,plain:Buffer.from(JSON.stringify(chunk),"utf8")});
      }
    }
  }
  if(unique.size!==summaries.length || !unique.size)reject();
  return [...unique.values()];
}
function assertHistoryOnly(payload:any):void{
  if(!payload || payload.object!=="whatsapp_business_account" ||
    !Array.isArray(payload.entry) || payload.entry.length===0 ||
    payload.entry.length>20)reject();
  for(const e of payload.entry){
    if(!e || !Array.isArray(e.changes) || e.changes.length===0 ||
      e.changes.length>40)reject();
    for(const c of e.changes){
      if(c?.field!=="history")reject(); // Reject mixed/live/contact events.
    }
  }
}
function aad(scope:HistoryInboxScope,summary:HistoryBatchSummary):Buffer{
  return Buffer.from(JSON.stringify([
    scope.employeeId,scope.wabaId,scope.phoneNumberId,
    summary.chunkKey,summary.contentDigest,
  ]),"utf8");
}

export function createPrivateWhatsappHistoryInbox(deps:Readonly<{
  db:HistoryDb;
  metaAppSecret:string;
  encryptionKey:Buffer; // independent AES-256-GCM key, not app/database secret
  authorizeScope:(scope:HistoryInboxScope)=>Promise<boolean>;
}>) {
  if(!deps?.db || typeof deps.db.connect!=="function" ||
    !deps.metaAppSecret || typeof deps.metaAppSecret!=="string" ||
    !Buffer.isBuffer(deps.encryptionKey) || deps.encryptionKey.length!==32 ||
    typeof deps.authorizeScope!=="function")reject();

  async function enqueueSignedHistory(
    raw:Buffer,signature:unknown,scope:HistoryInboxScope,
  ):Promise<HistoryInboxResult>{
    if(!validScope(scope) || !Buffer.isBuffer(raw) ||
      raw.length<1 || raw.length>MAX_HISTORY_WEBHOOK_BYTES ||
      !verifyWhatsappSignature(raw,signature,deps.metaAppSecret))reject();

    let parsed:any;
    try {parsed=JSON.parse(raw.toString("utf8"));}catch{reject();}
    assertHistoryOnly(parsed);
    let items:Array<{summary:HistoryBatchSummary;plain:Buffer}>;
    try {
      const summaries=summarizeVerifiedHistoryWebhook(parsed,scope);
      items=extractItems(parsed,scope,summaries);
    } catch(error){
      if(error instanceof InvalidHistoryPayload)reject();
      throw new HistoryInboxRefused();
    }
    if((await deps.authorizeScope(scope))!==true)reject();

    const client=await deps.db.connect();
    let transaction=false;
    let accepted=0,duplicates=0,declined=0;
    try {
      await client.query("BEGIN");
      transaction=true;
      await client.query("SET LOCAL statement_timeout='20000ms'");
      await client.query("SET LOCAL lock_timeout='3000ms'");
      // Verify the current employee/number authorization again while the
      // transaction is open. A future operator must coordinate enrollment
      // updates with this same scope; this guard still fails closed on error.
      if((await deps.authorizeScope(scope))!==true)reject();

      for(const {summary,plain} of items){
        const iv=randomBytes(12);
        const cipher=createCipheriv("aes-256-gcm",deps.encryptionKey,iv);
        cipher.setAAD(aad(scope,summary));
        const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);
        const tag=cipher.getAuthTag();
        // No RETURNING: the webhook writer must never require SELECT over
        // the encrypted content or even the generated primary key.
        const inserted=await client.query([
          "INSERT INTO "+TABLE,
          "(employee_id,waba_id,phone_number_id,chunk_key,content_digest,",
          "kind,phase,chunk_order,progress,thread_count,message_count,",
          "payload_ciphertext,payload_iv,payload_tag)",
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
          "ON CONFLICT(employee_id,waba_id,phone_number_id,chunk_key) DO NOTHING",
        ].join(" "),[
          scope.employeeId,scope.wabaId,scope.phoneNumberId,
          summary.chunkKey,summary.contentDigest,summary.kind,
          summary.phase,summary.chunkOrder,summary.progress,
          summary.threadCount,summary.messageCount,ciphertext,iv,tag,
        ]);
        if(inserted.rowCount===1)accepted++;
        else if(inserted.rowCount===0){
          // Conflicting duplicate phase/order MUST NOT be acknowledged.
          const seen=await client.query(
            "SELECT content_digest FROM "+TABLE+
            " WHERE employee_id=$1 AND waba_id=$2 AND phone_number_id=$3 AND chunk_key=$4",
            [scope.employeeId,scope.wabaId,scope.phoneNumberId,summary.chunkKey],
          );
          if(seen.rows.length!==1 ||
             String(seen.rows[0].content_digest).trim()!==summary.contentDigest)reject();
          duplicates++;
        }else reject();
        if(summary.kind==="declined")declined++;
        plain.fill(0);
      }
      await client.query("COMMIT");transaction=false;
      return {accepted,duplicates,declined};
    }catch{
      if(transaction)await client.query("ROLLBACK").catch(()=>{});
      throw new HistoryInboxRefused();
    }finally{
      for(const item of items)item.plain.fill(0);
      client.release();
    }
  }
  return Object.freeze({enqueueSignedHistory});
}
