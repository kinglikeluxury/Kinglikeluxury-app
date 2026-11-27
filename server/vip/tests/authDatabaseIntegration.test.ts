import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import bcrypt from "bcrypt";
import { spawn } from "node:child_process";
import express from "express";
import session from "express-session";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { DatabaseStorage } from "../../database-storage";
import { createRegisterHandler } from "../../authRegisterRoute";
import {
  createPhoneOtpIssueHandler,
  createPhoneOtpVerificationHandler,
} from "../../authPhoneOtpRoutes";
import {
  type PhoneOtpAttemptLimiter,
} from "../../phoneOtpProof";
import {
  checkPhoneOtpIssueRateLimit,
  checkSharedOtpIpRateLimit,
  createSharedPhoneOtpAttemptLimiter,
} from "../../phoneOtpRateLimit";
import { registerAuthSessionRoutes } from "../../authSessionRoutes";
import { registerVipCoreRoutes } from "../vipCoreRoutes";
import { registerVipReceiptRoutes } from "../vipReceiptRoutes";
import { registerVipSellerRoutes } from "../vipSellerRoutes";
import { assertTemporaryPostgresProcessIdentity } from "../qaLocalPostgresIdentity";
import {createQaPostgresSessionStore} from "../qaPostgresSessionStore";
import { pool } from "./localDatabaseStorageShim";
import {
  removePrivateReceipt,
  savePrivateReceipt,
} from "./privateFileStorageShim";

const runId = process.env.VIP_TEST_RUN_ID ?? "";
const expectedPort = Number(process.env.PGPORT);
const cookiePolicy = { secure: false, sameSite: "lax" as const };
const password = "Synthetic-Local-Password-Only";
const otp = "246810";
const otpByPhone = new Map<string, string>();
const savedReceiptKeys: string[] = [];

let storage: DatabaseStorage;
let allowPhoneOtpAttempt: PhoneOtpAttemptLimiter;
let baseUrl = "";
let server: ReturnType<express.Express["listen"]> | undefined;
let buyer: any;
let otherBuyer: any;
let seller: any;
let otherSeller: any;
let admin: any;
let finance: any;
let employee: any;
let unitId = 0;
let installmentId = 0;
let receiptId = 0;
let financeSelfReceiptId = 0;
let receiptBytes = Buffer.from("%PDF-1.4\nKinglike synthetic receipt fixture\n%%EOF\n");

function syntheticEmail(name: string): string {
  return `${runId}_${name}@example.test`;
}

async function createUser(
  name: string,
  options: { role?: string; admin?: boolean; phone?: string } = {},
) {
  return storage.createUser({
    username: `${runId}_${name}`,
    password: await bcrypt.hash(password, 4),
    email: syntheticEmail(name),
    phoneNumber: options.phone,
    role: options.role ?? "user",
    isAdmin: options.admin ?? false,
    isVerified: true,
    isActive: true,
  });
}

type HttpResult = {
  status: number;
  body: any;
  cookie: string | undefined;
};

function browser() {
  let cookie: string | undefined;
  return {
    get cookie() {
      return cookie;
    },
    async request(
      path: string,
      options: {
        method?: string;
        body?: unknown;
        headers?: Record<string, string>;
        cookieOverride?: string;
        omitCookie?: boolean;
      } = {},
    ): Promise<HttpResult> {
      const headers: Record<string, string> = { ...options.headers };
      const activeCookie = options.cookieOverride ?? cookie;
      if (activeCookie && !options.omitCookie) headers.Cookie = activeCookie;
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        redirect: "manual",
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") ?? "";
      let body: unknown = bytes;
      if (contentType.includes("application/json")) {
        body = JSON.parse(bytes.toString("utf8") || "{}");
      }
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return { status: response.status, body, cookie };
    },
  };
}

async function login(user: any, client = browser()) {
  const result = await client.request("/api/auth/login", {
    method: "POST",
    body: { username: user.username, password },
  });
  return { client, result };
}

async function issueOtp(phoneNumber: string, client = browser()) {
  const result = await client.request("/api/auth/send-verification", {
    method: "POST",
    body: { phoneNumber },
  });
  return { client, result };
}

