import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeArchivePrincipal,
  syncOneVerifiedArchivePrincipal,
  verifyIsolatedIdentitySyncRole,
  IdentityMirrorRefused,
  type IdentityMirrorDb,
} from "./whatsappEmployeeIdentityMirror";

const roleProof={
  db:"kinglike_whatsapp_archive",role:"kinglike_wa_archive_identitysync",
  superuser:false,dbowner:"postgres",
  principal_read:true,principal_insert:true,
  active_update:true,admin_update:true,role_update:true,verified_update:true,
  identity_update:false,principal_delete:false,schema_create:false,
  events_read:false,events_insert:false,audit_read:false,audit_insert:false,inbox_read:false,
};
function fixture(overrides:Record<string,unknown>={},refuseInsert=false){
  const writes:unknown[][]=[];
  const db:IdentityMirrorDb={
    async query(sql,values){
      if(sql.includes("has_table_privilege")) {
        assert.equal(sql.trim().startsWith("SELECT"),true);
        return {rows:[{...roleProof,...overrides}],rowCount:1};
      }
      assert.equal(sql.startsWith("INSERT INTO public.users"),true);
      assert.ok(sql.includes("ON CONFLICT(id) DO UPDATE"));
      assert.ok(sql.includes("verified_at=NOW()"));
      assert.ok(!sql.includes("email")&&!sql.includes("phone")&&!sql.includes("password"));
      writes.push([...(values ?? [])]);
      return {rows:refuseInsert?[]:[{id:values?.[0]}],rowCount:refuseInsert?0:1};
    },
  };
  return {db,writes};
}
test("only a real active sub_agent or admin has eligible archive identity",()=>{
  assert.deepEqual(normalizeArchivePrincipal({
    id:101,isActive:true,isAdmin:false,role:"sub_agent",
  }),{id:101,isActive:true,isAdmin:false,role:"sub_agent"});
  assert.deepEqual(normalizeArchivePrincipal({
    id:301,isActive:true,isAdmin:true,role:"user",
  }),{id:301,isActive:true,isAdmin:true,role:"admin"});
  assert.deepEqual(normalizeArchivePrincipal({
    id:102,isActive:true,isAdmin:false,role:"user",
  }),{id:102,isActive:false,isAdmin:false,role:"inactive"});
  assert.deepEqual(normalizeArchivePrincipal({
    id:101,isActive:false,isAdmin:true,role:"admin",
  }),{id:101,isActive:false,isAdmin:false,role:"inactive"});
  assert.throws(()=>normalizeArchivePrincipal({
    id:2147483648,isActive:true,isAdmin:false,role:"sub_agent",
  }),IdentityMirrorRefused);
});
test("identity sync requires prior approval, role verification and writes only security flags",async()=>{
  const {db,writes}=fixture();
  await assert.rejects(syncOneVerifiedArchivePrincipal(db,
    {id:1,isActive:true,isAdmin:false,role:"sub_agent"},
    {expectedDatabase:"kinglike_whatsapp_archive",approved:false}),IdentityMirrorRefused);
  assert.equal(writes.length,0);
  const state=await syncOneVerifiedArchivePrincipal(db,
    {id:101,isActive:true,isAdmin:false,role:"sub_agent"},
    {expectedDatabase:"kinglike_whatsapp_archive",approved:true});
  assert.equal(state,"eligible");
  assert.deepEqual(writes[0],[101,true,false,"sub_agent"]);
  const disabled=await syncOneVerifiedArchivePrincipal(db,
    {id:101,isActive:false,isAdmin:false,role:"sub_agent"},
    {expectedDatabase:"kinglike_whatsapp_archive",approved:true});
  assert.equal(disabled,"inactive");
  assert.deepEqual(writes[1],[101,false,false,"inactive"]);
  const visitor=await syncOneVerifiedArchivePrincipal(db,
    {id:201,isActive:true,isAdmin:false,role:"user"},
    {expectedDatabase:"kinglike_whatsapp_archive",approved:true});
  assert.equal(visitor,"inactive");
  assert.deepEqual(writes[2],[201,false,false,"inactive"]);
});
test("sync refuses owner, elevated, message-reading, mutation and wrong DB roles",async()=>{
  for(const override of [
    {role:"postgres"},{dbowner:"kinglike_wa_archive_identitysync"},
    {superuser:true},{events_read:true},{events_insert:true},
    {audit_insert:true},{audit_read:true},{identity_update:true},
    {principal_delete:true},{schema_create:true},{inbox_read:true},
    {verified_update:false},{principal_insert:false},{db:"neondb"},
  ]) {
    const {db,writes}=fixture(override);
    assert.equal(await verifyIsolatedIdentitySyncRole(db,"kinglike_whatsapp_archive"),false);
    await assert.rejects(syncOneVerifiedArchivePrincipal(db,
      {id:101,isActive:true,isAdmin:false,role:"sub_agent"},
      {expectedDatabase:"kinglike_whatsapp_archive",approved:true}),IdentityMirrorRefused);
    assert.equal(writes.length,0);
  }
});
test("DB errors and absent insert confirmation fail closed",async()=>{
  const failing:IdentityMirrorDb={async query(){throw new Error("private db denied")}};
  assert.equal(await verifyIsolatedIdentitySyncRole(failing,"kinglike_whatsapp_archive"),false);
  const {db}=fixture({},true);
  await assert.rejects(syncOneVerifiedArchivePrincipal(db,
    {id:101,isActive:true,isAdmin:false,role:"sub_agent"},
    {expectedDatabase:"kinglike_whatsapp_archive",approved:true}),IdentityMirrorRefused);
});
