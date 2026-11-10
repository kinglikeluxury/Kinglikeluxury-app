import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmployeeArchiveReadService,LiveArchiveDenied,LiveArchiveAuditUnavailable,
  type ArchiveQueryable,
} from "./whatsappEmployeeArchiveReadService";
import type {AuditQueryable} from "./whatsappEmployeeAccessAudit";

type Flags = { mirror?: boolean; consent?: boolean; grant?: boolean; auditDown?: boolean; currentSubject?:boolean };
function fixture(flags: Flags={}) {
  const all={mirror:true,consent:true,grant:true,auditDown:false,currentSubject:true,...flags};
  const queries:string[]=[];
  const logged:Array<{actorId:number;employeeId:number;action:string;outcome:string;reason:string}>=[];
  const sample=[
    {id:33,conversation_id:7,event_kind:"message",direction:"outbound",message_text:"Synthetic original retained",
     deletion_status:"meta_revoke_reported",deletion_observed_at:"2026-11-10T11:00:00.000Z"},
    {id:34,conversation_id:7,event_kind:"revoke",direction:"outbound",message_text:null},
  ];
  const archive: ArchiveQueryable={
    async query(sql,params) {
      queries.push(sql);
      if(sql.includes("SELECT 1 FROM public.users"))return {rows:all.mirror?[{ok:1}]:[]};
      if(sql.includes("SELECT DISTINCT n.employee_id"))
        return {rows:all.consent&&all.grant?[{employee_id:101}]:[]};
      if(sql.includes("SELECT 1 FROM whatsapp_employee_numbers"))
        return {rows:all.consent&&all.grant?[{one:1}]:[]};
      if(sql.includes("SELECT c.employee_id"))
        return {rows:all.consent&&all.grant?[{employee_id:101}]:[]};
      if(sql.includes("SELECT c.id,c.contact_wa_id"))
        return {rows:all.consent&&all.grant?[{id:7,contact_wa_id:"synthetic-customer",updated_at:"2026-11-10"}]:[]};
      if(sql.includes("SELECT e.id,e.event_kind"))return {rows:sample};
      throw Error("unexpected SELECT query:"+sql.slice(0,35));
    },
  };
  const audit:AuditQueryable={
    async query(sql,params) {
      if(all.auditDown)throw Error("synthetic audit connection unavailable");
      if(sql.includes("has_table_privilege"))return {rows:[{
        can_insert:true,can_select:false,can_update:false,can_delete:false,
        can_truncate:false,owns_table:false,member_of_owner:false,trigger_enabled:true,
      }]};
      if(sql.includes("INSERT INTO whatsapp_employee_access_audit")) {
        assert.ok(params);
        logged.push({actorId:Number(params![0]),employeeId:Number(params![1]),
          action:String(params![2]),outcome:String(params![3]),reason:String(params![4])});
        return {rows:[],rowCount:1};
      }
      throw Error("Unexpected write outside audit ledger");
    },
  };
  return {service:createEmployeeArchiveReadService({
    archive,audit,verifyCurrentSubject:async()=>all.currentSubject,
  }),queries,logged};
}

test("own consented Coexistence scope displays archived original beside verified revoke",async()=>{
  const {service,queries,logged}=fixture();
  const actor={id:101,isAdmin:false};
  assert.deepEqual(await service.scopes(actor),{employeeIds:[101]});
  const conv=await service.conversations(actor,101);
  assert.equal(conv.conversations.length,1);
  const data=await service.messages(actor,7);
  assert.equal(data.messages[0].message_text,"Synthetic original retained");
  assert.equal(data.messages[0].deletion_status,"meta_revoke_reported");
  assert.equal(data.messages[1].event_kind,"revoke");
  assert.ok(logged.some(x=>x.action==="archive.read"&&x.outcome==="allowed"&&x.employeeId===101));
  const combined=queries.join(" ");
  for(const essential of [
    "coexistence_verified_at IS NOT NULL","consent.revoked_at IS NULL",
    "subject.verified_at > NOW()","g.can_read=true","r.related_message_id=e.meta_message_id",
  ])assert.ok(combined.includes(essential),essential);
});

test("an ungranted admin or supervisor cannot read employees; rejection is audited",async()=>{
  const {service,logged}=fixture({grant:false});
  await assert.rejects(service.conversations({id:301,isAdmin:true},101),LiveArchiveDenied);
  await assert.rejects(service.messages({id:301,isAdmin:true},7),LiveArchiveDenied);
  assert.equal(logged.every(x=>x.outcome==="denied"),true);
  assert.equal(logged[0].reason,"scope_denied");
  // No chat contents or cross-employee number are emitted in denial.
});

test("revoked employee consent and stale identity mirror fail closed",async()=>{
  const denied=fixture({consent:false});
  await assert.rejects(denied.service.messages({id:101,isAdmin:false},7),LiveArchiveDenied);
  const mirror=fixture({mirror:false});
  await assert.rejects(mirror.service.scopes({id:101,isAdmin:false}),LiveArchiveDenied);
  assert.equal(mirror.logged[0].reason,"policy_blocked");
});

test("audit outage denies response even if message SELECT completed",async()=>{
  const {service}=fixture({auditDown:true});
  await assert.rejects(service.scopes({id:101,isAdmin:false}),LiveArchiveAuditUnavailable);
  await assert.rejects(service.messages({id:101,isAdmin:false},7),LiveArchiveAuditUnavailable);
});

test("invalid actor and conversation identifiers fail closed",async()=>{
  const {service}=fixture();
  await assert.rejects(service.scopes({id:0,isAdmin:false}),LiveArchiveDenied);
  await assert.rejects(service.messages({id:101,isAdmin:false},-1),LiveArchiveDenied);
});


test("app source-of-truth deactivation overrides stale archive consent/grants",async()=>{
  const {service,logged}=fixture({currentSubject:false});
  await assert.rejects(service.conversations({id:301,isAdmin:true},101),LiveArchiveDenied);
  await assert.rejects(service.messages({id:301,isAdmin:true},7),LiveArchiveDenied);
  assert.deepEqual(await service.scopes({id:301,isAdmin:true}),{employeeIds:[]});
  assert.ok(logged.some(x=>x.reason==="policy_blocked"&&x.outcome==="denied"));
});
