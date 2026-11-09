import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  createEmployeeWhatsappDurableInbox,
  EmployeeInboxRejected,
  EMPLOYEE_WEBHOOK_MAX_BYTES,
  type EmployeeInboxScope,
} from "./whatsappEmployeeDurableInbox";
import { normalizeWhatsappWebhook } from "./whatsappEmployeeWebhook";

const url = process.env.WHATSAPP_EMPLOYEE_TEST_DATABASE_URL;
const scope: EmployeeInboxScope = {
  employeeId:101,wabaId:"1234567801",phoneNumberId:"1234567802",
  displayPhoneNumber:"15550000001",
};
const encKey = Buffer.alloc(32,11);
const dedupeKey = Buffer.alloc(32,12);
const appSecret = "synthetic-meta-app-secret";
const inboxTable = "kinglike_whatsapp.whatsapp_employee_inbox";

function syntheticRaw(messageId: string, body = "original private message") {
  return Buffer.from(JSON.stringify({
    object:"whatsapp_business_account",
    entry:[{id:scope.wabaId,changes:[{
      field:"messages",value:{
        messaging_product:"whatsapp",
        metadata:{phone_number_id:scope.phoneNumberId,display_phone_number:scope.displayPhoneNumber},
        messages:[{id:messageId,from:"15550000002",type:"text",text:{body}}],
      },
    }]}],
  }));
}

function signature(body: Buffer): string {
  return "sha256="+createHmac("sha256",appSecret).update(body).digest("hex");
}

