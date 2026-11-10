/**
 * Live archive read-only HTTP adapter, intentionally not enabled by default.
 * It accepts no media bytes, uploads, exports, sends, number activation or
 * webhook traffic. Only the already-authenticated Kinglike app session may
 * enter. Archive and audit must use TWO separate limited DB login roles.
 */
import type { Express, Request } from "express";
import pg from "pg";
import { stagingDatabaseIsIsolated } from "./stagingExternalGuard";
import { verifyEmployeeArchiveAuditRole } from "./whatsappEmployeeArchiveRuntimeGuard";
import {
  createEmployeeArchiveReadService,LiveArchiveDenied,
  LiveArchiveAuditUnavailable,type LiveArchiveActor,
} from "./whatsappEmployeeArchiveReadService";

type DbIdentity = { hostname:string; database:string; username:string; password:string };
type LiveReadConfig = Readonly<{readerUrl:string;auditUrl:string;hostname:string;database:string}>;
export type LiveArchiveCurrentActor = (req:Request) => Promise<LiveArchiveActor|null>;

function parseUrl(value: string | undefined): DbIdentity | null {
  if (!value) return null;
  try{
    const url=new URL(value);
    if (!["postgres:","postgresql:"].includes(url.protocol) || !url.username ||
        !url.password || url.searchParams.has("options") || url.hash)return null;
    const database=decodeURIComponent(url.pathname.replace(/^[/]+/,"")).toLowerCase();
    if(!database) return null;
    return {hostname:url.hostname.toLowerCase(),database,
      username:decodeURIComponent(url.username),password:decodeURIComponent(url.password)};
  } catch{return null;}
}

export function liveArchiveReadConfig(env:NodeJS.ProcessEnv):LiveReadConfig|null{
  // Multiple independent gates: no use in production, CI or development.
  const required=[
    "WHATSAPP_EMPLOYEE_ARCHIVE_STAGING_RUNTIME_ENABLED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_READONLY_ENABLED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_HISTORY_IMPORT_READY",
    "WHATSAPP_EMPLOYEE_ARCHIVE_PRIVATE_MEDIA_READY",
  ];
  if (env.APP_DEPLOYMENT_MODE!=="staging" || !stagingDatabaseIsIsolated(env) ||
      required.some(k=>env[k]!=="true"))return null;
  const readerUrl=env.WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL;
  const auditUrl=env.WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL;
  const reader=parseUrl(readerUrl);
  const audit=parseUrl(auditUrl);
  const host=env.WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST?.toLowerCase().trim();
  const database=env.WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_NAME?.toLowerCase().trim();
  if (!reader || !audit || !readerUrl || !auditUrl || !host || !database ||
      !host.endsWith(".railway.internal") ||
      database!=="kinglike_whatsapp_archive" ||
      reader.hostname!==host || audit.hostname!==host ||
      reader.database!==database || audit.database!==database ||
      reader.username!=="kinglike_wa_archive_reader" ||
      audit.username!=="kinglike_wa_archive_auditwriter" ||
      reader.password===audit.password)return null;
  // Reject both host AND database collision against all app/proof/Neon DBs.
  for(const raw of [env.APP_STAGING_DATABASE_URL,env.NEON_DATABASE_URL,
      env.WHATSAPP_STAGING_PROOF_DATABASE_URL]){
    const other=parseUrl(raw);
    if(other && (other.hostname===host || other.database===database))return null;
  }
  if(host===env.PRODUCTION_DATABASE_HOST?.toLowerCase() ||
     database===env.PRODUCTION_DATABASE_NAME?.toLowerCase())return null;
  return {readerUrl,auditUrl,hostname:host,database};
}

