/**
 * Strict, single-company-number Meta Coexistence callback adapter.
 *
 * This is NOT registered from server/index.ts. A future private deployment
 * must supply independently verified, role-scoped durable queues and an
 * active company number/consent gate before registering it. In particular,
 * never wire it to the existing Meta TEST callback, which discards messages.
 *
 * The adapter never calls Graph API, sends messages, or uses the app/Neon DB.
 * It ACKs ONLY a fully signed, single-kind delivery persisted by its queue.
 * Mixed live/history/contact deliveries deliberately return a retryable 503
 * rather than silently losing part of a one-time history sync.
 */
import {timingSafeEqual} from "node:crypto";
import express,{type Express} from "express";
import {stagingDatabaseIsIsolated} from "./stagingExternalGuard";
import {verifyWhatsappSignature} from "./whatsappEmployeeWebhook";
import {EMPLOYEE_WEBHOOK_MAX_BYTES,type EmployeeInboxScope} from "./whatsappEmployeeDurableInbox";
import {MAX_HISTORY_WEBHOOK_BYTES} from "./whatsappHistoryDurableInbox";

export const WHATSAPP_PILOT_SIGNED_PATH="/api/callbacks/kinglike-employee-wa-pilot";
export type PilotWebhookConfig=Readonly<{
  employeeId:number;
  wabaId:string;
  phoneNumberId:string;
  displayPhoneNumber:string;
  verifyToken:string;
  appSecret:string;
}>;
export type PilotWebhookKind="live"|"history";
export type PilotWebhookDeps=Readonly<{
  // Re-verify current active employee, company number, Meta proof and consent.
  authorizeScope:(s:EmployeeInboxScope)=>Promise<boolean>;
  enqueueLive:(raw:Buffer,signature:string,s:EmployeeInboxScope)=>Promise<unknown>;
  enqueueHistory:(raw:Buffer,signature:string,s:EmployeeInboxScope)=>Promise<unknown>;
}>;

const required=[
  "WHATSAPP_EMPLOYEE_ARCHIVE_STAGING_RUNTIME_ENABLED",
  "WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_ENABLED",
  "WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED",
  "WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED",
  "WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED",
  "WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED",
  "WHATSAPP_EMPLOYEE_ARCHIVE_HISTORY_IMPORT_READY",
  "WHATSAPP_EMPLOYEE_ARCHIVE_PRIVATE_MEDIA_READY",
  "WHATSAPP_EMPLOYEE_ARCHIVE_CONTACT_SYNC_READY",
  "WHATSAPP_EMPLOYEE_ARCHIVE_SIGNED_QUEUE_READY",
];
const numericId=(v:unknown)=>typeof v==="string"&&/^[0-9]{4,24}$/.test(v);
const checkToken=(v:unknown)=>typeof v==="string"&&/^[A-Za-z0-9._~-]{24,128}$/.test(v);

export function stagingPilotWebhookConfig(env:NodeJS.ProcessEnv=process.env):PilotWebhookConfig|null{
  if(env.APP_DEPLOYMENT_MODE!=="staging"||!stagingDatabaseIsIsolated(env)||
    required.some(k=>env[k]!=="true"))return null;
  const id=Number(env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_EMPLOYEE_ID);
  const waba=env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_WABA_ID;
  const phone=env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_PHONE_NUMBER_ID;
  const display=env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_DISPLAY_PHONE;
  const token=env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_VERIFY_TOKEN;
  const secret=env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_META_APP_SECRET;
  if(!Number.isSafeInteger(id)||id<1||id>2147483647 ||
    !numericId(waba)||!numericId(phone)||waba===phone ||
    typeof display!=="string"||!/^[0-9]{8,24}$/.test(display) ||
    !checkToken(token)||typeof secret!=="string"||
    secret.length<16||secret.length>512)return null;
  return {employeeId:id,wabaId:waba!,phoneNumberId:phone!,
    displayPhoneNumber:display,verifyToken:token!,appSecret:secret};
}

export class PilotWebhookRefused extends Error{
  constructor(readonly code:"signature"|"envelope"|"mixed"|"scope"|"persist"){
    super("Signed employee WhatsApp delivery refused");
    this.name="PilotWebhookRefused";
  }
}

