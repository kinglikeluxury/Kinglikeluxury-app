import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import pg from "pg";
import {
  closeWhatsappEmployeeArchiveTestPool,
  registerWhatsappEmployeeArchiveRoutes,
} from "./whatsappEmployeeArchiveRoutes";
import {
  closeWhatsappEmployeeWebhookTestPool,
  registerWhatsappEmployeeWebhook,
} from "./whatsappEmployeeWebhook";

const connectionString = process.env.WHATSAPP_EMPLOYEE_TEST_DATABASE_URL;

test("local HTTP flow: signed webhooks, consent, Coexistence, audit, and archive RBAC", {
  skip: !connectionString,
}, async () => {
  assert.ok(connectionString);
  const baseUrl = new URL(connectionString);
  const dbName = baseUrl.pathname.replace(/^\//, "").toLowerCase();
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(baseUrl.hostname));
  assert.match(dbName, /(^|[_-])(test|testing)([_-]|$)/);

  const pool = new pg.Pool({ connectionString, max: 3 });
  const schema = `wa_http_test_${process.pid}_${Date.now()}`;
  const migration = await readFile(
    new URL("../docs/sql/2026-11-07-whatsapp-employee-unified.sql.txt", import.meta.url),
    "utf8",
  );
  const setup = await pool.connect();
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
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
    await setup.query(`
      INSERT INTO users(id,is_admin,role) VALUES
        (101,false,'sub_agent'),(102,false,'sub_agent'),(201,false,'user'),(301,true,'user')
    `);
    await setup.query(`
      INSERT INTO whatsapp_employee_numbers
        (phone_number_id,waba_id,employee_id,registration_kind,display_phone_number,is_active,business_authorized_at,authorization_reference,
         authorized_by,activated_by,activated_at,coexistence_enabled,coexistence_verified_at,coexistence_verification_ref)
      VALUES
        ('5550101','7000101',101,'company','15550000001',true,NOW(),'synthetic-proof-ref',301,201,NOW(),true,NOW(),'synthetic-session-1'),
        ('5550102','7000101',101,'company','15550000001',true,NOW(),'synthetic-proof-ref-2',301,201,NOW(),true,NULL,NULL),
        ('5550103','7000101',102,'company','15550000003',true,NOW(),'synthetic-proof-ref-3',301,201,NOW(),true,NOW(),'synthetic-session-3'),
        ('5550104','7000999',101,'test','15550000004',true,NOW(),'synthetic-test-ref',301,201,NOW(),true,NOW(),'synthetic-test-session')
    `);
    await setup.query(`
      INSERT INTO whatsapp_employee_consents
        (phone_number_id,employee_id,status,consented_at,last_actor_id)
      VALUES ('5550101',101,'consented',NOW(),101),('5550102',101,'consented',NOW(),101),
             ('5550104',101,'consented',NOW(),101)
    `);
    await setup.query("INSERT INTO whatsapp_employee_supervisor_grants (supervisor_id,employee_id,can_read,granted_by) VALUES (201,101,true,301)");
    await setup.query(`
      CREATE FUNCTION delay_race_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.meta_event_key = 'message:synthetic-race-event' THEN PERFORM pg_sleep(0.3); END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER delay_race_event BEFORE INSERT ON whatsapp_employee_events
        FOR EACH ROW EXECUTE FUNCTION delay_race_event();
    `);

    const routeDbUrl = new URL(connectionString);
    routeDbUrl.searchParams.set("options", `-c search_path=${schema}`);
    process.env.WHATSAPP_EMPLOYEE_TEST_DATABASE_URL = routeDbUrl.toString();
    process.env.NODE_ENV = "test";
    process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED = "true";
    process.env.WHATSAPP_EMPLOYEE_ARCHIVE_ENABLED = "true";
    process.env.WHATSAPP_EMPLOYEE_WEBHOOK_VERIFY_TOKEN = "synthetic-verify-token";
    process.env.WHATSAPP_EMPLOYEE_META_APP_SECRET = "synthetic-meta-app-secret";
    process.env.WHATSAPP_EMPLOYEE_APPROVED_WABA_IDS = "7000101";

    const app = express();
    app.use(express.json({
      verify: (req: any, _res, body) => {
        if (req.path === "/api/webhooks/whatsapp-employee") req.rawBody = Buffer.from(body);
      },
    }));
    app.use((req: any, _res, next) => {
      req.session = { userId: Number(req.header("x-test-user-id")) };
      next();
    });
    registerWhatsappEmployeeWebhook(app);
    registerWhatsappEmployeeArchiveRoutes(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const request = (method: string, path: string, userId: number, body?: unknown, headers: Record<string, string> = {}) =>
      fetch(`${origin}${path}`, {
        method,
        headers: { "x-test-user-id": String(userId), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const signedPost = (raw: string, signatureOverride?: string) => {
      const signature = `sha256=${crypto.createHmac("sha256", "synthetic-meta-app-secret").update(Buffer.from(raw)).digest("hex")}`;
      return fetch(`${origin}/api/webhooks/whatsapp-employee`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signatureOverride ?? signature,
        },
        body: raw,
      });
    };

    const challenge = await fetch(
      `${origin}/api/webhooks/whatsapp-employee?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=synthetic-challenge`,
    );
    assert.equal(challenge.status, 200);
    assert.equal(await challenge.text(), "synthetic-challenge");
    const badChallenge = await fetch(
      `${origin}/api/webhooks/whatsapp-employee?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x`,
    );
    assert.equal(badChallenge.status, 403);

    const payload = {
      object: "whatsapp_business_account",
      entry: [{ id: "7000101", changes: [
        { field: "messages", value: { metadata: { phone_number_id: "5550101" },
          contacts: [{ wa_id: "15550000002", user_id: "synthetic-user-2" }],
          messages: [{ id: "synthetic-in-1", from: "15550000002", type: "text", text: { body: "synthetic inbound" }, timestamp: "1730000000" }],
          statuses: [{ id: "synthetic-out-1", recipient_id: "15550000002", status: "delivered", timestamp: "1730000001" }] } },
        { field: "smb_message_echoes", value: { metadata: { phone_number_id: "5550101", display_phone_number: "15550000001" },
          contacts: [{ wa_id: "15550000002", user_id: "synthetic-user-2" }],
          message_echoes: [{ id: "synthetic-echo-1", from: "15550000001", to: "15550000002", to_user_id: "synthetic-user-2",
            type: "text", text: { body: "synthetic echo" }, timestamp: "1730000002" }] } },
      ] }],
    };
    const rawPayload = JSON.stringify(payload);
    assert.equal((await signedPost(rawPayload, "sha256=" + "0".repeat(64))).status, 401);
    const accepted = await signedPost(rawPayload);
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.text()), "EVENT_RECEIVED");
    assert.equal((await signedPost(rawPayload)).status, 200);

    const editAndRevokePayload = {
      object: "whatsapp_business_account",
      entry: [{ id: "7000101", changes: [{ field: "smb_message_echoes", value: {
        metadata: { phone_number_id: "5550101", display_phone_number: "15550000001" },
        contacts: [{ wa_id: "15550000002", user_id: "synthetic-user-2" }],
        message_echoes: [
          { id: "synthetic-edit-1", from: "15550000001", to: "15550000002", to_user_id: "synthetic-user-2",
            type: "edit", edit: { original_message_id: "synthetic-echo-1",
              message: { type: "image", image: { caption: "synthetic edited caption", id: "synthetic-media", url: "https://invalid.example/signed" } } } },
          { id: "synthetic-revoke-1", from: "15550000001", to: "15550000002", to_user_id: "synthetic-user-2",
            type: "revoke", revoke: { original_message_id: "synthetic-echo-1" } },
        ],
      } }] }],
    };
    assert.equal((await signedPost(JSON.stringify(editAndRevokePayload))).status, 200);
    const identitySwitchPayload = {
      object: "whatsapp_business_account",
      entry: [{ id: "7000101", changes: [{ field: "smb_message_echoes", value: {
        metadata: { phone_number_id: "5550101", display_phone_number: "15550000001" },
        message_echoes: [{ id: "synthetic-echo-1", from: "15550000001", to: "15550000099",
          to_user_id: "synthetic-user-99", type: "text", text: { body: "identity switch must not store" } }],
      } }] }],
    };
    assert.equal((await signedPost(JSON.stringify(identitySwitchPayload))).status, 200);
    const unresolvedEdit = {
      object: "whatsapp_business_account",
      entry: [{ id: "7000101", changes: [{ field: "smb_message_echoes", value: {
        metadata: { phone_number_id: "5550101", display_phone_number: "15550000001" },
        message_echoes: [{ id: "synthetic-unresolved-edit", from: "15550000001", to: "15550000002",
          to_user_id: "synthetic-user-2", type: "edit",
          edit: { original_message_id: "missing-original", message: { type: "text", text: { body: "must not store" } } } }],
      } }] }],
    };
    assert.equal((await signedPost(JSON.stringify(unresolvedEdit))).status, 200);

    const unconsentedPayload = {
      object: "whatsapp_business_account",
      entry: [{ id: "7000101", changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "5550103" },
        messages: [{ id: "synthetic-unconsented", from: "15550000003", type: "text", text: { body: "must not store" } }],
      } }] }],
    };
    assert.equal((await signedPost(JSON.stringify(unconsentedPayload))).status, 200);

    const ineligibleEcho = {
      object: "whatsapp_business_account",
      entry: [{ id: "7000101", changes: [{ field: "smb_message_echoes", value: {
        metadata: { phone_number_id: "5550102" },
        metadata: { phone_number_id: "5550102", display_phone_number: "15550000001" },
        message_echoes: [{ id: "synthetic-ineligible-echo", from: "15550000001", to: "15550000002",
          to_user_id: "synthetic-user-2", type: "text", text: { body: "must not store" } }],
      } }] }],
    };
    assert.equal((await signedPost(JSON.stringify(ineligibleEcho))).status, 200);

    const testWabaPayload = {
      object: "whatsapp_business_account",
      entry: [{ id: "7000999", changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "5550104" },
        messages: [{ id: "synthetic-test-waba-event", from: "15550000004", type: "text", text: { body: "must not store" } }],
      } }] }],
    };
    assert.equal((await signedPost(JSON.stringify(testWabaPayload))).status, 200);
    const unauthorizedWabaPayload = {
      object: "whatsapp_business_account",
      entry: [{ id: "7999999", changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "5550101" },
        messages: [{ id: "synthetic-unauthorized-waba", from: "15550000002", type: "text", text: { body: "must not store" } }],
      } }] }],
    };
    assert.equal((await signedPost(JSON.stringify(unauthorizedWabaPayload))).status, 200);
    const wrongBusinessDisplayPayload = {
      object: "whatsapp_business_account",
      entry: [{ id: "7000101", changes: [{ field: "smb_message_echoes", value: {
        metadata: { phone_number_id: "5550101", display_phone_number: "15559999999" },
        message_echoes: [{ id: "synthetic-wrong-display", from: "15559999999", to: "15550000002",
          to_user_id: "synthetic-user-2", type: "text", text: { body: "must not store" } }],
      } }] }],
    };
    assert.equal((await signedPost(JSON.stringify(wrongBusinessDisplayPayload))).status, 200);

    const conversationResult = await request(
      "GET", "/api/whatsapp-employee/archive/employees/101/conversations", 101,
    );
    assert.equal(conversationResult.status, 200);
    const conversations = (await conversationResult.json() as any).conversations;
    assert.equal(conversations.length, 1);
    const conversationId = conversations[0].id;
    const messagesUrl = `/api/whatsapp-employee/archive/conversations/${conversationId}/messages`;
    assert.equal((await request("GET", messagesUrl, 102)).status, 403);
    assert.equal((await request("GET", "/api/whatsapp-employee/archive/employees/101/conversations", 301)).status, 403);
    assert.equal((await request("GET", "/api/whatsapp-employee/archive/employees/101/conversations", 201)).status, 200);
    const archive = (await (await request("GET", messagesUrl, 101)).json() as any).messages;
    assert.equal(archive.length, 5);
    assert.ok(archive.some((row: any) => row.event_kind === "message" && row.message_text === "synthetic echo"));
    assert.ok(archive.some((row: any) => row.event_kind === "edit" &&
      row.related_message_id === "synthetic-echo-1" && row.message_text === "synthetic edited caption"));
    assert.ok(archive.some((row: any) => row.event_kind === "revoke" &&
      row.related_message_id === "synthetic-echo-1" && row.message_text === null));
    assert.equal(archive.some((row: any) => "media_url" in row || "raw_payload" in row), false);

    const racePayload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "7000101", changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "5550101" },
        messages: [{ id: "synthetic-race-event", from: "15550000002", type: "text", text: { body: "race fixture" } }],
      } }] }],
    });
    const raceWebhook = signedPost(racePayload);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const revoke = request("POST", "/api/employee/whatsapp-consents/5550101", 101, { decision: "revoked" });
    const [raceResponse, revokeResponse] = await Promise.all([raceWebhook, revoke]);
    assert.equal(raceResponse.status, 200);
    assert.equal(revokeResponse.status, 204);

    assert.equal((await signedPost(rawPayload)).status, 200);
    assert.equal((await request("GET", messagesUrl, 101)).status, 403);

    const verify = await pool.connect();
    try {
      await verify.query(`SET search_path TO "${schema}"`);
      const stored = await verify.query(`SELECT meta_event_key,direction,source_field FROM whatsapp_employee_events ORDER BY meta_event_key`);
      assert.equal(stored.rowCount, 6);
      assert.deepEqual(stored.rows.map((row) => row.direction).sort(), ["inbound", "inbound", "outbound", "outbound", "outbound", "status"]);
      const audit = await verify.query(
        `SELECT actor_id,action,outcome FROM whatsapp_employee_audit
          WHERE action IN ('consent_revoked','webhook_event') ORDER BY id`,
      );
      assert.ok(audit.rows.some((row) => row.actor_id === 101 && row.action === "consent_revoked"));
      assert.ok(audit.rows.some((row) => row.outcome === "stored"));
      assert.ok(audit.rows.some((row) => row.outcome === "duplicate"));
      assert.ok(audit.rows.some((row) => row.outcome === "identity_mismatch"));
      assert.ok(audit.rows.some((row) => row.outcome === "unresolved_reference"));
      assert.ok(audit.rows.filter((row) => row.outcome === "not_consented").length >= 4);
    } finally { verify.release(); }
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await closeWhatsappEmployeeWebhookTestPool();
    await closeWhatsappEmployeeArchiveTestPool();
    await setup.query("RESET search_path");
    await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    setup.release();
    await pool.end();
  }
});