async function seedVipData() {
  const project = await pool.query(
    "INSERT INTO vip_projects(name,developer_name) VALUES($1,$2) RETURNING id",
    [`${runId} synthetic project`, "Synthetic QA only"],
  );
  const projectId = Number(project.rows[0].id);
  const unit = await pool.query(
    "INSERT INTO vip_units(project_id,unit_number,floor_number) VALUES($1,$2,$3) RETURNING id",
    [projectId, `${runId}_101`, 1],
  );
  unitId = Number(unit.rows[0].id);
  await pool.query(
    "INSERT INTO vip_unit_access(unit_id,user_id,access_role) VALUES($1,$2,'owner'),($1,$3,'seller')",
    [unitId, buyer.id, seller.id],
  );
  const installment = await pool.query(
    "INSERT INTO vip_installments(unit_id,sequence_number,due_date,amount,currency) " +
      "VALUES($1,1,CURRENT_DATE,100.00,'USD') RETURNING id",
    [unitId],
  );
  installmentId = Number(installment.rows[0].id);

  const receiptKey = await savePrivateReceipt(receiptBytes, "application/pdf", "pdf");
  savedReceiptKeys.push(receiptKey);
  const receipt = await pool.query(
    "INSERT INTO vip_receipts(installment_id,object_path,file_name,mime_type,size_bytes,uploaded_by,upload_source) " +
      "VALUES($1,$2,$3,'application/pdf',$4,$5,'client') RETURNING id",
    [installmentId, receiptKey, "synthetic-receipt.pdf", receiptBytes.length, buyer.id],
  );
  receiptId = Number(receipt.rows[0].id);

  const selfKey = await savePrivateReceipt(receiptBytes, "application/pdf", "pdf");
  savedReceiptKeys.push(selfKey);
  const selfReceipt = await pool.query(
    "INSERT INTO vip_receipts(installment_id,object_path,file_name,mime_type,size_bytes,uploaded_by,upload_source) " +
      "VALUES($1,$2,$3,'application/pdf',$4,$5,'client') RETURNING id",
    [installmentId, selfKey, "synthetic-self-receipt.pdf", receiptBytes.length, finance.id],
  );
  financeSelfReceiptId = Number(selfReceipt.rows[0].id);
}

