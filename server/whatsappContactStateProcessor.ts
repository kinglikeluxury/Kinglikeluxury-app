/**
 * Private Staging-only encrypted contact-state consumer. No auto registration,
 * network, scheduler, DB connection or migration on import.
 * Caller supplies a dedicated restricted worker DB role AND an independently
 * validated, currently active company number and employee consent source.
 *
 * Entire inbox job and contact updates commit in ONE database transaction.
 * Strict timestamps and tombstones prevent out-of-order resurrection.
 */
import {createDecipheriv,createCipheriv,createHmac,randomBytes} from "node:crypto";
import type {EmployeeInboxScope} from "./whatsappEmployeeDurableInbox";
import {validateContactSyncEnvelope} from "./whatsappContactStateDurableInbox";

const QUEUE="kinglike_whatsapp.whatsapp_employee_contact_sync_inbox";
const STATE="kinglike_whatsapp.whatsapp_employee_contact_state";
export class ContactStateProcessRefused extends Error{
  constructor(){super("Private employee contact-state processing refused");this.name="ContactStateProcessRefused";}
}
const refuse=():never=>{throw new ContactStateProcessRefused();};
export type ContactWorkerStatus="empty"|"processed";
type DbRow=Record<string,any>;
type Tx={query:(sql:string,params?:unknown[])=>Promise<{rows:DbRow[];rowCount:number|null}>;release:()=>void};
type Database={connect:()=>Promise<Tx>};
type Deps=Readonly<{
  db:Database;
  encryptionKey:Buffer; // Same queue AES-256-GCM key; must be isolated
  dedupeKey:Buffer; // Independent HMAC key for lookup and comparison
  authorizeScope:(scope:EmployeeInboxScope)=>Promise<boolean>;
}>;
function mac(key:Buffer,domain:string,value:unknown):string{
  return createHmac("sha256",key).update(domain).update(JSON.stringify(value)).digest("hex");
}
function aad(scope:EmployeeInboxScope,deliveryKey:string):Buffer{
  return Buffer.from(JSON.stringify(["wa-contacts-v1",scope.employeeId,scope.wabaId,
    scope.phoneNumberId,scope.displayPhoneNumber,deliveryKey]),"utf8");
}
function stateAad(scope:EmployeeInboxScope,contactKey:string,timestamp:string):Buffer{
  return Buffer.from(JSON.stringify(["wa-contact-state-v1",scope.employeeId,
    scope.wabaId,scope.phoneNumberId,contactKey,timestamp]),"utf8");
}
type Change={phone:string;action:"add"|"remove";at:string;firstName:string;fullName:string};
export function extractScopedContactChanges(raw:Buffer,scope:EmployeeInboxScope):Change[]{
  validateContactSyncEnvelope(raw,scope);
  const payload=JSON.parse(raw.toString("utf8"));
  const result:Change[]=[];
  for(const entry of payload.entry)for(const change of entry.changes)
    for(const item of change.value.state_sync){
      const contact=item.contact;
      const fullName=contact.full_name??"";
      const firstName=contact.first_name??"";
      if(typeof fullName!=="string"||typeof firstName!=="string"||
        fullName.length>256||firstName.length>128)refuse();
      const at=String(item.metadata.timestamp);
      const epoch=Number(at);
      // Reject unrealistic ancient/future timestamps so clocks cannot
      // poison the current version and suppress legitimate later updates.
      if(!Number.isSafeInteger(epoch)||epoch<1262304000||
         epoch>4102444800)refuse();
      result.push({phone:contact.phone_number,action:item.action,
        at,firstName,fullName});
      if(result.length>2000)refuse();
    }
  return result;
}

