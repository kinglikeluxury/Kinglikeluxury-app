import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectEmployeeArchiveReadiness,
  verifyEmployeeArchiveDatabaseGrants,
  verifyEmployeeArchiveAuditRole,
} from "./whatsappEmployeeArchiveRuntimeGuard";

const key = (byte: number) => Buffer.alloc(32,byte).toString("base64");

const isolated: NodeJS.ProcessEnv = {
  APP_DEPLOYMENT_MODE:"staging",
  APP_STAGING_DATABASE_URL:"postgresql://app:password@app-staging.railway.internal/kinglike_staging",
  APP_STAGING_DATABASE_EXPECTED_HOST:"app-staging.railway.internal",
  APP_STAGING_DATABASE_EXPECTED_NAME:"kinglike_staging",
  APP_STAGING_DATABASE_CONFIRMATION:"verified-staging",
  APP_STAGING_STORAGE_CONFIRMATION:"verified-storage",
  PRODUCTION_DATABASE_HOST:"ep-live.neon.tech",
  PRODUCTION_DATABASE_NAME:"neondb",
  NEON_DATABASE_URL:"postgresql://owner:secret@ep-live.neon.tech/neondb",
  WHATSAPP_STAGING_PROOF_DATABASE_URL:"postgresql://proof:secret@proof-staging.railway.internal/whatsapp_proof",
  WHATSAPP_EMPLOYEE_ARCHIVE_STAGING_RUNTIME_ENABLED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_HISTORY_IMPORT_READY:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_PRIVATE_MEDIA_READY:"true",
  WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST:"archive-staging.railway.internal",
  WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_NAME:"whatsapp_archive",
  WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:"postgresql://archiveworker:secret@archive-staging.railway.internal/whatsapp_archive",
  WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL:"postgresql://auditwriter:secret@archive-staging.railway.internal/whatsapp_archive",
  WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64:key(1),
  WHATSAPP_EMPLOYEE_INBOX_HMAC_KEY_B64:key(2),
};

function ready(env: NodeJS.ProcessEnv) {
  return inspectEmployeeArchiveReadiness(env);
}

test("archive is disabled by default, even if old Meta setup variables exist", () => {
  const empty = ready({APP_DEPLOYMENT_MODE:"staging"});
  assert.equal(empty.public.status,"disabled");
  assert.equal(empty.privateConfig,null);
  assert.equal(empty.public.liveNumbers,"not_verified");
  assert.equal(empty.public.webhookActive,false);
  assert.ok(empty.public.blockers.includes("runtime_disabled"));
});

test("valid staging DB identity, two roles and independent keys are necessary but not sufficient", () => {
  const result = ready(isolated);
  assert.equal(result.public.checks.isolatedApp,true);
  assert.equal(result.public.checks.archiveDbIdentity,true);
  assert.equal(result.public.checks.separateAuditRole,true);
  assert.equal(result.public.checks.independentCryptoKeys,true);
  assert.equal(result.public.status,"blocked");
  assert.deepEqual(result.public.blockers,["archive_schema_or_grants_not_verified"]);
  assert.ok(result.privateConfig);
  const serialized = JSON.stringify(result.public);
  assert.doesNotMatch(serialized,/archive-staging|secret|password|whatsapp_archive|BEGIN|postgre/);
});

test("production, shared database, Neon, public hosts and the proof database are all blocked", () => {
  const variants: NodeJS.ProcessEnv[] = [
    {...isolated,APP_DEPLOYMENT_MODE:"production"},
    {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:isolated.APP_STAGING_DATABASE_URL},
    {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:isolated.NEON_DATABASE_URL,
      WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST:"ep-live.neon.tech",
      WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_NAME:"neondb"},
    {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST:"public-database.example.com",
      WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:"postgresql://archiveworker:secret@public-database.example.com/whatsapp_archive",
      WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL:"postgresql://auditwriter:secret@public-database.example.com/whatsapp_archive"},
    {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST:"proof-staging.railway.internal",
      WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_NAME:"whatsapp_proof",
      WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:isolated.WHATSAPP_STAGING_PROOF_DATABASE_URL,
      WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL:"postgresql://auditwriter:secret@proof-staging.railway.internal/whatsapp_proof"},
  ];
  for (const v of variants) {
    const result = ready(v);
    assert.equal(result.privateConfig,null);
    assert.equal(result.public.checks.archiveDbIdentity,false);
  }
});

test("missing audit role, shared encryption keys, owner user and unapproved retention block", () => {
  const variants: NodeJS.ProcessEnv[] = [
    {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL:isolated.WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL},
    {...isolated,WHATSAPP_EMPLOYEE_INBOX_HMAC_KEY_B64:isolated.WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64},
    {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:"postgresql://postgres:password@archive-staging.railway.internal/whatsapp_archive"},
    {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED:"false"},
  ];
  const a=ready(variants[0]);
  assert.ok(a.public.blockers.includes("dedicated_audit_role_missing"));
  const b=ready(variants[1]);
  assert.ok(b.public.blockers.includes("independent_keys_missing"));
  const c=ready(variants[2]);
  assert.equal(c.public.checks.archiveDbIdentity,false);
  const d=ready(variants[3]);
  assert.ok(d.public.blockers.includes("retention_policy_missing"));
});