test("isolated PostgreSQL durable inbox: HMAC, idempotence, encryption, retry, lease recovery and access", {
  skip: !url,
}, async (t) => {
  assert.ok(url);
  const parsed = new URL(url);
  assert.ok(["localhost","127.0.0.1","::1","[::1]"].includes(parsed.hostname));
  assert.match(parsed.pathname.toLowerCase(),/(^|[_-])(test|testing)([_-]|$)/);
  const pool = new pg.Pool({connectionString:url,max:6});
  const schemaSql = await readFile(
    new URL("../docs/sql/2026-11-09-whatsapp-employee-durable-inbox.sql.txt",import.meta.url),"utf8",
  );
  // This is a disposable CI database: never point the test at Railway/Neon.
  await pool.query(schemaSql);
  let authorized = true;
  const consumed: Array<{ids:string[];source:string}> = [];
  let shouldFail = false;
  let numberOfCalls = 0;
  const inbox = createEmployeeWhatsappDurableInbox({
    db:pool,encryptionKey:encKey,dedupeKey,metaAppSecret:appSecret,
    authorizeScope:async (s) => authorized && s.employeeId===scope.employeeId &&
      s.wabaId===scope.wabaId && s.phoneNumberId===scope.phoneNumberId &&
      s.displayPhoneNumber===scope.displayPhoneNumber,
    consume:async (raw,s) => {
      numberOfCalls++;
      assert.deepEqual(s,scope);
      if (shouldFail) throw Error("synthetic worker failure");
      const events = normalizeWhatsappWebhook(JSON.parse(raw.toString()));
      consumed.push({ids:events.map(e=>e.eventKey),source:events[0]?.text ?? ""});
    },
    maxAttempts:2,leaseSeconds:5,
  });

  try {
    await t.test("HMAC/identity verification and consent reject before any persistence", async () => {
      const raw = syntheticRaw("m-original");
      await assert.rejects(inbox.enqueueSigned(raw,"sha256="+"0".repeat(64),scope),
        EmployeeInboxRejected);
      await assert.rejects(inbox.enqueueSigned(raw,signature(raw),{...scope,wabaId:"9999999999"}),
        EmployeeInboxRejected);
      await assert.rejects(inbox.enqueueSigned(Buffer.alloc(EMPLOYEE_WEBHOOK_MAX_BYTES+1,1),
        signature(Buffer.alloc(EMPLOYEE_WEBHOOK_MAX_BYTES+1,1)),scope),EmployeeInboxRejected);
      authorized=false;
      await assert.rejects(inbox.enqueueSigned(raw,signature(raw),scope),EmployeeInboxRejected);
      authorized=true;
      const {rows:[count]} = await pool.query("SELECT COUNT(*)::int AS n FROM "+inboxTable);
      assert.equal(count.n,0);
    });

    await t.test("persist signed payload encrypted, deduplicate retry and drain only once",async () => {
      const raw = syntheticRaw("m-original");
      assert.equal(await inbox.enqueueSigned(raw,signature(raw),scope),"accepted");
      assert.equal(await inbox.enqueueSigned(raw,signature(raw),scope),"duplicate");
      const {rows:[row]} = await pool.query(
        "SELECT status,payload_ciphertext,payload_iv,payload_tag,delivery_key FROM "+inboxTable+
        " WHERE employee_id=$1",[scope.employeeId],
      );
      assert.equal(row.status,"pending");
      assert.equal(Buffer.isBuffer(row.payload_ciphertext),true);
      assert.notEqual(row.payload_ciphertext.toString(),raw.toString());
      assert.equal(row.payload_iv.length,12);
      assert.equal(row.payload_tag.length,16);
      assert.match(row.delivery_key,/^[a-f0-9]{64}$/);
      assert.equal(await inbox.processOne(),"processed");
      assert.equal(consumed.length,1);
      assert.deepEqual(consumed[0].ids,["message:m-original"]);
      const processed=await pool.query(
        "SELECT status,payload_ciphertext,payload_iv,payload_tag,attempt_count FROM "+inboxTable+
        " WHERE delivery_key=$1",[row.delivery_key],
      );
      assert.equal(processed.rows[0].status,"processed");
      assert.equal(processed.rows[0].payload_ciphertext,null);
      assert.equal(processed.rows[0].payload_iv,null);
      assert.equal(processed.rows[0].payload_tag,null);
      assert.equal(processed.rows[0].attempt_count,1);
      assert.equal(await inbox.processOne(),"empty");
      // Replayed signed HTTP request cannot recreate a processed original.
      assert.equal(await inbox.enqueueSigned(raw,signature(raw),scope),"duplicate");
      assert.equal(await inbox.processOne(),"empty");
    });

    await t.test("retry on failure, preserve ciphertext until archived and then clear it",async () => {
      const raw=syntheticRaw("m-retry");
      assert.equal(await inbox.enqueueSigned(raw,signature(raw),scope),"accepted");
      shouldFail=true;
      assert.equal(await inbox.processOne(),"retry");
      let state=await pool.query("SELECT status,attempt_count,payload_ciphertext FROM "+
        inboxTable+" WHERE status='retry'");
      assert.equal(state.rows[0].attempt_count,1);
      assert.ok(Buffer.isBuffer(state.rows[0].payload_ciphertext));
      await pool.query("UPDATE "+inboxTable+" SET available_at=now()-interval '1 second' WHERE status='retry'");
      shouldFail=false;
      assert.equal(await inbox.processOne(),"processed");
      assert.equal(consumed.length,2);
      assert.deepEqual(consumed[1].ids,["message:m-retry"]);
    });

    await t.test("dead letter after bounded retries: no silent acknowledgement or data loss",async () => {
      const raw=syntheticRaw("m-dead");
      await inbox.enqueueSigned(raw,signature(raw),scope);
      shouldFail=true;
      assert.equal(await inbox.processOne(),"retry");
      await pool.query("UPDATE "+inboxTable+" SET available_at=now()-interval '1 second' WHERE status='retry'");
      assert.equal(await inbox.processOne(),"dead_letter");
      const {rows:[dead]}=await pool.query("SELECT status,attempt_count,last_error_class,payload_ciphertext FROM "+
        inboxTable+" WHERE status='dead_letter'");
      assert.equal(dead.status,"dead_letter");
      assert.equal(dead.attempt_count,2);
      assert.equal(dead.last_error_class,"PROCESS_FAILED");
      assert.ok(Buffer.isBuffer(dead.payload_ciphertext));
      shouldFail=false;
      assert.equal(await inbox.processOne(),"empty");
    });

    await t.test("revoked employee consent prevents consuming previously queued message",async () => {
      const raw=syntheticRaw("m-revoked");
      await inbox.enqueueSigned(raw,signature(raw),scope);
      const before=numberOfCalls;
      authorized=false;
      assert.equal(await inbox.processOne(),"blocked");
      assert.equal(numberOfCalls,before);
      authorized=true;
      const blocked=await pool.query("SELECT COUNT(*)::int AS n FROM "+inboxTable+
        " WHERE status='blocked' AND last_error_class='CONSENT_REVOKED'");
      assert.equal(blocked.rows[0].n,1);
    });

    await t.test("expired worker lease is reclaimed and concurrent consumers do not double-claim",async () => {
      const raw=syntheticRaw("m-lease");
      await inbox.enqueueSigned(raw,signature(raw),scope);
      const leaseBefore=await pool.query("SELECT id FROM "+inboxTable+
        " WHERE status='pending'");
      assert.equal(leaseBefore.rowCount,1);
      const id=leaseBefore.rows[0].id;
      await pool.query("UPDATE "+inboxTable+
        " SET status='processing',lease_token='11111111-1111-4111-8111-111111111111',"+
        " locked_until=now()-interval '1 second',attempt_count=1 WHERE id=$1",[id]);
      const result=await Promise.all([inbox.processOne(),inbox.processOne()]);
      assert.deepEqual(result.sort(),["empty","processed"].sort());
      const lease=await pool.query("SELECT status,attempt_count FROM "+inboxTable+
        " WHERE id=$1",[id]);
      assert.equal(lease.rowCount,1);
      assert.equal(lease.rows[0].status,"processed");
      assert.equal(lease.rows[0].attempt_count,2);
    });

    await t.test("errors never persist raw message text in worker error classifications",async () => {
      const {rows}=await pool.query("SELECT last_error_class FROM "+inboxTable+
        " WHERE last_error_class IS NOT NULL");
      assert.equal(rows.every(r=>["PROCESS_FAILED","DECRYPT_FAILED","CONSENT_REVOKED"].includes(r.last_error_class)),true);
    });
  } finally {
    await pool.query("DROP SCHEMA IF EXISTS kinglike_whatsapp CASCADE");
    await pool.end();
  }
});
