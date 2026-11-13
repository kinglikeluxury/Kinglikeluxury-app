/**
 * Private encrypted intake of WhatsApp Business App Coexistence CONTACT state.
 * The sink is not mounted on production, and no DB connection, subscription
 * or migration occurs at import time. An explicit, scoped, dedicated Staging
 * writer and independently verified employee/customer consent are required.
 *
 * Contact state must NEVER be sent to the message queue: a consumer needs to
 * apply add/remove with Meta timestamps, and handle out-of-order delivery.
 */
import {createCipheriv,createHmac,randomBytes} from "node:crypto";
import type {Pool} from "pg";
import {verifyWhatsappSignature} from "./whatsappEmployeeWebhook";
import type {EmployeeInboxScope} from "./whatsappEmployeeDurableInbox";

const TABLE="kinglike_whatsapp.whatsapp_employee_contact_sync_inbox";
export const CONTACT_SYNC_MAX_BYTES=8*1024*1024;
export class ContactSyncInboxRefused extends Error {
  constructor(){super("Private contact-state intake refused");this.name="ContactSyncInboxRefused";}
}
type Query=Pick<Pool,"query">;
type Deps=Readonly<{
  db:Query;
  encryptionKey:Buffer;
  dedupeKey:Buffer;
  metaAppSecret:string;
  authorizeScope:(scope:EmployeeInboxScope)=>Promise<boolean>;
}>;
const reject=():never=>{throw new ContactSyncInboxRefused();};

function validScope(s:EmployeeInboxScope):boolean{
  return !!s && Number.isSafeInteger(s.employeeId) && s.employeeId>0 &&
    s.employeeId<=2147483647 &&
    /^[0-9]{4,24}$/.test(s.wabaId) &&
    /^[0-9]{4,24}$/.test(s.phoneNumberId) &&
    /^[0-9]{8,24}$/.test(s.displayPhoneNumber);
}

/** Reject unknown/mixed fields and fail closed on malformed contact changes. */
export function validateContactSyncEnvelope(
  raw:Buffer,s:EmployeeInboxScope,
):void {
  if(!Buffer.isBuffer(raw)||!raw.length||raw.length>CONTACT_SYNC_MAX_BYTES||
    !validScope(s))reject();
  let payload:any;
  try{payload=JSON.parse(raw.toString("utf8"));}catch{reject();}
  if(payload?.object!=="whatsapp_business_account" ||
    !Array.isArray(payload.entry)||!payload.entry.length||payload.entry.length>20)
    reject();
  let total=0;
  for(const entry of payload.entry){
    if(entry?.id!==s.wabaId || !Array.isArray(entry.changes) ||
      !entry.changes.length || entry.changes.length>40)reject();
    for(const change of entry.changes){
      if(change?.field!=="smb_app_state_sync")reject();
      const v=change.value;
      if(v?.messaging_product!=="whatsapp" ||
        v?.metadata?.phone_number_id!==s.phoneNumberId ||
        String(v?.metadata?.display_phone_number??"").replace(/\D/g,"")!==s.displayPhoneNumber ||
        !Array.isArray(v.state_sync)||!v.state_sync.length||v.state_sync.length>1000)
        reject();
      for(const event of v.state_sync){
        if(event?.type!=="contact" ||
          !["add","remove"].includes(event?.action) ||
          !/^[0-9]{8,16}$/.test(event?.contact?.phone_number??"") ||
          !/^[0-9]{1,13}$/.test(String(event?.metadata?.timestamp??"")))
          reject();
        total++;
        if(total>2000)reject();
      }
    }
  }
  if(total===0)reject();
}
function aad(s:EmployeeInboxScope,deliveryKey:string):Buffer{
  return Buffer.from(JSON.stringify([
    "wa-contacts-v1",s.employeeId,s.wabaId,s.phoneNumberId,
    s.displayPhoneNumber,deliveryKey,
  ]),"utf8");
}

export function createPrivateWhatsappContactSyncInbox(deps:Deps) {
  if(!deps?.db ||typeof deps.db.query!=="function" ||
    !Buffer.isBuffer(deps.encryptionKey)||deps.encryptionKey.length!==32 ||
    !Buffer.isBuffer(deps.dedupeKey)||deps.dedupeKey.length!==32 ||
    deps.dedupeKey.equals(deps.encryptionKey) ||
    typeof deps.metaAppSecret!=="string"||deps.metaAppSecret.length<16||
    typeof deps.authorizeScope!=="function")reject();

  async function enqueueSignedContacts(
    raw:Buffer,signature:unknown,scope:EmployeeInboxScope,
  ):Promise<"accepted"|"duplicate">{
    if(!verifyWhatsappSignature(raw,signature,deps.metaAppSecret))reject();
    validateContactSyncEnvelope(raw,scope);
    if((await deps.authorizeScope(scope))!==true)reject();
    // Keyed deduplication does not expose even a hash of contact names/numbers.
    const key=createHmac("sha256",deps.dedupeKey).update(aad(scope,"raw"))
      .update(raw).digest("hex");
    const iv=randomBytes(12);
    const cipher=createCipheriv("aes-256-gcm",deps.encryptionKey,iv);
    cipher.setAAD(aad(scope,key));
    const ciphertext=Buffer.concat([cipher.update(raw),cipher.final()]);
    const tag=cipher.getAuthTag();
    // Check again immediately before the single atomic INSERT. This does not
    // substitute for serialising consent revocation with queue access in the DB.
    if((await deps.authorizeScope(scope))!==true)reject();
    // pg.query autocommits the INSERT; callers MUST not return HTTP 200 before
    // this promise resolves. No plaintext, phone contacts, or tokens in logs.
    let result:{rowCount:number|null};
    try{
      result=await deps.db.query(
        "INSERT INTO "+TABLE+
        " (employee_id,waba_id,phone_number_id,display_phone_number,"+
        "delivery_key,payload_ciphertext,payload_iv,payload_tag) "+
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8) "+
        "ON CONFLICT (employee_id,waba_id,phone_number_id,delivery_key) DO NOTHING",
        [scope.employeeId,scope.wabaId,scope.phoneNumberId,
          scope.displayPhoneNumber,key,ciphertext,iv,tag],
      );
    }catch{reject();}
    if(result.rowCount===1)return "accepted";
    if(result.rowCount===0)return "duplicate";
    reject();
  }
  return Object.freeze({enqueueSignedContacts});
}