before(async () => {
  assert.match(runId, /^[A-Za-z0-9_-]{4,32}$/);
  assertTemporaryPostgresProcessIdentity(
    process.env.VIP_TEST_EXPECTED_DATA_DIRECTORY,
    expectedPort,
  );

  // This read-only identity query is the first SQL. No DDL or fixture writes
  // are allowed until the database, role, address, and port are confirmed.
  const identity = await pool.query(
    "SELECT current_database() AS database,current_user AS role," +
      "host(inet_server_addr()) AS address,inet_server_port() AS port",
  );
  assert.deepEqual(identity.rows[0], {
    database: "vipdb",
    role: `vipqa_${runId}`,
    address: "127.0.0.1",
    port: expectedPort,
  });
  const existingTables = await pool.query(
    "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'",
  );
  assert.equal(existingTables.rows[0].count, 0, "fresh temporary database must start empty");

  await pool.query(await readFile("server/vip/migrations/000_qa_users_only.sql", "utf8"));
  await pool.query(await readFile("server/vip/migrations/001_vip_foundation.sql", "utf8"));
  await pool.query(await readFile("server/vip/migrations/003_qa_sessions.sql", "utf8"));
  await pool.query(
    "CREATE TABLE verification_codes (" +
      "id SERIAL PRIMARY KEY,phone_number TEXT NOT NULL,code TEXT NOT NULL," +
      "expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,verified BOOLEAN NOT NULL DEFAULT FALSE," +
      "created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW())",
  );
  await pool.query(
    await readFile("server/migrations/2026-11-27-auth-otp-rate-limit.sql", "utf8"),
  );

  storage = new DatabaseStorage();
  const consumeOtpRateLimit = storage.consumeOtpRateLimit.bind(storage);
  allowPhoneOtpAttempt = createSharedPhoneOtpAttemptLimiter(
    consumeOtpRateLimit,
    { maxPerPhone: 500, maxPerIp: 500, windowMs: 15 * 60 * 1000 },
  );
  buyer = await createUser("buyer", { phone: "+12025550101" });
  otherBuyer = await createUser("other_buyer");
  seller = await createUser("seller", { role: "sales_agent" });
  otherSeller = await createUser("other_seller", { role: "sales_agent" });
  admin = await createUser("admin", { role: "admin", admin: true });
  finance = await createUser("finance", { role: "finance" });
  employee = await createUser("employee", { role: "crm_employee" });
  await seedVipData();

  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(session({
    store: createQaPostgresSessionStore(pool),
    secret: "synthetic-local-session-secret-not-for-deployment",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: "lax", maxAge: 60_000 },
  }));
  app.get("/__test/session", (req, res) => {
    (req.session as any).marker = "synthetic";
    res.json({ ready: true });
  });
  app.post(
    "/api/auth/send-verification",
    createPhoneOtpIssueHandler({
      storage,
        authorizeSend: async (req, phoneNumber) => {
          const result = await checkPhoneOtpIssueRateLimit(
            consumeOtpRateLimit,
            phoneNumber,
            req.ip || req.socket.remoteAddress || "",
            {
              maxPerPhone: 500,
              phoneWindowMs: 15 * 60 * 1000,
              maxPerIp: 500,
              ipWindowMs: 10 * 60 * 1000,
              maxPerIpPerHour: 500,
              hourlyWindowMs: 60 * 60 * 1000,
            },
          );
          return result === "allowed"
            ? { allowed: true }
            : { allowed: false, status: 429, body: { code: "RATE_LIMITED" } };
        },
      deliverCode: async (phoneNumber, code) => {
        otpByPhone.set(phoneNumber, code);
      },
      generateCode: () => otp,
      now: () => Date.now(),
      onFailure: () => undefined,
    }),
  );
  app.post(
    "/api/auth/verify-code",
    createPhoneOtpVerificationHandler({
      storage,
      allowPhoneOtpAttempt,
    }),
  );
  registerAuthSessionRoutes(app, {
    storage,
    comparePassword: (plainText, hash) => bcrypt.compare(plainText, hash),
    allowPhoneOtpAttempt,
    cookiePolicy,
  });
  app.post(
    "/api/auth/register",
    createRegisterHandler({
      storage,
      emailOtpStore: new Map(),
      hashPassword: (plainText) => bcrypt.hash(plainText, 4),
      sendWelcomeEmail: async () => undefined,
      sendWelcomeWhatsApp: async () => undefined,
      logError: () => undefined,
    }),
  );
  const vipGuards = registerVipCoreRoutes(app);
  registerVipReceiptRoutes(
    app,
    vipGuards.enabled,
    vipGuards.requireSession,
    vipGuards.requireAdmin,
  );
  registerVipSellerRoutes(
    app,
    vipGuards.enabled,
    vipGuards.requireSession,
    vipGuards.requireAdmin,
  );

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  assert.equal(address.address, "127.0.0.1");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => error ? reject(error) : resolve()),
    );
  }
  for (const key of savedReceiptKeys) {
    await removePrivateReceipt(key);
  }
  await pool.end();
});

