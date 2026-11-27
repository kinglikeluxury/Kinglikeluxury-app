import assert from "node:assert/strict";
import {after, before, test} from "node:test";
import bcrypt from "bcrypt";
import pg from "pg";
import {assertTemporaryPostgresProcessIdentity} from "../qaLocalPostgresIdentity.ts";
import {
  RAILWAY_QA_PUBLIC_TABLES,
  RAILWAY_QA_RUNTIME_TABLE_PRIVILEGES,
} from "../qaRailwayPreviewRules.ts";

const url=process.env.VIP_QA_RUNTIME_TEST_DATABASE_URL;
const dataDirectory=process.env.VIP_QA_EXPECTED_DATA_DIRECTORY;
const port=Number(process.env.VIP_QA_EXPECTED_PORT);
assert.equal(process.env.NODE_ENV,"test");
assert.equal(typeof url,"string");
assert.equal(typeof dataDirectory,"string");
assertTemporaryPostgresProcessIdentity(dataDirectory,port);
const parsed=new URL(url);
assert.equal(parsed.hostname,"127.0.0.1");
assert.equal(parsed.pathname,"/vipqa_demo");
assert.equal(decodeURIComponent(parsed.username),"vipqa_runtime");

const pool=new pg.Pool({
  connectionString:url,max:1,connectionTimeoutMillis:3000,
  application_name:"kinglike_vip_qa_provision_test",
});
before(async()=>{
  const identity=await pool.query(
    "SELECT current_database() AS database,current_user AS role,"+
    "host(inet_server_addr()) AS address,inet_server_port() AS port",
  );
  assert.deepEqual(identity.rows[0],{
    database:"vipqa_demo",role:"vipqa_runtime",address:"127.0.0.1",port,
  });
});

after(async()=>{await pool.end();});

test("one synthetic-only database marker matches the provisioned environment",async()=>{
  const marker=await pool.query(
    "SELECT environment_id::text AS id,classification FROM vip_qa_environment_identity",
  );
  assert.equal(marker.rowCount,1);
  assert.match(marker.rows[0].id,/^[0-9a-f-]{36}$/);
  assert.equal(marker.rows[0].classification,"synthetic-only");
});

test("four active verified synthetic accounts include admin, buyer, seller and finance",async()=>{
  const result=await pool.query(
    "SELECT id,username,email,role,is_admin,is_active,is_verified,password "+
    "FROM users ORDER BY username",
  );
  assert.equal(result.rowCount,4);
  for(const user of result.rows){
    assert.match(user.username,/^qa_[a-z0-9_]{4,36}$/);
    assert.match(user.email,/^qa_[a-z0-9._+-]{4,70}@[a-z0-9.-]+\.test$/);
    assert.equal(user.is_active,true);
    assert.equal(user.is_verified,true);
    assert.match(user.password,/^\$2[aby]\$/);
  }
  const roles=new Set(result.rows.map((user)=>user.role));
  assert.deepEqual([...roles].sort(),["admin","finance","sub_agent","user"]);
  assert.equal(result.rows.filter((user)=>user.is_admin).length,1);
});

test("all seeded passwords are bcrypt hashes with distinct matching synthetic credentials",async()=>{
  const result=await pool.query("SELECT username,password FROM users");
  const expected=new Map([
    ["qa_preview_admin","Synthetic-Admin-QA-2026!"],
    ["qa_preview_buyer","Synthetic-Buyer-QA-2026!"],
    ["qa_preview_seller","Synthetic-Seller-QA-2026!"],
    ["qa_preview_finance","Synthetic-Finance-QA-2026!"],
  ]);
  for(const user of result.rows){
    const plain=expected.get(user.username);
    assert.ok(plain);
    assert.match(user.password,/^\$2[aby]\$/);
    assert.equal(await bcrypt.compare(plain,user.password),true);
    assert.equal(await bcrypt.compare("wrong-synthetic-password",user.password),false);
  }
});

test("buyer ownership and seller assignment are separate synthetic grants",async()=>{
  const access=await pool.query(
    "SELECT u.role,a.access_role,a.revoked_at IS NULL AS active "+
    "FROM vip_unit_access a JOIN users u ON u.id=a.user_id "+
    "JOIN vip_units n ON n.id=a.unit_id "+
    "WHERE n.unit_number='QA-PORTAL-101' ORDER BY a.access_role",
  );
  assert.deepEqual(access.rows,[
    {role:"user",access_role:"owner",active:true},
    {role:"sub_agent",access_role:"seller",active:true},
  ]);
});

test("finance account has only the delegated receipt approval permission",async()=>{
  const reviewer=await pool.query(
    "SELECT u.role,u.is_admin,u.is_active,u.is_verified,p.can_approve,"+
    "g.role AS granter_role,g.is_admin AS granter_is_admin "+
    "FROM vip_finance_permissions p JOIN users u ON u.id=p.user_id "+
    "JOIN users g ON g.id=p.granted_by",
  );
  assert.equal(reviewer.rowCount,1);
  assert.equal(reviewer.rows[0].role,"finance");
  assert.equal(reviewer.rows[0].is_admin,false);
  assert.equal(reviewer.rows[0].is_active,true);
  assert.equal(reviewer.rows[0].is_verified,true);
  assert.equal(reviewer.rows[0].can_approve,true);
  assert.equal(reviewer.rows[0].granter_is_admin,true);
});

