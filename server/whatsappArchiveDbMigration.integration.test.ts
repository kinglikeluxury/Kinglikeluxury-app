import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { assertWhatsappEmployeeAuditWriter } from "./whatsappEmployeeAccessAudit";

const url=process.env.WHATSAPP_EMPLOYEE_TEST_DATABASE_URL;

/**
 * This destructive test is limited to a disposable CI PostgreSQL container.
 * No Neon, Railway, app or non-test DB is accepted even if configured.
 */
test("isolated archive migration creates four NOLOGIN scoped roles, secure inbox and immutable audit",{
  skip:!url || process.env.CI !== "true",
},async()=>{
  assert.ok(url);
  const u=new URL(url);
  assert.ok(["localhost","127.0.0.1","::1","[::1]"].includes(u.hostname));
  assert.equal(u.pathname,"/kinglike_whatsapp_test");
  assert.equal(process.env.CI,"true");
  const pool=new pg.Pool({connectionString:url,max:2});
  const files=[
    "../docs/sql/2026-11-09-whatsapp-archive-00-isolated-principals.sql.txt",
    "../docs/sql/2026-11-07-whatsapp-employee-unified.sql.txt",
    "../docs/sql/2026-11-09-whatsapp-employee-durable-inbox.sql.txt",
    "../docs/sql/2026-11-09-whatsapp-archive-03-roles.sql.txt",
    "../docs/sql/2026-11-10-whatsapp-archive-04-identity-audit.sql.txt",
  ];
  try{
    for(const filename of files){
      const sql=await readFile(new URL(filename,import.meta.url),"utf8");
      await pool.query(sql);
    }

    const {rows:principalRows}=await pool.query("SELECT COUNT(*)::int AS count FROM public.users");
    assert.equal(principalRows[0].count,0,"No employee identities may be pre-seeded");

    const roles=[
      "kinglike_wa_archive_worker",
      "kinglike_wa_archive_reader",
      "kinglike_wa_archive_auditwriter",
      "kinglike_wa_archive_identitysync",
    ];
    const roleResult=await pool.query(
      "SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=ANY($1::text[])",
      [roles],
    );
    assert.equal(roleResult.rowCount,4);
    for(const role of roleResult.rows) {
      assert.equal(role.rolcanlogin,false);
      assert.equal(role.rolsuper,false);
      assert.equal(role.rolcreatedb,false);
      assert.equal(role.rolcreaterole,false);
    }

    const grants=await pool.query(
      "SELECT "+[
        "has_table_privilege('kinglike_wa_archive_worker','public.users','SELECT') AS worker_identity_read",
        "has_table_privilege('kinglike_wa_archive_worker','public.users','UPDATE') AS worker_identity_update",
        "has_table_privilege('kinglike_wa_archive_worker','whatsapp_employee_events','INSERT') AS worker_event_insert",
        "has_table_privilege('kinglike_wa_archive_worker','whatsapp_employee_events','UPDATE') AS worker_event_update",
        "has_table_privilege('kinglike_wa_archive_worker','whatsapp_employee_events','DELETE') AS worker_event_delete",
        "has_table_privilege('kinglike_wa_archive_worker','kinglike_whatsapp.whatsapp_employee_inbox','INSERT') AS worker_queue_insert",
        "has_table_privilege('kinglike_wa_archive_worker','whatsapp_employee_access_audit','INSERT') AS worker_access_audit_insert",
        "has_table_privilege('kinglike_wa_archive_reader','whatsapp_employee_events','SELECT') AS reader_event_select",
        "has_table_privilege('kinglike_wa_archive_reader','whatsapp_employee_events','INSERT') AS reader_event_insert",
        "has_table_privilege('kinglike_wa_archive_auditwriter','whatsapp_employee_access_audit','INSERT') AS audit_insert",
        "has_table_privilege('kinglike_wa_archive_auditwriter','whatsapp_employee_access_audit','SELECT') AS audit_select",
        "has_table_privilege('kinglike_wa_archive_auditwriter','whatsapp_employee_access_audit','DELETE') AS audit_delete",
        "has_table_privilege('kinglike_wa_archive_identitysync','public.users','INSERT') AS sync_identity_insert",
        "has_table_privilege('kinglike_wa_archive_identitysync','whatsapp_employee_events','SELECT') AS sync_event_read",
        "has_table_privilege('kinglike_wa_archive_identitysync','whatsapp_employee_identity_sync_audit','INSERT') AS sync_audit_insert",
        "has_table_privilege('kinglike_wa_archive_identitysync','whatsapp_employee_identity_sync_audit','SELECT') AS sync_audit_read",
        "has_table_privilege('kinglike_wa_archive_identitysync','whatsapp_employee_identity_sync_audit','UPDATE') AS sync_audit_update",
      ].join(", "),
    );
    const p=grants.rows[0];
    const yes=["worker_identity_read","worker_event_insert","worker_queue_insert",
      "reader_event_select","audit_insert","sync_identity_insert","sync_audit_insert"];
    const no=["worker_identity_update","worker_event_update","worker_event_delete",
      "worker_access_audit_insert","reader_event_insert","audit_select","audit_delete",
      "sync_event_read","sync_audit_read","sync_audit_update"];
    yes.forEach(k=>assert.equal(p[k],true,k));
    no.forEach(k=>assert.equal(p[k],false,k));


    // The real isolated archive uses the NOLOGIN role
    // kinglike_wa_archive_auditwriter, not the legacy synthetic owner name.
    // SET LOCAL ROLE exercises the exact SQL permission guard without enabling
    // real role logins or writing a customer or employee access record.
    const auditRoleClient=await pool.connect();
    try{
      await auditRoleClient.query("BEGIN");
      await auditRoleClient.query("SET LOCAL ROLE kinglike_wa_archive_auditwriter");
      await assertWhatsappEmployeeAuditWriter(auditRoleClient as any);
      await auditRoleClient.query("ROLLBACK");
    }finally{
      auditRoleClient.release();
    }

    // Exercise the real isolated NOLOGIN identity-sync role without enabling
    // credentials or retaining any identities after transaction ROLLBACK.
    const mirrorClient=await pool.connect();
    try{
      await mirrorClient.query("BEGIN");
      await mirrorClient.query("SET LOCAL ROLE kinglike_wa_archive_identitysync");
      // Use only the approved principal columns. This test's isolated database
      // name intentionally differs from the live guard's required database.
      await mirrorClient.query(
        "INSERT INTO public.users(id,is_active,is_admin,role,verified_at)"+
        " VALUES (501,true,false,'sub_agent',NOW())");
      await mirrorClient.query(
        "INSERT INTO public.users(id,is_active,is_admin,role,verified_at)"+
        " VALUES (501,false,false,'inactive',NOW()) ON CONFLICT(id) DO UPDATE"+
        " SET is_active=EXCLUDED.is_active,is_admin=EXCLUDED.is_admin,"+
        " role=EXCLUDED.role,verified_at=NOW()");
      await mirrorClient.query(
        "INSERT INTO public.whatsapp_employee_identity_sync_audit(actor_id,employee_id,action)"+
        " VALUES (301,501,'deactivate')");
      await mirrorClient.query("SAVEPOINT denied_identity_audit_read");
      await assert.rejects(mirrorClient.query(
        "SELECT * FROM public.whatsapp_employee_identity_sync_audit"),/permission denied/);
      // A denied statement aborts the transaction; use a SAVEPOINT for tests.
      await mirrorClient.query("ROLLBACK TO SAVEPOINT denied_identity_audit_read");
      const mirrorRow=await mirrorClient.query(
        "SELECT is_active,is_admin,role FROM public.users WHERE id=501");
      assert.deepEqual(mirrorRow.rows[0],{
        is_active:false,is_admin:false,role:"inactive",
      });
      await mirrorClient.query("ROLLBACK");
    }finally{
      mirrorClient.release();
    }

    const immutability=await pool.query(
      "SELECT (SELECT COUNT(*)::int FROM pg_trigger"+
      " WHERE tgrelid='whatsapp_employee_identity_sync_audit'::regclass"+
      " AND tgname='whatsapp_employee_identity_sync_audit_immutable' AND tgenabled='O') AS enabled");
    assert.equal(immutability.rows[0].enabled,1);
    const owner=await pool.query("SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='whatsapp_employee_events'");
    assert.equal(owner.rowCount,1);
    assert.equal(roles.includes(owner.rows[0].tableowner),false,"archive role must not own event table");

    // Test the append-only trigger with entirely synthetic, isolated rows.
    await pool.query("INSERT INTO public.users(id,is_active,role) VALUES (101,true,'sub_agent')");
    await pool.query(
      "INSERT INTO whatsapp_employee_numbers(phone_number_id,waba_id,employee_id,registration_kind)"+
      " VALUES ('5550101','7000101',101,'company')",
    );
    const created=await pool.query(
      "INSERT INTO whatsapp_employee_conversations(employee_id,phone_number_id,waba_id,contact_wa_id)"+
      " VALUES (101,'5550101','7000101','15550000002') RETURNING id",
    );
    await pool.query(
      "INSERT INTO whatsapp_employee_events(conversation_id,employee_id,meta_event_key,meta_message_id,event_kind,direction,source_field,message_text)"+
      " VALUES ($1,101,'message:synthetic-original','synthetic-original','message','inbound','messages','original preserved')",
      [created.rows[0].id],
    );
    await assert.rejects(pool.query(
      "UPDATE whatsapp_employee_events SET message_text='removed' WHERE meta_event_key='message:synthetic-original'",
    ),/append-only/);
    await assert.rejects(pool.query(
      "DELETE FROM whatsapp_employee_events WHERE meta_event_key='message:synthetic-original'",
    ),/append-only/);
    const original=await pool.query(
      "SELECT message_text FROM whatsapp_employee_events WHERE meta_event_key='message:synthetic-original'",
    );
    assert.equal(original.rows[0].message_text,"original preserved");
    // Prove the actual NOLOGIN worker can archive with its column-scoped
    // grants, without UPDATE permission on immutable event/original rows.
    const worker=await pool.connect();
    try {
      await worker.query("BEGIN");
      await worker.query("SET LOCAL ROLE kinglike_wa_archive_worker");
      const registration=await worker.query(
        "SELECT employee_id FROM whatsapp_employee_numbers WHERE phone_number_id='5550101' LIMIT 1");
      assert.equal(registration.rows[0].employee_id,101);
      const saved=await worker.query(
        "INSERT INTO whatsapp_employee_events(conversation_id,employee_id,"+
        "meta_event_key,meta_message_id,event_kind,direction,source_field,message_text)"+
        " VALUES ($1,101,'worker-role:original','worker-role-id','message',"+
        "'inbound','messages','worker preserved original')"+
        " ON CONFLICT(meta_event_key) DO NOTHING RETURNING id",[created.rows[0].id]);
      assert.equal(saved.rowCount,1);
      const revoke=await worker.query(
        "INSERT INTO whatsapp_employee_events(conversation_id,employee_id,"+
        "meta_event_key,meta_message_id,event_kind,direction,source_field,related_message_id)"+
        " VALUES ($1,101,'worker-role:revoke','worker-role-revoke-id','revoke',"+
        "'inbound','messages','worker-role-id')"+
        " ON CONFLICT(meta_event_key) DO NOTHING RETURNING id",[created.rows[0].id]);
      assert.equal(revoke.rowCount,1);
      const marked=await worker.query(
        "SELECT e.message_text,EXISTS(SELECT 1 FROM whatsapp_employee_events r"+
        " WHERE r.conversation_id=e.conversation_id AND r.event_kind='revoke'"+
        " AND r.related_message_id=e.meta_message_id AND r.direction=e.direction) AS deleted"+
        " FROM whatsapp_employee_events e WHERE e.meta_event_key='worker-role:original'");
      assert.equal(marked.rows[0].message_text,"worker preserved original");
      assert.equal(marked.rows[0].deleted,true);
      await worker.query("ROLLBACK");
    } finally {worker.release();}


  }finally{
    await pool.end();
  }
});
