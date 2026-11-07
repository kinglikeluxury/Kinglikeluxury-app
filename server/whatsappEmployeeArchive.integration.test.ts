import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString = process.env.WHATSAPP_EMPLOYEE_TEST_DATABASE_URL;

function assertIsolatedTestDb(value: string | undefined): asserts value is string {
  if (!value) throw new Error("WHATSAPP_EMPLOYEE_TEST_DATABASE_URL is required for this integration test.");
  const parsed = new URL(value);
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) ||
      !/(^|[_-])(test|testing)([_-]|$)/.test(dbName)) {
    throw new Error("Refusing integration test outside a loopback, test-named database.");
  }
}

test("PostgreSQL schema enforces FK, idempotency, and consent revocation serialization", {
  skip: !connectionString,
}, async (t) => {
  assertIsolatedTestDb(connectionString);
  const pool = new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 1500 });
  const schema = `wa_archive_test_${process.pid}_${Date.now()}`;
  const migration = await readFile(
    new URL("../docs/sql/2026-11-07-whatsapp-employee-unified.sql.txt", import.meta.url),
    "utf8",
  );
  const connect = async () => {
    const client = await pool.connect();
    await client.query(`SET search_path TO "${schema}"`);
    return client;
  };

  const setup = await pool.connect();
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`SET search_path TO "${schema}"`);
    await setup.query(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        role TEXT NOT NULL DEFAULT 'sub_agent'
      )
    `);
    await setup.query(migration);
    await setup.query(`INSERT INTO users(id) VALUES (101),(102),(201)`);
    await setup.query(`
      INSERT INTO whatsapp_employee_numbers
        (phone_number_id,waba_id,employee_id,is_active,business_authorized_at,authorized_by)
      VALUES ('5550101','7000101',101,true,NOW(),201)
    `);
    await setup.query(`
      INSERT INTO whatsapp_employee_consents
        (phone_number_id,employee_id,status,consented_at,last_actor_id)
      VALUES ('5550101',101,'consented',NOW(),101)
    `);
    await setup.query(`
      INSERT INTO whatsapp_employee_conversations(employee_id,phone_number_id,waba_id,contact_wa_id)
      VALUES (101,'5550101','7000101','synthetic-contact')
    `);
  } finally {
    setup.release();
  }

  try {
    await t.test("unique event key makes webhook retries idempotent", async () => {
      const client = await connect();
      try {
        const insert = `INSERT INTO whatsapp_employee_events
          (conversation_id,employee_id,meta_event_key,meta_message_id,event_kind,direction,source_field)
          SELECT id,101,'synthetic-event-1','synthetic-message-1','message','inbound','messages'
            FROM whatsapp_employee_conversations
          ON CONFLICT (meta_event_key) DO NOTHING RETURNING id`;
        assert.equal((await client.query(insert)).rowCount, 1);
        assert.equal((await client.query(insert)).rowCount, 0);
      } finally { client.release(); }
    });

    await t.test("foreign keys reject an unregistered employee", async () => {
      const client = await connect();
      try {
        await assert.rejects(
          client.query(`INSERT INTO whatsapp_employee_conversations
            (employee_id,phone_number_id,waba_id,contact_wa_id)
            VALUES (999,'5550101','7000101','synthetic-contact')`),
          (error: any) => error?.code === "23503",
        );
      } finally { client.release(); }
    });

    await t.test("revocation waits for an in-flight authorized read, then blocks later reads", async () => {
      const reader = await connect();
      const revoker = await connect();
      try {
        await reader.query("BEGIN");
        const consent = await reader.query(
          `SELECT n.phone_number_id FROM whatsapp_employee_numbers n
             JOIN whatsapp_employee_consents c USING (phone_number_id,employee_id)
            WHERE n.employee_id=101 AND n.is_active=true AND c.status='consented'
              AND c.revoked_at IS NULL FOR SHARE OF n,c`,
        );
        assert.equal(consent.rowCount, 1);
        await revoker.query("BEGIN");
        let revokeFinished = false;
        const revoke = revoker.query(
          `UPDATE whatsapp_employee_numbers SET is_active=false WHERE phone_number_id='5550101'`,
        ).then(async () => {
          await revoker.query(`UPDATE whatsapp_employee_consents
            SET status='revoked',revoked_at=NOW(),last_actor_id=101
            WHERE phone_number_id='5550101' AND employee_id=101`);
          revokeFinished = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(revokeFinished, false);
        await reader.query("COMMIT");
        await revoke;
        await revoker.query("COMMIT");
        const after = await revoker.query(
          `SELECT 1 FROM whatsapp_employee_numbers n
             JOIN whatsapp_employee_consents c USING (phone_number_id,employee_id)
            WHERE n.employee_id=101 AND n.is_active=true AND c.status='consented'
              AND c.revoked_at IS NULL`,
        );
        assert.equal(after.rowCount, 0);
      } finally {
        await reader.query("ROLLBACK").catch(() => undefined);
        await revoker.query("ROLLBACK").catch(() => undefined);
        reader.release();
        revoker.release();
      }
    });
  } finally {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("RESET search_path");
      await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      cleanup.release();
      await pool.end();
    }
  }
});