/** First-party DB role check, not just a configured username string. */
export async function verifyLiveArchiveReader(
  query:(sql:string)=>Promise<{rows:Array<Record<string,unknown>>}>,
  expectedDatabase:string,
):Promise<boolean>{
  try{
    const result=await query([
      "SELECT current_database() AS database_name,current_user AS runtime_role,",
      "(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,",
      "(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,",
      "has_table_privilege(current_user,'public.users','SELECT') AS principals_read,",
      "has_table_privilege(current_user,'whatsapp_employee_numbers','SELECT') AS numbers_read,",
      "has_table_privilege(current_user,'whatsapp_employee_consents','SELECT') AS consents_read,",
      "has_table_privilege(current_user,'whatsapp_employee_conversations','SELECT') AS conversations_read,",
      "has_table_privilege(current_user,'whatsapp_employee_events','SELECT') AS events_read,",
      "has_table_privilege(current_user,'whatsapp_employee_events','INSERT') AS events_insert,",
      "has_table_privilege(current_user,'whatsapp_employee_events','UPDATE') AS events_update,",
      "has_table_privilege(current_user,'whatsapp_employee_events','DELETE') AS events_delete,",
      "has_table_privilege(current_user,'whatsapp_employee_access_audit','SELECT') AS audit_read,",
      "has_table_privilege(current_user,'whatsapp_employee_access_audit','INSERT') AS audit_insert,",
      "has_schema_privilege(current_user,'public','CREATE') AS can_create",
    ].join(" "));
    const x=result.rows[0]??{};
    return x.database_name===expectedDatabase &&
      x.runtime_role==="kinglike_wa_archive_reader" &&
      x.runtime_role!==x.owner && x.superuser===false &&
      ["principals_read","numbers_read","consents_read","conversations_read",
        "events_read"].every(k=>x[k]===true) &&
      ["events_insert","events_update","events_delete","audit_read",
        "audit_insert","can_create"].every(k=>x[k]===false);
  }catch{return false;}
}

function idParam(s:unknown):number|null{
  if(typeof s!=="string"||!/^[1-9][0-9]{0,14}$/.test(s))return null;
  const n=Number(s);
  return Number.isSafeInteger(n)&&n>0?n:null;
}

export function registerWhatsappEmployeeLiveArchiveReadRoutes(
  app:Express,
  options:{
    env?:NodeJS.ProcessEnv;
    authorizeCurrentActor:LiveArchiveCurrentActor;
    verifyCurrentSubject:(employeeId:number)=>Promise<boolean>;
  },
):boolean{
  const config=liveArchiveReadConfig(options.env??process.env);
  if(!config) return false;
  if(typeof options.verifyCurrentSubject!=="function")return false;
  // Pools are lazy; no DB traffic during application startup/import.
  const readerPool=new pg.Pool({
    connectionString:config.readerUrl,max:2,connectionTimeoutMillis:1800,
    idleTimeoutMillis:3500,ssl:false,
  });
  const auditPool=new pg.Pool({
    connectionString:config.auditUrl,max:2,connectionTimeoutMillis:1800,
    idleTimeoutMillis:3500,ssl:false,
  });
  const service=createEmployeeArchiveReadService({
    archive:readerPool,audit:auditPool,verifyCurrentSubject:options.verifyCurrentSubject,
  });

  async function read(req:any,res:any,action:(actor:LiveArchiveActor)=>Promise<unknown>) {
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Pragma","no-cache");
    const userId=Number(req.session?.userId);
    if(!Number.isSafeInteger(userId)||userId<1)return res.sendStatus(401);
    try{
      const actor=await options.authorizeCurrentActor(req);
      if(!actor||actor.id!==userId)return res.sendStatus(403);
      if(!(await verifyLiveArchiveReader(
        sql=>readerPool.query(sql),config.database)) ||
         !(await verifyEmployeeArchiveAuditRole(
        sql=>auditPool.query(sql),config.database)))return res.sendStatus(503);
      const data=await action(actor);
      return res.status(200).json(data);
    }catch(error){
      if(error instanceof LiveArchiveDenied)return res.sendStatus(403);
      if(error instanceof LiveArchiveAuditUnavailable)return res.sendStatus(503);
      return res.sendStatus(503);
    }
  }

  app.get("/api/whatsapp-employee/archive/scopes",(req,res)=>
    void read(req,res,actor=>service.scopes(actor)));
  app.get("/api/whatsapp-employee/archive/employees/:employeeId/conversations",
    (req,res)=>{
      const employeeId=idParam(req.params.employeeId);
      if(!employeeId)return res.sendStatus(400);
      void read(req,res,actor=>service.conversations(actor,employeeId));
    });
  app.get("/api/whatsapp-employee/archive/conversations/:conversationId/messages",
    (req,res)=>{
      const conversationId=idParam(req.params.conversationId);
      if(!conversationId)return res.sendStatus(400);
      void read(req,res,actor=>service.messages(actor,conversationId));
    });
  return true;
}
