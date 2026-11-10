/**
 * READ-ONLY company WhatsApp archive operations.
 * No network/DB connections at import time and no live Meta operations.
 * Authorizer MUST verify actor in current Kinglike login source first.
 * Archive mirror (verified_at), explicit grant and per-number consent are
 * independently checked for every access. Even admins require grants.
 */
import {
  recordWhatsappEmployeeArchiveAccess,
  type ArchiveAccessReason,
  type ArchiveAccessAction,
  type ArchiveAccessOutcome,
  type AuditQueryable,
} from "./whatsappEmployeeAccessAudit";

export interface ArchiveQueryable {
  query(sql: string, values?: unknown[]): Promise<{
    rows: Array<Record<string, any>>;
    rowCount?: number | null;
  }>;
}
export type LiveArchiveActor = Readonly<{ id: number; isAdmin: boolean }>;
export type ArchiveReaderDependencies = Readonly<{
  archive: ArchiveQueryable;
  audit: AuditQueryable;
}>;
export class LiveArchiveDenied extends Error {
  constructor() { super("Archive access is not permitted"); this.name="LiveArchiveDenied"; }
}
export class LiveArchiveAuditUnavailable extends Error {
  constructor() { super("Archive audit unavailable"); this.name="LiveArchiveAuditUnavailable"; }
}
const validId=(n: number) => Number.isSafeInteger(n) && n > 0;
const COMPANY=[
  "n.registration_kind='company'",
  "n.is_active=true",
  "n.business_authorized_at IS NOT NULL",
  "n.coexistence_enabled=true",
  "n.coexistence_verified_at IS NOT NULL",
  "consent.status='consented'",
  "consent.consented_at IS NOT NULL",
  "consent.revoked_at IS NULL",
  "subject.is_active=true",
  "subject.verified_at > NOW() - interval '5 minutes'",
].join(" AND ");
const GRANT=[
  "EXISTS (SELECT 1 FROM whatsapp_employee_supervisor_grants g",
  "WHERE g.supervisor_id=$1 AND g.employee_id=n.employee_id",
  "AND g.can_read=true AND g.revoked_at IS NULL)",
].join(" ");
const NUMBER_SCOPE=[
  "FROM whatsapp_employee_numbers n",
  "JOIN whatsapp_employee_consents consent ON",
  "consent.phone_number_id=n.phone_number_id AND consent.employee_id=n.employee_id",
  "JOIN public.users subject ON subject.id=n.employee_id",
  "WHERE "+COMPANY,
  "AND (n.employee_id=$1 OR "+GRANT+")",
].join(" ");
const CONVERSATION_JOINS=[
  "FROM whatsapp_employee_conversations c",
  "JOIN whatsapp_employee_numbers n ON",
  "n.employee_id=c.employee_id AND n.phone_number_id=c.phone_number_id AND n.waba_id=c.waba_id",
  "JOIN whatsapp_employee_consents consent ON",
  "consent.phone_number_id=n.phone_number_id AND consent.employee_id=n.employee_id",
  "JOIN public.users subject ON subject.id=n.employee_id",
].join(" ");