export function createPrivateContactStateProcessor(deps:Deps){
  if(!deps?.db||typeof deps.db.connect!=="function"||
    !Buffer.isBuffer(deps.encryptionKey)||deps.encryptionKey.length!==32||
    !Buffer.isBuffer(deps.dedupeKey)||deps.dedupeKey.length!==32||
    deps.dedupeKey.equals(deps.encryptionKey)||
    typeof deps.authorizeScope!=="function")refuse();

  async function processOne():Promise<ContactWorkerStatus>{
    const client=await deps.db.connect();
    let inTransaction=false,raw:Buffer|null=null;
    try{
      await client.query("BEGIN");
      inTransaction=true;
      await client.query("SET LOCAL statement_timeout = '30000ms'");
      await client.query("SET LOCAL lock_timeout = '4000ms'");
      const found=await client.query(
        "SELECT id,employee_id,waba_id,phone_number_id,display_phone_number,"+
        "delivery_key,payload_ciphertext,payload_iv,payload_tag FROM "+QUEUE+
        " WHERE status='pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      const job=found.rows?.[0];
      if(!job){
        await client.query("COMMIT");inTransaction=false;return "empty";
      }
      const scope:EmployeeInboxScope={
        employeeId:Number(job.employee_id),wabaId:String(job.waba_id),
        phoneNumberId:String(job.phone_number_id),
        displayPhoneNumber:String(job.display_phone_number),
      };
      // The stale inbox alone is never proof that this employee is authorized.
      if((await deps.authorizeScope(scope))!==true)refuse();
      if(!Buffer.isBuffer(job.payload_iv)||job.payload_iv.length!==12||
        !Buffer.isBuffer(job.payload_tag)||job.payload_tag.length!==16||
        !Buffer.isBuffer(job.payload_ciphertext)||
        !/^[a-f0-9]{64}$/.test(job.delivery_key))refuse();
      const decrypt=createDecipheriv("aes-256-gcm",deps.encryptionKey,job.payload_iv);
      decrypt.setAAD(aad(scope,job.delivery_key));
      decrypt.setAuthTag(job.payload_tag);
      raw=Buffer.concat([decrypt.update(job.payload_ciphertext),decrypt.final()]);
      const changes=extractScopedContactChanges(raw,scope);
      for(const change of changes){
        const contactKey=mac(deps.dedupeKey,"wa-contact-key-v1",[
          scope.employeeId,scope.wabaId,scope.phoneNumberId,change.phone,
        ]);
        const eventDigest=mac(deps.dedupeKey,"wa-contact-event-v1",[
          contactKey,change.action,change.at,change.firstName,change.fullName,
        ]);
        // Deleted contacts remain as tombstones to prevent old 'add' delivery
        // re-creating them. Only hashes and ciphertext are stored.
        const encoded=Buffer.from(JSON.stringify(change.action==="remove"
          ? {removed:true}
          : {phone:change.phone,firstName:change.firstName,fullName:change.fullName}
        ),"utf8");
        const iv=randomBytes(12);
        const cipher=createCipheriv("aes-256-gcm",deps.encryptionKey,iv);
        cipher.setAAD(stateAad(scope,contactKey,change.at));
        const cipherText=Buffer.concat([cipher.update(encoded),cipher.final()]);
        const tag=cipher.getAuthTag();
        encoded.fill(0);
        const upsert=await client.query(
          "INSERT INTO "+STATE+
          " (employee_id,waba_id,phone_number_id,contact_key,last_event_epoch,"+
          "last_event_digest,is_deleted,payload_ciphertext,payload_iv,payload_tag)"+
          " VALUES($1,$2,$3,$4,$5::bigint,$6,$7,$8,$9,$10)"+
          " ON CONFLICT(employee_id,waba_id,phone_number_id,contact_key)"+
          " DO UPDATE SET last_event_epoch=EXCLUDED.last_event_epoch,"+
          "last_event_digest=EXCLUDED.last_event_digest,"+
          "is_deleted=EXCLUDED.is_deleted,"+
          "payload_ciphertext=EXCLUDED.payload_ciphertext,"+
          "payload_iv=EXCLUDED.payload_iv,payload_tag=EXCLUDED.payload_tag"+
          " WHERE "+STATE+".last_event_epoch < EXCLUDED.last_event_epoch",
          [scope.employeeId,scope.wabaId,scope.phoneNumberId,contactKey,
            change.at,eventDigest,change.action==="remove",cipherText,iv,tag],
        );
        if(upsert.rowCount===0){
          const prior=await client.query(
            "SELECT last_event_epoch,last_event_digest FROM "+STATE+
            " WHERE employee_id=$1 AND waba_id=$2 AND phone_number_id=$3"+
            " AND contact_key=$4 FOR UPDATE",
            [scope.employeeId,scope.wabaId,scope.phoneNumberId,contactKey],
          );
          if(prior.rows.length!==1)refuse();
          const oldTs=BigInt(String(prior.rows[0].last_event_epoch));
          const newTs=BigInt(change.at);
          if(oldTs===newTs &&
            String(prior.rows[0].last_event_digest)!==eventDigest)refuse();
          if(oldTs<newTs)refuse(); // Concurrent anomaly, do not silently drop
        }else if(upsert.rowCount!==1)refuse();
      }
      // Check consent once again before committing; caller must coordinate
      // actual revocations with the same DB's privilege/lock policy.
      if((await deps.authorizeScope(scope))!==true)refuse();
      const done=await client.query("UPDATE "+QUEUE+
        " SET status='processed',payload_ciphertext=NULL,payload_iv=NULL,"+
        "payload_tag=NULL WHERE id=$1 AND status='pending' RETURNING id",
        [job.id]);
      if(done.rowCount!==1)refuse();
      await client.query("COMMIT");inTransaction=false;
      return "processed";
    }catch{
      if(inTransaction)await client.query("ROLLBACK").catch(()=>{});
      refuse();
    }finally{
      if(raw)raw.fill(0);
      client.release();
    }
  }
  return Object.freeze({processOne});
}
