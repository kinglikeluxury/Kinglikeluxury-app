/**
 * Minimal identity mirror writer for the isolated WhatsApp archive DB.
 *
 * This module has NO DB connection, background job, public HTTP route or
 * employee enrollment side effect. It is only usable with explicitly supplied
 * app-source identity and a dedicated identitysync role, after notices and
 * retention policy are approved.
 *
 * Source-of-truth is ALWAYS the existing Kinglike login database, not the
 * mirrored rows. Only integer ID and security/role flags are retained.
 */
export type KinglikePrincipal = Readonly<{
  id: number;
  isActive: boolean;
  isAdmin: boolean;
  role: string;
}>;

export interface IdentityMirrorDb {
  query(sql: string, values?: unknown[]): Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount?: number|null;
  }>;
}

export class IdentityMirrorRefused extends Error {
  constructor() {
    super("Isolated identity sync is unavailable");
    this.name="IdentityMirrorRefused";
  }
}

const validId = (v: number) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;

/** Reject role-owner, schema-create or message-grant escalation. */
export async function verifyIsolatedIdentitySyncRole(
  db: IdentityMirrorDb,
  expectedDatabase: string,
): Promise<boolean> {
  if(expectedDatabase!=="kinglike_whatsapp_archive") return false;
  try {
    const x=await db.query([
      "SELECT current_database() AS db,current_user AS role,",
      "(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,",
      "(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS dbowner,",
      "has_table_privilege(current_user,'public.users','SELECT') AS principal_read,",
      "has_table_privilege(current_user,'public.users','INSERT') AS principal_insert,",
      "has_column_privilege(current_user,'public.users','is_active','UPDATE') AS active_update,",
      "has_column_privilege(current_user,'public.users','is_admin','UPDATE') AS admin_update,",
      "has_column_privilege(current_user,'public.users','role','UPDATE') AS role_update,",
      "has_column_privilege(current_user,'public.users','verified_at','UPDATE') AS verified_update,",
      "has_column_privilege(current_user,'public.users','id','UPDATE') AS identity_update,",
      "has_table_privilege(current_user,'public.users','DELETE') AS principal_delete,",
      "has_schema_privilege(current_user,'public','CREATE') AS schema_create,",
      "has_table_privilege(current_user,'whatsapp_employee_events','SELECT') AS events_read,",
      "has_table_privilege(current_user,'whatsapp_employee_events','INSERT') AS events_insert,",
      "has_table_privilege(current_user,'whatsapp_employee_access_audit','SELECT') AS audit_read,",
      "has_table_privilege(current_user,'whatsapp_employee_access_audit','INSERT') AS audit_insert,",
      "has_table_privilege(current_user,'kinglike_whatsapp.whatsapp_employee_inbox','SELECT') AS inbox_read,",
      "has_table_privilege(current_user,'whatsapp_employee_identity_sync_audit','INSERT') AS identity_audit_insert,",
      "has_table_privilege(current_user,'whatsapp_employee_identity_sync_audit','SELECT') AS identity_audit_read,",
      "has_table_privilege(current_user,'whatsapp_employee_identity_sync_audit','UPDATE') AS identity_audit_update,",
      "has_table_privilege(current_user,'whatsapp_employee_identity_sync_audit','DELETE') AS identity_audit_delete,",
      "EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='whatsapp_employee_identity_sync_audit'::regclass",
      " AND tgname='whatsapp_employee_identity_sync_audit_immutable' AND tgenabled='O') AS identity_audit_immutable",
    ].join(" "));
    const v=x.rows[0]??{};
    return v.db===expectedDatabase &&
      v.role==="kinglike_wa_archive_identitysync" &&
      v.role!==v.dbowner && v.superuser===false &&
      ["principal_read","principal_insert","active_update","admin_update",
        "role_update","verified_update","identity_audit_insert","identity_audit_immutable"]
        .every(k=>v[k]===true) &&
      ["identity_update","principal_delete","schema_create","events_read",
        "events_insert","audit_read","audit_insert","inbox_read",
        "identity_audit_read","identity_audit_update","identity_audit_delete"]
        .every(k=>v[k]===false);
  } catch { return false; }
}

export function normalizeArchivePrincipal(source: KinglikePrincipal): Readonly<{
  id: number; isActive: boolean; isAdmin: boolean; role: "inactive"|"sub_agent"|"admin";
}> {
  if(!source || !validId(source.id) ||
    typeof source.isActive!=="boolean" || typeof source.isAdmin!=="boolean" ||
    typeof source.role!=="string" || source.role.length>80) {
    throw new IdentityMirrorRefused();
  }
  // Ordinary clients and app users are NEVER promoted to company employees.
  // isAdmin on an active real app account takes precedence over the text role.
  if(!source.isActive) {
    return {id:source.id,isActive:false,isAdmin:false,role:"inactive"};
  }
  if(source.isAdmin) {
    return {id:source.id,isActive:true,isAdmin:true,role:"admin"};
  }
  if(source.role==="sub_agent") {
    return {id:source.id,isActive:true,isAdmin:false,role:"sub_agent"};
  }
  return {id:source.id,isActive:false,isAdmin:false,role:"inactive"};
}

/**
 * Fail-closed one-principal upsert. Call ONLY after re-reading the person
 * from the app's current account authority. Never batch full user records.
 * A revoked/disabled user is persisted as inactive, not deleted, to avoid
 * breaking FK/audit references. No PII or credentials are copied.
 */
export async function syncOneVerifiedArchivePrincipal(
  db: IdentityMirrorDb,
  source: KinglikePrincipal,
  options: { expectedDatabase: string; approved: boolean },
): Promise<"eligible"|"inactive"> {
  if(!options?.approved ||
    options.expectedDatabase!=="kinglike_whatsapp_archive")throw new IdentityMirrorRefused();
  const principal=normalizeArchivePrincipal(source);
  if(!(await verifyIsolatedIdentitySyncRole(db,options.expectedDatabase))) {
    throw new IdentityMirrorRefused();
  }
  if(!principal.isActive) {
    // Ordinary clients MUST NOT be copied to the employee archive. Only
    // invalidate a previously mirrored ID if one already exists.
    await db.query(
      "UPDATE public.users SET is_active=false,is_admin=false,"+
      " role='inactive',verified_at=NOW() WHERE id=$1",
      [principal.id],
    );
    return "inactive";
  }
  const result=await db.query([
    "INSERT INTO public.users(id,is_active,is_admin,role,verified_at)",
    "VALUES($1,$2,$3,$4,NOW())",
    "ON CONFLICT(id) DO UPDATE SET",
    "is_active=EXCLUDED.is_active,is_admin=EXCLUDED.is_admin,",
    "role=EXCLUDED.role,verified_at=NOW()",
    "RETURNING id",
  ].join(" "),[principal.id,principal.isActive,principal.isAdmin,principal.role]);
  if(result.rowCount!==1 && result.rows.length!==1)throw new IdentityMirrorRefused();
  return "eligible";
}
