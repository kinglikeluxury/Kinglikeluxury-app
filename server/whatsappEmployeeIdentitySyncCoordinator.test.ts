import test from "node:test";
import assert from "node:assert/strict";
import {
  createAuditedIdentitySync,
  type IdentitySyncTransaction,
} from "./whatsappEmployeeIdentitySyncCoordinator";
import {IdentityMirrorRefused,type IdentityMirrorDb,type KinglikePrincipal} from "./whatsappEmployeeIdentityMirror";

const proof={
  db:"kinglike_whatsapp_archive",role:"kinglike_wa_archive_identitysync",superuser:false,
  dbowner:"postgres",principal_read:true,principal_insert:true,
  active_update:true,admin_update:true,role_update:true,verified_update:true,
  identity_update:false,principal_delete:false,schema_create:false,events_read:false,
  events_insert:false,audit_read:false,audit_insert:false,inbox_read:false,
  identity_audit_insert:true,identity_audit_read:false,identity_audit_update:false,
  identity_audit_delete:false,identity_audit_immutable:true,
};

function fixture(){
  let current:KinglikePrincipal|null={id:101,isActive:true,isAdmin:false,role:"sub_agent"};
  let admin=true,consent=true,auditDown=false;
  let consentChecks=0,revokeOnSecondCheck=false;
  let row:null|{id:number;active:boolean;role:string}=null;
  let audits:Array<{actor:number;subject:number;action:string}>=[];
  let commits=0,rollbacks=0;
  const q:IdentityMirrorDb={
    async query(sql,params=[]){
      if(sql.includes("has_table_privilege"))return {rows:[proof],rowCount:1};
      if(sql==="SELECT id FROM public.users WHERE id=$1")
        return {rows:row?.id===params[0]?[{id:row.id}]:[],rowCount:row?.id===params[0]?1:0};
      if(sql.startsWith("INSERT INTO public.users(")){
        row={id:Number(params[0]),active:Boolean(params[1]),role:String(params[3])};
        return {rows:[{id:params[0]}],rowCount:1};
      }
      if(sql.startsWith("UPDATE public.users SET")){
        if(row?.id===params[0])row={...row,active:false,role:"inactive"};
        return {rows:[],rowCount:row?.id===params[0]?1:0};
      }
      if(sql.startsWith("INSERT INTO public.whatsapp_employee_identity_sync_audit")){
        if(auditDown)throw Error("audit insert failed");
        audits.push({actor:Number(params[0]),subject:Number(params[1]),action:String(params[2])});
        return {rows:[{id:audits.length}],rowCount:1};
      }
      throw Error("Unexpected SQL: "+sql.slice(0,70));
    },
  };
  const tx:IdentitySyncTransaction={
    async transact<T>(callback:(db:IdentityMirrorDb)=>Promise<T>):Promise<T>{
      const snapshot=row?{...row}:null;
      const previous=audits.length;
      try {
        const result=await callback(q);
        commits++;
        return result;
      }catch(error){
        row=snapshot;audits=audits.slice(0,previous);rollbacks++;
        throw error;
      }
    },
  };
  const worker=createAuditedIdentitySync(tx,{
    currentAdmin:async()=>admin,
    currentPerson:async()=>current,
    hasEmployeeConsent:async()=>{
      consentChecks++;
      return consent && !(revokeOnSecondCheck && consentChecks===2);
    },
  });
  return {
    worker,get row(){return row;},get audits(){return audits;},
    get commits(){return commits;},get rollbacks(){return rollbacks;},
    setCurrent(x:KinglikePrincipal|null){current=x;},
    setAdmin(x:boolean){admin=x;},setConsent(x:boolean){consent=x;},
    setAuditDown(x:boolean){auditDown=x;},
    revokeBetweenChecks(){consentChecks=0;revokeOnSecondCheck=true;},
  };
}
test("employee activation and subsequent revocation are atomically audited with numeric IDs only",async()=>{
  const x=fixture();
  assert.equal(await x.worker.refreshOne(301,101,true),"eligible");
  assert.deepEqual(x.row,{id:101,active:true,role:"sub_agent"});
  assert.deepEqual(x.audits,[{actor:301,subject:101,action:"activate"}]);
  x.setCurrent({id:101,isActive:false,isAdmin:false,role:"sub_agent"});
  assert.equal(await x.worker.refreshOne(301,101,true),"inactive");
  assert.deepEqual(x.row,{id:101,active:false,role:"inactive"});
  assert.equal(x.audits[1].action,"deactivate");
  assert.equal(x.commits,2);
  assert.equal(x.rollbacks,0);
});
test("ordinary app visitor is never mirrored or logged in archive",async()=>{
  const x=fixture();
  x.setCurrent({id:101,isActive:true,isAdmin:false,role:"user"});
  assert.equal(await x.worker.refreshOne(301,101,true),"not_mirrored");
  assert.equal(x.row,null);
  assert.deepEqual(x.audits,[]);
});
test("withdrawn consent deactivates existing employee mirror while leaving app account active",async()=>{
  const x=fixture();
  assert.equal(await x.worker.refreshOne(301,101,true),"eligible");
  x.setConsent(false);
  assert.equal(await x.worker.refreshOne(301,101,true),"inactive");
  assert.deepEqual(x.row,{id:101,active:false,role:"inactive"});
  assert.deepEqual(x.audits.map(a=>a.action),["activate","deactivate"]);
});
test("withdrawn consent on an unmirrored person creates no archive identity or log",async()=>{
  const x=fixture();
  x.setConsent(false);
  assert.equal(await x.worker.refreshOne(301,101,true),"not_mirrored");
  assert.equal(x.row,null);
  assert.deepEqual(x.audits,[]);
});
test("admin and policy restrictions still reject any identity mutation",async()=>{
  const x=fixture();
  x.setAdmin(false);
  await assert.rejects(x.worker.refreshOne(301,101,true),IdentityMirrorRefused);
  x.setAdmin(true);
  await assert.rejects(x.worker.refreshOne(301,101,false),IdentityMirrorRefused);
  await assert.rejects(x.worker.refreshOne(301,-1,true),IdentityMirrorRefused);
  assert.equal(x.row,null);
  assert.deepEqual(x.audits,[]);
});
test("consent withdrawal between verification passes rolls back the activation",async()=>{
  const x=fixture();
  x.revokeBetweenChecks();
  await assert.rejects(x.worker.refreshOne(301,101,true),IdentityMirrorRefused);
  assert.equal(x.row,null);
  assert.deepEqual(x.audits,[]);
  assert.equal(x.rollbacks,1);
});
test("failed immutable audit INSERT rolls back identity activation",async()=>{
  const x=fixture();
  x.setAuditDown(true);
  await assert.rejects(x.worker.refreshOne(301,101,true));
  assert.equal(x.row,null);
  assert.deepEqual(x.audits,[]);
  assert.equal(x.rollbacks,1);
});
test("an identity that disappears from current app source revokes existing mirror",async()=>{
  const x=fixture();
  assert.equal(await x.worker.refreshOne(301,101,true),"eligible");
  x.setCurrent(null);
  assert.equal(await x.worker.refreshOne(301,101,true),"inactive");
  assert.equal(x.row?.active,false);
});
test("an app source mismatch never writes to archive",async()=>{
  const x=fixture();
  x.setCurrent({id:102,isActive:true,isAdmin:false,role:"sub_agent"});
  await assert.rejects(x.worker.refreshOne(301,101,true),IdentityMirrorRefused);
  assert.equal(x.row,null);
});