test("actual database-backed auth, OTP and VIP permissions", async (t) => {
  await t.test("shared OTP counters are atomic under concurrent requests and expire", async () => {
    const scope = "integration-race";
    const identifier = `${runId}_concurrent`;
    const results = await Promise.all(
      Array.from({ length: 32 }, () =>
        storage.consumeOtpRateLimit(scope, identifier, 7, 60_000),
      ),
    );
    assert.equal(results.filter((result) => result.allowed).length, 7);
    assert.equal(Math.max(...results.map((result) => result.attemptCount)), 8,
      "blocked counter saturates at the threshold plus one");

    const expiryIdentifier = `${runId}_expiry`;
    assert.equal(
      (await storage.consumeOtpRateLimit("integration-expiry", expiryIdentifier, 1, 60)).allowed,
      true,
    );
    assert.equal(
      (await storage.consumeOtpRateLimit("integration-expiry", expiryIdentifier, 1, 60)).allowed,
      false,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      (await storage.consumeOtpRateLimit("integration-expiry", expiryIdentifier, 1, 60)).allowed,
      true,
      "expired bucket starts a new window using PostgreSQL time",
    );

    const columns = await pool.query(
      "SELECT column_name FROM information_schema.columns " +
        "WHERE table_schema='public' AND table_name='auth_otp_rate_limits' ORDER BY column_name",
    );
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      ["attempt_count", "bucket_hash", "expires_at", "window_started_at"],
      "the shared limiter must not persist raw phone or IP identifiers",
    );
  });

  await t.test("phone OTP send policy returns shared phone, IP, and hourly decisions", async () => {
    const phone = `${runId}_rate_phone`;
    const ip = `${runId}_rate_ip`;
    const policy = {
      maxPerPhone: 2,
      phoneWindowMs: 60_000,
      maxPerIp: 4,
      ipWindowMs: 60_000,
      maxPerIpPerHour: 10,
      hourlyWindowMs: 60 * 60 * 1000,
    };
    assert.equal(
      await checkPhoneOtpIssueRateLimit(storage.consumeOtpRateLimit.bind(storage), phone, ip, policy),
      "allowed",
    );
    assert.equal(
      await checkPhoneOtpIssueRateLimit(storage.consumeOtpRateLimit.bind(storage), phone, ip, policy),
      "allowed",
    );
    assert.equal(
      await checkPhoneOtpIssueRateLimit(storage.consumeOtpRateLimit.bind(storage), phone, ip, policy),
      "phone_rate_limited",
    );
    assert.equal(
      await checkPhoneOtpIssueRateLimit(
        storage.consumeOtpRateLimit.bind(storage),
        `${phone}_different`,
        `${ip}_hourly`,
        { ...policy, maxPerIpPerHour: 1 },
      ),
      "allowed",
    );
    assert.equal(
      await checkPhoneOtpIssueRateLimit(
        storage.consumeOtpRateLimit.bind(storage),
        `${phone}_different`,
        `${ip}_hourly`,
        { ...policy, maxPerIpPerHour: 1 },
      ),
      "ip_blocked",
    );

    const sharedIp = `${runId}_crossflow_ip`;
    const sharedPolicy = { ...policy, maxPerIpPerHour: 1 };
    assert.equal(
      await checkPhoneOtpIssueRateLimit(
        storage.consumeOtpRateLimit.bind(storage),
        `${phone}_crossflow`,
        sharedIp,
        sharedPolicy,
      ),
      "allowed",
    );
    assert.equal(
      await checkSharedOtpIpRateLimit(
        storage.consumeOtpRateLimit.bind(storage),
        sharedIp,
        sharedPolicy,
      ),
      "blocked",
      "email and password-recovery OTP issuance share the same database IP bucket",
    );

    const recentLimitedIp = `${runId}_recent_limited_ip`;
    const recentLimitPolicy = { ...policy, maxPerIp: 1, maxPerIpPerHour: 100 };
    assert.equal(
      await checkPhoneOtpIssueRateLimit(
        storage.consumeOtpRateLimit.bind(storage),
        `${phone}_recent_first`,
        recentLimitedIp,
        recentLimitPolicy,
      ),
      "allowed",
    );
    assert.equal(
      await checkPhoneOtpIssueRateLimit(
        storage.consumeOtpRateLimit.bind(storage),
        `${phone}_recent_second`,
        recentLimitedIp,
        recentLimitPolicy,
      ),
      "ip_rate_limited",
    );
  });

  await t.test("fresh OTP registration consumes proof, rotates session, and stores bcrypt hash", async () => {
    const client = browser();
    const anonymous = await client.request("/__test/session");
    assert.equal(anonymous.status, 200);
    const oldCookie = client.cookie;

    const phone = "+12025550177";
    const sent = await issueOtp(phone, client);
    assert.equal(sent.result.status, 200);
    assert.equal((sent.result.body as any).success, true);
    const code = otpByPhone.get(phone);
    assert.equal(code, otp, "synthetic delivery adapter captured the issued code");

    const verified = await client.request("/api/auth/verify-code", {
      method: "POST",
      body: { phoneNumber: phone, code },
    });
    assert.equal(verified.status, 200);

    const registration = await client.request("/api/auth/register", {
      method: "POST",
      body: {
        username: `${runId}_registered`,
        password,
        phoneNumber: phone,
        authMethod: "phone",
      },
    });
    assert.equal(registration.status, 201);
    assert.notEqual(client.cookie, oldCookie, "registration must rotate the session ID");
    assert.equal(
      (await client.request("/api/auth/me", { cookieOverride: oldCookie })).status,
      401,
      "pre-registration session must no longer authenticate",
    );
    assert.equal((await client.request("/api/auth/me")).status, 200);

    const created = await storage.getUserByUsername(`${runId}_registered`);
    assert.ok(created?.password?.startsWith("$2"));
    assert.equal(await bcrypt.compare(password, created!.password!), true);
    assert.equal(
      (await pool.query("SELECT id FROM verification_codes WHERE phone_number=$1", [phone])).rowCount,
      0,
      "registration must atomically consume the verified OTP row",
    );

    const passwordLogin = await login(created);
    assert.equal(passwordLogin.result.status, 200);
    assert.equal((await passwordLogin.client.request("/api/auth/me")).status, 200);
  });

  await t.test("expired and cross-session OTP proof fails closed", async () => {
    const phone = "+12025550178";
    const expiredClient = browser();
    const issue = await issueOtp(phone, expiredClient);
    assert.equal(issue.result.status, 200);
    const expiredCode = otpByPhone.get(phone)!;
    const expiredAt = await pool.query(
      "UPDATE verification_codes SET expires_at=NOW()-INTERVAL '1 minute' WHERE phone_number=$1",
      [phone],
    );
    assert.equal(expiredAt.rowCount, 1);
    const expiredVerify = await expiredClient.request("/api/auth/verify-code", {
      method: "POST",
      body: { phoneNumber: phone, code: expiredCode },
    });
    assert.equal(expiredVerify.status, 400, "the database rejects an expired verification code");

    const issuedClient = browser();
    const livePhone = "+12025550179";
    const liveUser = await createUser("cross_session", { phone: livePhone });
    assert.equal((await issueOtp(livePhone, issuedClient)).result.status, 200);
    const liveCode = otpByPhone.get(livePhone)!;
    const stranger = browser();
    const crossSession = await stranger.request("/api/auth/login", {
      method: "POST",
      body: { authMethod: "phone", phoneNumber: livePhone, code: liveCode },
    });
    assert.equal(crossSession.status, 401);
    const rightful = await issuedClient.request("/api/auth/login", {
      method: "POST",
      body: { authMethod: "phone", phoneNumber: livePhone, code: liveCode },
    });
    assert.equal(rightful.status, 200);
    assert.equal((rightful.body as any).id, liveUser.id);
  });

  await t.test("OTP login is database-atomic under concurrent sessions", async () => {
    const phone = "+12025550101";
    const first = browser();
    const second = browser();
    assert.equal((await issueOtp(phone, first)).result.status, 200);
    assert.equal((await issueOtp(phone, second)).result.status, 200);
    const code = otpByPhone.get(phone)!;
    const results = await Promise.all([
      first.request("/api/auth/login", {
        method: "POST",
        body: { authMethod: "phone", phoneNumber: phone, code },
      }),
      second.request("/api/auth/login", {
        method: "POST",
        body: { authMethod: "phone", phoneNumber: phone, code },
      }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 401]);
    const winner = results.find((result) => result.status === 200)!;
    assert.equal((winner.body as any).id, buyer.id);
  });

  await t.test("OTP proof is bound to the account that received it", async () => {
    const phone = "+12025550102";
    const original = await createUser("phone_original", { phone });
    const client = browser();
    assert.equal((await issueOtp(phone, client)).result.status, 200);
    const code = otpByPhone.get(phone)!;
    await pool.query("UPDATE users SET phone_number=NULL WHERE id=$1", [original.id]);
    await createUser("phone_reassigned", { phone });
    const attempt = await client.request("/api/auth/login", {
      method: "POST",
      body: { authMethod: "phone", phoneNumber: phone, code },
    });
    assert.equal(attempt.status, 401);
    assert.equal((await client.request("/api/auth/me")).status, 401);
  });

  await t.test("buyer and seller data is limited to live unit assignments", async () => {
    const buyerSession = await login(buyer);
    assert.equal(buyerSession.result.status, 200);
    const own = await buyerSession.client.request("/api/vip/me");
    assert.equal(own.status, 200);
    assert.equal((own.body as any).units.length, 1);
    const otherBuyerSession = await login(otherBuyer);
    assert.equal(((await otherBuyerSession.client.request("/api/vip/me")).body as any).units.length, 0);

    const sellerSession = await login(seller);
    const sellerUnits = await sellerSession.client.request("/api/vip/seller/units");
    assert.equal(sellerUnits.status, 200);
    assert.equal((sellerUnits.body as any).units.length, 1);
    const otherSellerSession = await login(otherSeller);
    assert.equal(
      ((await otherSellerSession.client.request("/api/vip/seller/units")).body as any).units.length,
      0,
    );
    assert.equal(
      (await otherSellerSession.client.request(`/api/vip/seller/units/${unitId}`)).status,
      404,
    );
  });

  await t.test("receipt downloads honor owner, assigned seller, admin, finance and pending-only rules", async () => {
    const buyerSession = await login(buyer);
    const otherBuyerSession = await login(otherBuyer);
    const sellerSession = await login(seller);
    const otherSellerSession = await login(otherSeller);
    const adminSession = await login(admin);
    const financeSession = await login(finance);
    const employeeSession = await login(employee);

    for (const authorized of [buyerSession.client, sellerSession.client, adminSession.client]) {
      const response = await authorized.request(`/api/vip/receipts/${receiptId}/download`);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, receiptBytes);
    }
    assert.equal(
      (await otherBuyerSession.client.request(`/api/vip/receipts/${receiptId}/download`)).status,
      404,
    );
    assert.equal(
      (await otherSellerSession.client.request(`/api/vip/receipts/${receiptId}/download`)).status,
      404,
    );
    assert.equal(
      (await financeSession.client.request(`/api/vip/receipts/${receiptId}/download`)).status,
      404,
      "finance has no file access before an explicit finance grant",
    );
    assert.equal(
      (await employeeSession.client.request(`/api/vip/receipts/${receiptId}/download`)).status,
      404,
    );
  });

  await t.test("admin grants narrow finance permission; employee/admin-only controls remain separate", async () => {
    const adminSession = await login(admin);
    const financeSession = await login(finance);
    const employeeSession = await login(employee);
    const buyerSession = await login(buyer);

    assert.equal((await adminSession.client.request("/api/admin/vip/overview")).status, 200);
    assert.equal((await adminSession.client.request("/api/admin/vip/finance/receipts")).status, 403);
    assert.equal(
      (await adminSession.client.request("/api/admin/vip/finance-permissions", {
        method: "POST",
        headers: { Origin: baseUrl },
        body: { email: finance.email },
      })).status,
      200,
    );
    assert.equal((await financeSession.client.request("/api/admin/vip/finance/me")).status, 200);
    const queue = await financeSession.client.request("/api/admin/vip/finance/receipts");
    assert.equal(queue.status, 200);
    assert.equal((queue.body as any).receipts.length, 1);
    assert.equal((queue.body as any).receipts[0].id, String(receiptId));
    assert.equal((await financeSession.client.request("/api/admin/vip/overview")).status, 403);
    assert.equal((await employeeSession.client.request("/api/admin/vip/finance/receipts")).status, 403);
    assert.equal((await buyerSession.client.request("/api/admin/vip/finance/receipts")).status, 403);

    const pendingDownload = await financeSession.client.request(
      `/api/vip/receipts/${receiptId}/download`,
    );
    assert.equal(pendingDownload.status, 200);
    assert.deepEqual(pendingDownload.body, receiptBytes);
    assert.equal(
      (await financeSession.client.request(`/api/vip/receipts/${financeSelfReceiptId}/download`)).status,
      404,
      "a reviewer cannot download their own submitted receipt",
    );
    assert.equal(
      (await financeSession.client.request("/api/admin/vip/receipts")).status,
      403,
      "finance permission does not grant admin receipt history",
    );
    assert.equal(
      (await financeSession.client.request("/api/admin/vip/finance-permissions", {
        method: "POST",
        headers: { Origin: baseUrl },
        body: { email: employee.email },
      })).status,
      403,
      "finance permission cannot grant admin-managed permissions",
    );
  });

  await t.test("only a delegated finance reviewer can approve once; approval creates the posting", async () => {
    const financeSession = await login(finance);
    const employeeSession = await login(employee);
    const buyerSession = await login(buyer);
    const reviewPath = `/api/admin/vip/receipts/${receiptId}/review`;
    const reviewOptions = {
      method: "POST",
      headers: { Origin: baseUrl },
      body: { decision: "approve", verifiedAmount: "60.00" },
    };
    assert.equal((await employeeSession.client.request(reviewPath, reviewOptions)).status, 403);
    assert.equal((await buyerSession.client.request(reviewPath, reviewOptions)).status, 403);
    assert.equal(
      (await financeSession.client.request(
        `/api/admin/vip/receipts/${financeSelfReceiptId}/review`,
        reviewOptions,
      )).status,
      403,
      "self-review must be denied",
    );
    const approved = await financeSession.client.request(reviewPath, reviewOptions);
    assert.equal(approved.status, 200);
    assert.equal((approved.body as any).status, "approved");
    assert.equal((await financeSession.client.request(reviewPath, reviewOptions)).status, 409);

    const postings = await pool.query(
      "SELECT amount::text AS amount,verified_by FROM vip_payment_postings WHERE receipt_id=$1",
      [receiptId],
    );
    assert.equal(postings.rowCount, 1);
    assert.equal(postings.rows[0].amount, "60.00");
    assert.equal(Number(postings.rows[0].verified_by), finance.id);
    assert.equal(
      (await financeSession.client.request(`/api/vip/receipts/${receiptId}/download`)).status,
      404,
      "finance-only file access ends after review",
    );
    assert.equal(
      (await (await login(buyer)).client.request(`/api/vip/receipts/${receiptId}/download`)).status,
      200,
      "the owner keeps access to their own receipt history",
    );
  });

  await t.test("finance revocation is immediate and stale admin sessions lose admin access", async () => {
    const adminSession = await login(admin);
    const financeSession = await login(finance);
    assert.equal(
      (await adminSession.client.request("/api/admin/vip/finance-permissions", {
        method: "DELETE",
        headers: { Origin: baseUrl },
        body: { email: finance.email },
      })).status,
      200,
    );
    assert.equal((await financeSession.client.request("/api/admin/vip/finance/receipts")).status, 403);

    assert.equal((await adminSession.client.request("/api/admin/vip/overview")).status, 200);
    await pool.query("UPDATE users SET is_admin=FALSE,role='user' WHERE id=$1", [admin.id]);
    assert.equal(
      (await adminSession.client.request("/api/admin/vip/overview")).status,
      403,
      "VIP administration must use the current database role, not the session snapshot",
    );
  });
});

