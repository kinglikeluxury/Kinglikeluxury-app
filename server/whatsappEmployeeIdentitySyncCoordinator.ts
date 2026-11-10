/**
 * Audited, one-principal-at-a-time, isolated WhatsApp identity reconciliation.
 *
 * No endpoint, scheduler, DB connection, employee enrollment or Meta calls
 * are created on import. The future caller MUST provide a dedicated
 * kinglike_wa_archive_identitysync pool, source-of-truth app lookups and a
 * documented employee-consent authority. Never pass a main/Neon DB pool.
 *
 * Identity update and immutable ledger INSERT MUST COMMIT IN ONE TRANSACTION.
 */
import type { Pool } from "pg";
import {
  normalizeArchivePrincipal,
  syncOneVerifiedArchivePrincipal,
  verifyIsolatedIdentitySyncRole,
  IdentityMirrorRefused,
  type IdentityMirrorDb,
  type KinglikePrincipal,
} from "./whatsappEmployeeIdentityMirror";

type ScopedClient = IdentityMirrorDb & { release():void };
export interface IdentitySyncTransaction {
  transact<T>(fn:(db:IdentityMirrorDb)=>Promise<T>):Promise<T>;
}

export function createIsolatedIdentitySyncTransaction(pool:Pick<Pool,"connect">):IdentitySyncTransaction {
  return {
    async transact<T>(fn:(db:IdentityMirrorDb)=>Promise<T>):Promise<T> {
      const client=await pool.connect() as ScopedClient;
      let active=false;
      try {
        await client.query("BEGIN");
        active=true;
        await client.query("SET LOCAL statement_timeout='15000ms'");
        const result=await fn(client);
        await client.query("COMMIT");
        active=false;
        return result;
      } catch {
        if(active) await client.query("ROLLBACK").catch(()=>{});
        throw new IdentityMirrorRefused();
      } finally {
        client.release();
      }
    },
  };
}

export type IdentitySyncAuthority = Readonly<{
  // Must read authenticated actor from current Kinglike login authority.
  currentAdmin:(actorId:number)=>Promise<boolean>;
  // Must fetch this person from current Kinglike app DB, never archive mirror.
  currentPerson:(employeeId:number)=>Promise<KinglikePrincipal|null>;
  // Explicit individual employee consent, verified from lawful company source.
  hasEmployeeConsent:(employeeId:number)=>Promise<boolean>;
}>;

export function createAuditedIdentitySync(
  tx:IdentitySyncTransaction,
  source:IdentitySyncAuthority,
) {
  async function refreshOne(
    actorId:number, employeeId:number, policyApproved:boolean,
  ):Promise<"eligible"|"inactive"|"not_mirrored"> {
    if(!Number.isSafeInteger(actorId)||actorId<=0||
      !Number.isSafeInteger(employeeId)||employeeId<=0||
      employeeId>2147483647||!policyApproved)throw new IdentityMirrorRefused();
    if(!(await source.currentAdmin(actorId)))throw new IdentityMirrorRefused();
    const latest=await source.currentPerson(employeeId);
    if(latest!==null && latest.id!==employeeId)throw new IdentityMirrorRefused();
    const principal=normalizeArchivePrincipal(latest??{
      id:employeeId,isActive:false,isAdmin:false,role:"inactive",
    });
    if(principal.isActive && !principal.isAdmin &&
      !(await source.hasEmployeeConsent(employeeId))) {
      throw new IdentityMirrorRefused();
    }
    return await tx.transact(async db=>{
      if(!(await verifyIsolatedIdentitySyncRole(db,"kinglike_whatsapp_archive"))) {
        throw new IdentityMirrorRefused();
      }
      if(!principal.isActive) {
        // Do not even audit unknown regular app customers in the employee DB.
        const existing=await db.query("SELECT id FROM public.users WHERE id=$1",[employeeId]);
        if(existing.rows.length!==1)return "not_mirrored";
      }
      // Recheck active status/consent immediately before database mutation.
      if(!(await source.currentAdmin(actorId)))throw new IdentityMirrorRefused();
      const currentAgain=await source.currentPerson(employeeId);
      if(currentAgain!==null && currentAgain.id!==employeeId)throw new IdentityMirrorRefused();
      const now=normalizeArchivePrincipal(currentAgain??{
        id:employeeId,isActive:false,isAdmin:false,role:"inactive",
      });
      if(now.isActive && !now.isAdmin &&
        !(await source.hasEmployeeConsent(employeeId)))throw new IdentityMirrorRefused();
      if(now.isActive!==principal.isActive || now.isAdmin!==principal.isAdmin ||
        now.role!==principal.role)throw new IdentityMirrorRefused();
      const result=await syncOneVerifiedArchivePrincipal(db,currentAgain??{
        id:employeeId,isActive:false,isAdmin:false,role:"inactive",
      },{approved:true,expectedDatabase:"kinglike_whatsapp_archive"});
      const record=await db.query(
        "INSERT INTO public.whatsapp_employee_identity_sync_audit"+
        " (actor_id,employee_id,action) VALUES ($1,$2,$3)",
        [actorId,employeeId,result==="eligible"?"activate":"deactivate"],
      );
      if(record.rowCount!==1)throw new IdentityMirrorRefused();
      return result;
    });
  }
  return Object.freeze({refreshOne});
}