const identity = {
  database_name:"whatsapp_archive",runtime_role:"runtime_worker",
  is_superuser:false,db_owner:"db_owner",
};
const tables = { identity_principals:true,inbox:true,events:true,numbers:true,consents:true,audit:true };
const grants = {
  schema_use:true,schema_create:false,public_schema_create:false,
  principals_read:true,principals_insert:false,principals_update:false,principals_delete:false,
  inbox_read:true,inbox_insert:true,inbox_update:true,
  inbox_delete:false,inbox_truncate:false,
  events_read:true,events_insert:true,events_update:false,
  events_delete:false,events_truncate:false,
  audit_read:false,audit_insert:false,audit_update:false,audit_delete:false,
};

function fakeDb(id: Record<string,unknown>, t: Record<string,unknown>, g: Record<string,unknown>) {
  const queries: string[]=[];
  const query = async (sql: string) => {
    queries.push(sql);
    if (queries.length===1) return {rows:[id]};
    if (queries.length===2) return {rows:[t]};
    return {rows:[g]};
  };
  return {query,queries};
}

test("separate archive DB role must not be owner and must be unable to mutate archived messages",async () => {
  const ok = fakeDb(identity,tables,grants);
  assert.equal(await verifyEmployeeArchiveDatabaseGrants(ok.query,"whatsapp_archive"),true);
  assert.equal(ok.queries.length,3);
  assert.equal(ok.queries.every(sql => sql.trim().startsWith("SELECT")),true);
  assert.equal(await verifyEmployeeArchiveDatabaseGrants(
    fakeDb({...identity,is_superuser:true},tables,grants).query,"whatsapp_archive"),false);
  assert.equal(await verifyEmployeeArchiveDatabaseGrants(
    fakeDb({...identity,runtime_role:"db_owner"},tables,grants).query,"whatsapp_archive"),false);
  assert.equal(await verifyEmployeeArchiveDatabaseGrants(
    fakeDb(identity,{...tables,inbox:false},grants).query,"whatsapp_archive"),false);
  assert.equal(await verifyEmployeeArchiveDatabaseGrants(
    fakeDb(identity,{...tables,identity_principals:false},grants).query,"whatsapp_archive"),false);
  assert.equal(await verifyEmployeeArchiveDatabaseGrants(
    fakeDb(identity,tables,{...grants,principals_update:true}).query,"whatsapp_archive"),false);
  assert.equal(await verifyEmployeeArchiveDatabaseGrants(
    fakeDb(identity,tables,{...grants,audit_read:true}).query,"whatsapp_archive"),false);
  assert.equal(await verifyEmployeeArchiveDatabaseGrants(
    fakeDb(identity,tables,{...grants,events_delete:true}).query,"whatsapp_archive"),false);
  assert.equal(await verifyEmployeeArchiveDatabaseGrants(
    fakeDb(identity,tables,{...grants,schema_create:true}).query,"whatsapp_archive"),false);
  assert.equal(await verifyEmployeeArchiveDatabaseGrants(
    fakeDb(identity,tables,grants).query,"neondb"),false);
  assert.equal(await verifyEmployeeArchiveDatabaseGrants(
    async () => {throw new Error("secret database connection refused");},"whatsapp_archive"),false);
});


test("audit role must be non-owner, insert-only and protected by immutable trigger",async () => {
  const current = {database_name:"whatsapp_archive",audit_role:"auditwriter",
    is_superuser:false,db_owner:"db_owner"};
  const p = {can_insert:true,can_select:false,can_update:false,
    can_delete:false,can_truncate:false,immutable_trigger:true};
  const reader = (values: Array<Record<string,unknown>>) => {
    let i=0;
    return async (sql: string) => {
      assert.ok(sql.trim().startsWith("SELECT"));
      return {rows:[values[i++]]};
    };
  };
  assert.equal(await verifyEmployeeArchiveAuditRole(reader([current,p]),"whatsapp_archive"),true);
  assert.equal(await verifyEmployeeArchiveAuditRole(reader([current,{...p,can_select:true}]),"whatsapp_archive"),false);
  assert.equal(await verifyEmployeeArchiveAuditRole(reader([current,{...p,can_update:true}]),"whatsapp_archive"),false);
  assert.equal(await verifyEmployeeArchiveAuditRole(reader([current,{...p,immutable_trigger:false}]),"whatsapp_archive"),false);
  assert.equal(await verifyEmployeeArchiveAuditRole(reader([{...current,audit_role:"db_owner"},p]),"whatsapp_archive"),false);
  assert.equal(await verifyEmployeeArchiveAuditRole(reader([current,p]),"kinglike_staging"),false);
  assert.equal(await verifyEmployeeArchiveAuditRole(async () => {throw Error("SQL secrets");},"whatsapp_archive"),false);
});