test("PostgreSQL session cookie survives an app listener restart in a separate process", async () => {
  const signedIn = await login(buyer);
  assert.equal(signedIn.result.status, 200);
  const cookie = signedIn.client.cookie;
  assert.ok(cookie?.startsWith("connect.sid="));

  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve());
      server!.closeAllConnections();
    });
    server = undefined;
  }

  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    NODE_ENV: "test",
    VIP_TEST_SESSION_RESTART: "read",
    VIP_TEST_DATABASE_URL: process.env.VIP_TEST_DATABASE_URL,
    VIP_TEST_EXPECTED_DATA_DIRECTORY: process.env.VIP_TEST_EXPECTED_DATA_DIRECTORY,
    VIP_TEST_RUN_ID: runId,
    VIP_TEST_SESSION_SECRET: "synthetic-local-session-secret-not-for-deployment",
    VIP_TEST_SESSION_COOKIE: cookie,
    PGPORT: String(expectedPort),
  };
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/vip/tests/pgSessionRestartWorker.mjs"],
    { cwd: process.cwd(), env: childEnv, stdio: ["ignore", "pipe", "ignore"] },
  );
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(exitCode, 0, "fresh worker must load the persisted PostgreSQL session");
  assert.equal(output.trim(), JSON.stringify({ session: "restored", userId: buyer.id }));
});