test("synthetic receipt is pending, backed by private bytes, and not a payment",async()=>{
  const receipt=await pool.query(
    "SELECT r.file_name,r.review_status,r.upload_source,u.role AS uploader_role,"+
    "f.object_key,f.content_type,f.size_bytes,octet_length(f.object_bytes) AS actual_size,"+
    "convert_from(substring(f.object_bytes from 1 for 8),'SQL_ASCII') AS pdf_prefix "+
    "FROM vip_receipts r JOIN users u ON u.id=r.uploaded_by "+
    "JOIN vip_qa_file_objects f ON f.object_key=r.object_path",
  );
  assert.equal(receipt.rowCount,1);
  assert.equal(receipt.rows[0].file_name,"synthetic-qa-receipt.pdf");
  assert.equal(receipt.rows[0].review_status,"pending");
  assert.equal(receipt.rows[0].upload_source,"client");
  assert.equal(receipt.rows[0].uploader_role,"user");
  assert.match(receipt.rows[0].object_key,/^kinglike-vip\/receipts\/[0-9a-f-]{36}\.pdf$/);
  assert.equal(receipt.rows[0].content_type,"application/pdf");
  assert.equal(Number(receipt.rows[0].size_bytes),Number(receipt.rows[0].actual_size));
  assert.match(receipt.rows[0].pdf_prefix,/^%PDF-1\.4/);
  const postings=await pool.query("SELECT count(*)::int AS count FROM vip_payment_postings");
  assert.equal(postings.rows[0].count,0);
});

test("runtime role receives only the explicit per-table privileges",async()=>{
  for(const table of RAILWAY_QA_PUBLIC_TABLES){
    const expected=RAILWAY_QA_RUNTIME_TABLE_PRIVILEGES[table]||
      ["SELECT","INSERT","UPDATE"];
    const check=await pool.query(
      "SELECT has_table_privilege(current_user,$1,'SELECT') AS s,"+
      "has_table_privilege(current_user,$1,'INSERT') AS i,"+
      "has_table_privilege(current_user,$1,'UPDATE') AS u,"+
      "has_table_privilege(current_user,$1,'DELETE') AS d,"+
      "has_table_privilege(current_user,$1,'TRUNCATE') AS t,"+
      "has_table_privilege(current_user,$1,'REFERENCES') AS r,"+
      "has_table_privilege(current_user,$1,'TRIGGER') AS g",
      [`public.${table}`],
    );
    const actual=check.rows[0];
    for(const [key,name] of [["s","SELECT"],["i","INSERT"],["u","UPDATE"],["d","DELETE"]]){
      assert.equal(actual[key],expected.includes(name),`${table}:${name}`);
    }
    assert.equal(actual.t,false,`${table}:TRUNCATE`);
    assert.equal(actual.r,false,`${table}:REFERENCES`);
    assert.equal(actual.g,false,`${table}:TRIGGER`);
  }
  const schema=await pool.query(
    "SELECT has_schema_privilege(current_user,'public','CREATE') AS create_public",
  );
  assert.equal(schema.rows[0].create_public,false);
});

test("runtime cannot edit users or append-only accounting records",async()=>{
  await assert.rejects(pool.query("UPDATE users SET role=role"));
  await assert.rejects(pool.query("UPDATE vip_payment_postings SET amount=amount"));
  await assert.rejects(pool.query("DELETE FROM vip_audit_events"));
  await assert.rejects(pool.query("DELETE FROM vip_units"));
  await assert.rejects(pool.query("CREATE TABLE public.qa_forbidden_probe(id integer)"));
});

test("VIP-owned identity sequences are usable but not writable",async()=>{
  const result=await pool.query(
    "SELECT seq.relname AS name,tbl.relname AS owner_table,"+
    "has_sequence_privilege(current_user,seq.oid,'USAGE') AS usage,"+
    "has_sequence_privilege(current_user,seq.oid,'SELECT') AS select,"+
    "has_sequence_privilege(current_user,seq.oid,'UPDATE') AS update "+
    "FROM pg_class seq JOIN pg_namespace sn ON sn.oid=seq.relnamespace "+
    "JOIN pg_depend d ON d.objid=seq.oid AND d.deptype IN ('a','i') "+
    "JOIN pg_class tbl ON tbl.oid=d.refobjid "+
    "JOIN pg_namespace tn ON tn.oid=tbl.relnamespace "+
    "WHERE seq.relkind='S' AND sn.nspname='public' AND tn.nspname='public'",
  );
  assert.ok(result.rowCount>0);
  for(const sequence of result.rows){
    const expected=sequence.owner_table.startsWith("vip_");
    assert.equal(sequence.usage,expected,sequence.name);
    assert.equal(sequence.select,expected,sequence.name);
    assert.equal(sequence.update,false,sequence.name);
  }
});

test("runtime database has no CRM or Kay relations",async()=>{
  const result=await pool.query(
    "SELECT to_regclass('public.crm_leads') AS crm,to_regclass('public.kay_settings') AS kay",
  );
  assert.equal(result.rows[0].crm,null);
  assert.equal(result.rows[0].kay,null);
});

test("public schema contains no unapproved views, triggers, or functions",async()=>{
  const result=await pool.query(
    "SELECT "+
    "NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
    "WHERE n.nspname='public' AND c.relkind NOT IN ('r','p','S','i','I')) "+
    "AND NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid "+
    "JOIN pg_namespace n ON n.oid=c.relnamespace "+
    "WHERE n.nspname='public' AND NOT t.tgisinternal) "+
    "AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "+
    "WHERE n.nspname='public') AS safe",
  );
  assert.equal(result.rows[0].safe,true);
});
