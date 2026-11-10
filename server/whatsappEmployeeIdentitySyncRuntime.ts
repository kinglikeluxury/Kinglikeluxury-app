/**
 * Private Staging-only identity synchronization runner.
 *
 * There is intentionally NO route, startup job, timer or automatic invocation.
 * Opening this runtime requires an explicit reviewed Staging flag, actual
 * privacy/consent approvals, and an independently provisioned NO-SUPERUSER
 * login of the dedicated archive identitysync role. No app, Neon, Meta proof,
 * public host or database-owner credentials are permitted as fallback.
 *
 * Provide source-of-truth app and consent callbacks; NEVER use unverified
 * claims or a stale archive identity row as the authority.
 */
import pg from "pg";
import {stagingDatabaseIsIsolated} from "./stagingExternalGuard";
import {
  createAuditedIdentitySync,createIsolatedIdentitySyncTransaction,
  type IdentitySyncAuthority,
} from "./whatsappEmployeeIdentitySyncCoordinator";

export type IdentitySyncPrivateConfig=Readonly<{connectionString:string;database:"kinglike_whatsapp_archive"}>;

function identity(raw:string|undefined):{host:string;database:string;user:string;password:string}|null {
  if(!raw)return null;
  try {
    const url=new URL(raw);
    if(!["postgres:","postgresql:"].includes(url.protocol) ||
       !url.hostname||!url.username||!url.password||url.hash||url.search)
      return null;
    const db=decodeURIComponent(url.pathname.replace(/^[/]+/,"")).toLowerCase();
    if(!db)return null;
    return {host:url.hostname.toLowerCase(),database:db,
      user:decodeURIComponent(url.username),password:decodeURIComponent(url.password)};
  }catch{return null;}
}

export function identitySyncRuntimeConfig(env:NodeJS.ProcessEnv=process.env):IdentitySyncPrivateConfig|null {
  const policyFlags=[
    "WHATSAPP_EMPLOYEE_IDENTITY_SYNC_ENABLED",
    "WHATSAPP_EMPLOYEE_IDENTITY_SYNC_CONSENT_SOURCE_VERIFIED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED",
  ];
  if(env.APP_DEPLOYMENT_MODE!=="staging" ||
     !stagingDatabaseIsIsolated(env) ||
     policyFlags.some(x=>env[x]!=="true"))return null;

  const raw=env.WHATSAPP_EMPLOYEE_IDENTITY_SYNC_DATABASE_URL;
  const archive=identity(raw);
  const host=env.WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST?.trim().toLowerCase();
  const name=env.WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_NAME?.trim().toLowerCase();
  if(!archive||!raw||!host||!host.endsWith(".railway.internal")||
    name!=="kinglike_whatsapp_archive" ||
    archive.host!==host || archive.database!==name ||
    archive.user!=="kinglike_wa_archive_identitysync"||
    archive.password==="postgres")return null;
  const app=identity(env.APP_STAGING_DATABASE_URL);
  const neon=identity(env.NEON_DATABASE_URL);
  const proof=identity(env.WHATSAPP_STAGING_PROOF_DATABASE_URL);
  if(!app || [app,neon,proof].some(x=>x &&
    (archive.host===x.host||archive.database===x.database)))return null;
  if(archive.host===env.PRODUCTION_DATABASE_HOST?.trim().toLowerCase()||
    archive.database===env.PRODUCTION_DATABASE_NAME?.trim().toLowerCase())return null;
  return {connectionString:raw,database:"kinglike_whatsapp_archive"};
}

/**
 * Only explicit callers receive an operational method.
 * Staging currently lacks approval flags and the DB identity role remains
 * NOLOGIN, so no runner is constructed and no identities are synchronized.
 */
export function createApprovedIdentitySyncRunner(
  authority:IdentitySyncAuthority,
  env:NodeJS.ProcessEnv=process.env,
):null | Readonly<{
  refreshOne:(actorId:number,employeeId:number)=>Promise<"eligible"|"inactive"|"not_mirrored">;
  close:()=>Promise<void>;
}> {
  const conf=identitySyncRuntimeConfig(env);
  if(!conf || typeof authority?.currentAdmin!=="function" ||
    typeof authority?.currentPerson!=="function" ||
    typeof authority?.hasEmployeeConsent!=="function")return null;
  const pool=new pg.Pool({
    connectionString:conf.connectionString,max:1,ssl:false,
    connectionTimeoutMillis:2000,idleTimeoutMillis:3000,
    application_name:"kinglike-wa-isolated-identity-sync",
  });
  const coordinator=createAuditedIdentitySync(
    createIsolatedIdentitySyncTransaction(pool),authority);
  return Object.freeze({
    refreshOne:(actorId:number,employeeId:number)=>
      coordinator.refreshOne(actorId,employeeId,true),
    close:()=>pool.end(),
  });
}