export function classifySignedPilotDelivery(
  raw:Buffer,signature:unknown,config:PilotWebhookConfig,
):PilotWebhookKind{
  if(!Buffer.isBuffer(raw)||!raw.length||raw.length>MAX_HISTORY_WEBHOOK_BYTES||
    !verifyWhatsappSignature(raw,signature,config.appSecret))
    throw new PilotWebhookRefused("signature");
  let payload:any;
  try{payload=JSON.parse(raw.toString("utf8"));}catch{throw new PilotWebhookRefused("envelope");}
  if(payload?.object!=="whatsapp_business_account" ||
    !Array.isArray(payload.entry)||!payload.entry.length||
    payload.entry.length>20)throw new PilotWebhookRefused("envelope");
  let kind:PilotWebhookKind|null=null;
  let count=0;
  for(const entry of payload.entry){
    if(entry?.id!==config.wabaId ||!Array.isArray(entry.changes)||
      !entry.changes.length||entry.changes.length>40)
      throw new PilotWebhookRefused("envelope");
    for(const change of entry.changes){
      const metadata=change?.value?.metadata;
      if(metadata?.phone_number_id!==config.phoneNumberId||
        String(metadata?.display_phone_number??"").replace(/\D/g,"")!==config.displayPhoneNumber)
        throw new PilotWebhookRefused("envelope");
      const field=change?.field;
      const next:PilotWebhookKind|undefined=field==="history"?"history":
        field==="messages"||field==="smb_message_echoes"?"live":undefined;
      // A contacts/unrecognized field cannot be ACKed until a separate
      // durable sync handler is connected. Never ACK just the known half.
      if(!next ||(kind!==null&&kind!==next))
        throw new PilotWebhookRefused("mixed");
      kind=next;
      count++;
    }
  }
  if(!kind||count===0)throw new PilotWebhookRefused("envelope");
  if(kind==="live"&&raw.length>EMPLOYEE_WEBHOOK_MAX_BYTES)
    throw new PilotWebhookRefused("envelope");
  return kind;
}

/** No automatic route registration or DB pool; caller controls cutover. */
export function registerStagingWhatsappPilotSignedCallback(
  app:Express,deps:PilotWebhookDeps,env:NodeJS.ProcessEnv=process.env,
):boolean{
  const config=stagingPilotWebhookConfig(env);
  if(!config||!deps||typeof deps.enqueueLive!=="function"||
    typeof deps.enqueueHistory!=="function"||
    typeof deps.authorizeScope!=="function")return false;
  const scope:EmployeeInboxScope={
    employeeId:config.employeeId,wabaId:config.wabaId,
    phoneNumberId:config.phoneNumberId,
    displayPhoneNumber:config.displayPhoneNumber,
  };
  app.get(WHATSAPP_PILOT_SIGNED_PATH,(req,res)=>{
    res.setHeader("Cache-Control","no-store");
    const token=req.query["hub.verify_token"];
    const challenge=req.query["hub.challenge"];
    if(req.query["hub.mode"]!=="subscribe"||
      typeof token!=="string"||typeof challenge!=="string"||
      !/^[A-Za-z0-9_-]{1,256}$/.test(challenge))return res.sendStatus(403);
    const actual=Buffer.from(token,"utf8");
    const expected=Buffer.from(config.verifyToken,"utf8");
    if(actual.length!==expected.length ||!timingSafeEqual(actual,expected))
      return res.sendStatus(403);
    return res.status(200).type("text/plain").send(challenge);
  });
  app.post(WHATSAPP_PILOT_SIGNED_PATH,
    (req,res,next)=>{
      res.setHeader("Cache-Control","no-store");
      if(!String(req.get("content-type")??"").toLowerCase().startsWith("application/json"))
        return res.sendStatus(415);
      next();
    },
    express.raw({type:"application/json",limit:"8mb"}),
    async(req,res)=>{
      const raw=req.body;
      const signature=req.get("x-hub-signature-256");
      let kind:PilotWebhookKind;
      try{kind=classifySignedPilotDelivery(raw,signature,config);}
      catch(e){
        if(e instanceof PilotWebhookRefused)
          return res.sendStatus(e.code==="signature"?401:
            e.code==="mixed"?503:422);
        return res.sendStatus(503);
      }
      try{
        if((await deps.authorizeScope(scope))!==true)return res.sendStatus(503);
        if(typeof signature!=="string")return res.sendStatus(401);
        // Queue callbacks must resolve only AFTER durable COMMIT. Their real
        // implementations independently validate the SAME raw Meta HMAC.
        if(kind==="live")await deps.enqueueLive(raw,signature,scope);
        else await deps.enqueueHistory(raw,signature,scope);
        return res.status(200).type("text/plain").send("EVENT_RECEIVED");
      }catch{return res.sendStatus(503);}
    },
  );
  return true;
}