export function createEmployeeArchiveReadService(deps: ArchiveReaderDependencies) {
  async function audit(actor: LiveArchiveActor, employeeId: number,
    action: ArchiveAccessAction, outcome: ArchiveAccessOutcome,
    reason: ArchiveAccessReason, count?: number) {
    try {
      await recordWhatsappEmployeeArchiveAccess(deps.audit,{
        actorId:actor.id,employeeId,action,outcome,reason,resultCount:count,
      });
    } catch { throw new LiveArchiveAuditUnavailable(); }
  }
  function accessReason(actor: LiveArchiveActor, employeeId: number): ArchiveAccessReason {
    return actor.id===employeeId?"employee_own_scope":
      actor.isAdmin?"admin_explicit_grant":"supervisor_grant";
  }
  async function actorIsCurrent(actor: LiveArchiveActor): Promise<boolean> {
    if (!validId(actor?.id) || typeof actor.isAdmin!=="boolean")return false;
    const result=await deps.archive.query(
      "SELECT 1 FROM public.users WHERE id=$1 AND is_active=true AND is_admin=$2"+
      " AND verified_at > NOW() - interval '5 minutes' LIMIT 1",
      [actor.id,actor.isAdmin],
    );
    return result.rows.length===1;
  }
  async function scopes(actor: LiveArchiveActor): Promise<{employeeIds:number[]}> {
    if (!validId(actor?.id))throw new LiveArchiveDenied();
    if (!(await actorIsCurrent(actor))) {
      await audit(actor,actor.id,"archive.search","denied","policy_blocked",0);
      throw new LiveArchiveDenied();
    }
    const rows=await deps.archive.query(
      "SELECT DISTINCT n.employee_id "+NUMBER_SCOPE+
      " ORDER BY n.employee_id ASC LIMIT 100",[actor.id],
    );
    const ids=rows.rows.map(x=>Number(x.employee_id)).filter(validId);
    if(!ids.length){
      await audit(actor,actor.id,"archive.search","denied","scope_denied",0);
      return {employeeIds:[]};
    }
    for(const id of ids)await audit(actor,id,"archive.search","allowed",
      accessReason(actor,id),ids.length);
    return {employeeIds:ids};
  }
  async function authorizedEmployee(actor: LiveArchiveActor, employeeId: number,
    action: ArchiveAccessAction): Promise<void> {
    if(!validId(actor?.id)||!validId(employeeId))throw new LiveArchiveDenied();
    if (!(await actorIsCurrent(actor))) {
      await audit(actor,employeeId,action,"denied","policy_blocked",0);
      throw new LiveArchiveDenied();
    }
    const scoped=await deps.archive.query(
      "SELECT 1 "+NUMBER_SCOPE+" AND n.employee_id=$2 LIMIT 1",
      [actor.id,employeeId],
    );
    if(!scoped.rows.length){
      await audit(actor,employeeId,action,"denied","scope_denied",0);
      throw new LiveArchiveDenied();
    }
  }
  async function conversations(actor: LiveArchiveActor, employeeId: number) {
    await authorizedEmployee(actor,employeeId,"archive.search");
    const result=await deps.archive.query([
      "SELECT c.id,c.contact_wa_id,c.phone_number_id,c.updated_at,",
      "(SELECT e.message_text FROM whatsapp_employee_events e",
      "WHERE e.conversation_id=c.id AND e.event_kind='message'",
      "ORDER BY e.received_at DESC,e.id DESC LIMIT 1) AS last_message_preview",
      CONVERSATION_JOINS,
      "WHERE c.employee_id=$2 AND "+COMPANY,
      "AND (n.employee_id=$1 OR "+GRANT+")",
      "ORDER BY c.updated_at DESC,c.id DESC LIMIT 100",
    ].join(" "),[actor.id,employeeId]);
    await audit(actor,employeeId,"archive.search","allowed",accessReason(actor,employeeId),
      result.rows.length);
    return {conversations:result.rows};
  }
  async function messages(actor: LiveArchiveActor, conversationId: number) {
    if(!validId(actor?.id)||!validId(conversationId))throw new LiveArchiveDenied();
    if (!(await actorIsCurrent(actor))){
      await audit(actor,actor.id,"archive.read","denied","policy_blocked",0);
      throw new LiveArchiveDenied();
    }
    const scoped=await deps.archive.query([
      "SELECT c.employee_id",CONVERSATION_JOINS,
      "WHERE c.id=$2 AND "+COMPANY,
      "AND (n.employee_id=$1 OR "+GRANT+") LIMIT 1",
    ].join(" "),[actor.id,conversationId]);
    const employeeId=Number(scoped.rows[0]?.employee_id);
    if(!validId(employeeId)){
      // Never reveal the owner of a guessed conversation ID.
      await audit(actor,actor.id,"archive.read","denied","scope_denied",0);
      throw new LiveArchiveDenied();
    }
    const result=await deps.archive.query([
      "SELECT e.id,e.event_kind,e.direction,e.event_status,e.message_type,",
      "e.message_text,e.related_message_id,e.occurred_at,e.received_at,",
      "e.media_mime_type,e.media_size_bytes,e.media_sha256,",
      "CASE WHEN e.event_kind='message' AND EXISTS (",
      "SELECT 1 FROM whatsapp_employee_events r WHERE r.conversation_id=e.conversation_id",
      "AND r.event_kind='revoke' AND r.direction=e.direction",
      "AND r.related_message_id=e.meta_message_id)",
      "THEN 'meta_revoke_reported' ELSE 'not_reported' END AS deletion_status,",
      "CASE WHEN e.event_kind='message' THEN (SELECT MIN(r.received_at)",
      "FROM whatsapp_employee_events r WHERE r.conversation_id=e.conversation_id",
      "AND r.event_kind='revoke' AND r.direction=e.direction",
      "AND r.related_message_id=e.meta_message_id) ELSE NULL END AS deletion_observed_at",
      "FROM whatsapp_employee_events e",
      "WHERE e.conversation_id=$1 AND e.employee_id=$2",
      "ORDER BY e.received_at ASC,e.id ASC LIMIT 500",
    ].join(" "),[conversationId,employeeId]);
    await audit(actor,employeeId,"archive.read","allowed",
      accessReason(actor,employeeId),result.rows.length);
    return {messages:result.rows};
  }
  return Object.freeze({scopes,conversations,messages});
}
