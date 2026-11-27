import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import connectPg from "connect-pg-simple";
import express from "express";
import session from "express-session";
import type { AddressInfo } from "node:net";
import { pool } from "./localDbShim";
import { assertTemporaryPostgresProcessIdentity } from "../qaLocalPostgresIdentity";
import { registerVipReceiptRoutes } from "../vipReceiptRoutes";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n");
const runId = `receipt_${process.pid}_${Date.now()}`;
const storageDir = process.env.VIP_TEST_STORAGE_DIR;
const users: Record<string, number> = {};
let baseUrl = "";
let server: ReturnType<express.Express["listen"]> | undefined;
let unitId = 0;
let installmentId = 0;
let receiptId = 0;
let adminReceiptId = 0;
let ownerCookie = "";
let otherBuyerCookie = "";
let assignedSellerCookie = "";
let unassignedSellerCookie = "";
let managerCookie = "";
let financeCookie = "";

async function createUser(
  label: string,
  role: string,
  isAdmin = false,
): Promise<number> {
  const username = `vip_${runId}_${label}`;
  const result = await pool.query(
    "INSERT INTO users(username,email,role,is_verified,is_active,is_admin) " +
      "VALUES($1,$2,$3,TRUE,TRUE,$4) RETURNING id",
    [username, `${username}@fixture.example.test`, role, isAdmin],
  );
  return Number(result.rows[0].id);
}

async function login(userId: number): Promise<string> {
  const response = await fetch(`${baseUrl}/__qa/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("connect.sid="));
  return cookie;
}

async function api(
  cookie: string | null,
  urlPath: string,
  method = "GET",
  body?: unknown,
) {
  const headers: Record<string, string> = { Origin: baseUrl };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(baseUrl + urlPath, {
    method,
    headers,
    redirect: "manual",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, text: await response.text() };
}

async function upload(cookie: string | null, source = "client") {
  const form = new FormData();
  form.set("receipt", new Blob([PDF], { type: "application/pdf" }), "synthetic-receipt.pdf");
  form.set("source", source);
  const headers: Record<string, string> = { Origin: baseUrl };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(
    `${baseUrl}/api/vip/installments/${installmentId}/receipts`,
    { method: "POST", headers, body: form, redirect: "manual" },
  );
  return { response, text: await response.text() };
}

async function countFiles(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false, "temporary receipt storage must not contain symlinks");
    const item = path.join(dir, entry.name);
    total += entry.isDirectory() ? await countFiles(item) : 1;
  }
  return total;
}

before(async () => {
  assert.ok(storageDir, "temporary storage directory must be supplied");
  assertTemporaryPostgresProcessIdentity(
    process.env.VIP_TEST_EXPECTED_DATA_DIRECTORY,
    Number(process.env.PGPORT),
  );
  const target = await pool.query(
    "SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port",
  );
  assert.equal(target.rows[0].db, "vipdb");
  assert.ok(["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(target.rows[0].host));
  assert.equal(Number(target.rows[0].port), Number(process.env.PGPORT));
  const publicTables = await pool.query(
    "SELECT table_name FROM information_schema.tables " +
      "WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
  );
  assert.ok(publicTables.rows.some((row) => row.table_name === "users"));
  assert.ok(publicTables.rows.some((row) => row.table_name === "vip_receipts"));
  assert.ok(
    publicTables.rows.every(
      (row) => row.table_name === "users" || row.table_name.startsWith("vip_"),
    ),
    "test database must contain only synthetic users and VIP tables",
  );

  users.owner = await createUser("owner", "user");
  users.otherBuyer = await createUser("other", "user");
  users.assignedSeller = await createUser("assigned_seller", "sub_agent");
  users.unassignedSeller = await createUser("unassigned_seller", "sub_agent");
  users.manager = await createUser("manager", "admin", true);
  users.finance = await createUser("finance", "crm_employee");

  const project = Number(
    (
      await pool.query(
        "INSERT INTO vip_projects(name) VALUES($1) RETURNING id",
        [`Synthetic receipt QA ${runId}`],
      )
    ).rows[0].id,
  );
  unitId = Number(
    (
      await pool.query(
        "INSERT INTO vip_units(project_id,unit_number) VALUES($1,$2) RETURNING id",
        [project, `UNIT-${runId}`],
      )
    ).rows[0].id,
  );
  await pool.query(
    "INSERT INTO vip_unit_access(unit_id,user_id,access_role) " +
      "VALUES($1,$2,'owner'),($1,$3,'seller')",
    [unitId, users.owner, users.assignedSeller],
  );
  installmentId = Number(
    (
      await pool.query(
        "INSERT INTO vip_installments(unit_id,sequence_number,due_date,amount,currency) " +
          "VALUES($1,1,'2027-07-01',120,'USD') RETURNING id",
        [unitId],
      )
    ).rows[0].id,
  );

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  const PgSessionStore = connectPg(session);
  app.use(
    session({
      store: new PgSessionStore({ pool, createTableIfMissing: true }),
      secret: "synthetic-only-vip-receipt-session-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 60_000 },
    }),
  );
  app.post("/__qa/login", (req, res) => {
    const userId = Number(req.body?.userId);
    if (!Object.values(users).includes(userId)) {
      return res.status(403).json({ error: "Not a synthetic QA account" });
    }
    req.session.userId = userId;
    return res.json({ loggedIn: true });
  });
  const authenticated: express.RequestHandler = async (req, res, next) => {
    const userId = Number(req.session?.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "Authentication required" });
    }
    try {
      const user = await pool.query(
        "SELECT id,is_admin,role,is_active,is_verified,email FROM users " +
          "WHERE id=$1 AND is_active=TRUE AND is_verified=TRUE LIMIT 1",
        [userId],
      );
      if (user.rowCount !== 1) {
        return res.status(403).json({ error: "Account not authorized" });
      }
      res.locals.vipUser = {
        id: Number(user.rows[0].id),
        isAdmin: user.rows[0].is_admin === true,
      };
      next();
    } catch {
      return res.status(503).json({ error: "Test authentication unavailable" });
    }
  };
  const enabled: express.RequestHandler = (_req, _res, next) => next();
  const adminOnly: express.RequestHandler = (_req, res, next) => {
    if (!res.locals.vipUser?.isAdmin) {
      return res.status(403).json({ error: "Admin required" });
    }
    next();
  };
  registerVipReceiptRoutes(app, enabled, authenticated, adminOnly);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerCookie = await login(users.owner);
  otherBuyerCookie = await login(users.otherBuyer);
  assignedSellerCookie = await login(users.assignedSeller);
  unassignedSellerCookie = await login(users.unassignedSeller);
  managerCookie = await login(users.manager);
  financeCookie = await login(users.finance);
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error ? reject(error) : resolve()));
      server!.closeAllConnections();
    });
  }
  await pool.end();
});

test("anonymous requests cannot upload or download receipts", async () => {
  const noSessionUpload = await upload(null);
  assert.equal(noSessionUpload.response.status, 401);
  const noSessionDownload = await api(null, "/api/vip/receipts/1/download");
  assert.equal(noSessionDownload.response.status, 401);
});

test("owner upload stores only a pending receipt and creates no payment posting", async () => {
  const result = await upload(ownerCookie);
  assert.equal(result.response.status, 201, result.text.slice(0, 200));
  const payload = JSON.parse(result.text);
  receiptId = Number(payload.receipt.id);
  assert.equal(payload.receipt.review_status, "pending");

  const saved = await pool.query(
    "SELECT object_path,review_status,uploaded_by FROM vip_receipts WHERE id=$1",
    [receiptId],
  );
  assert.equal(saved.rows[0].review_status, "pending");
  assert.equal(Number(saved.rows[0].uploaded_by), users.owner);
  const postings = await pool.query(
    "SELECT COUNT(*)::int AS count FROM vip_payment_postings WHERE receipt_id=$1",
    [receiptId],
  );
  assert.equal(postings.rows[0].count, 0, "upload must not mark payment as verified");

  const receiptFile = path.resolve(storageDir!, saved.rows[0].object_path);
  const info = await stat(receiptFile);
  assert.ok(info.isFile());
  assert.equal(info.mode & 0o777, 0o600);
  assert.ok((await readFile(receiptFile)).equals(PDF));
});

test("other buyers and unauthenticated clients cannot list or download the file", async () => {
  const list = await api(otherBuyerCookie, `/api/vip/units/${unitId}/receipts`);
  assert.equal(list.response.status, 404);
  const download = await api(
    otherBuyerCookie,
    `/api/vip/receipts/${receiptId}/download`,
  );
  assert.equal(download.response.status, 404);
  assert.equal(download.text.includes("%PDF-1.7"), false);
  const anonymous = await api(null, `/api/vip/receipts/${receiptId}/download`);
  assert.equal(anonymous.response.status, 401);
});

test("only the assigned active seller can download; sellers cannot upload as owners", async () => {
  const assigned = await api(
    assignedSellerCookie,
    `/api/vip/receipts/${receiptId}/download`,
  );
  assert.equal(assigned.response.status, 200);
  assert.ok(Buffer.from(assigned.text).equals(PDF));
  assert.equal(assigned.response.headers.get("cache-control"), "private, no-store");
  assert.equal(assigned.response.headers.get("x-content-type-options"), "nosniff");

  const sellerUpload = await upload(assignedSellerCookie);
  assert.equal(sellerUpload.response.status, 404);
  await pool.query("UPDATE users SET role='user' WHERE id=$1", [users.assignedSeller]);
  const revokedSeller = await api(
    assignedSellerCookie,
    `/api/vip/receipts/${receiptId}/download`,
  );
  assert.equal(revokedSeller.response.status, 404);
  assert.equal(revokedSeller.text.includes("%PDF-1.7"), false);
  const unassigned = await api(
    unassignedSellerCookie,
    `/api/vip/receipts/${receiptId}/download`,
  );
  assert.equal(unassigned.response.status, 404);
  assert.equal(unassigned.text.includes("%PDF-1.7"), false);
});

test("manager can access and upload, but upload remains pending without payment posting", async () => {
  const download = await api(managerCookie, `/api/vip/receipts/${receiptId}/download`);
  assert.equal(download.response.status, 200);
  assert.ok(Buffer.from(download.text).equals(PDF));
  const managerUpload = await upload(managerCookie, "admin");
  assert.equal(managerUpload.response.status, 201);
  const result = JSON.parse(managerUpload.text);
  adminReceiptId = Number(result.receipt.id);
  const state = await pool.query(
    "SELECT r.review_status,r.upload_source," +
      "(SELECT COUNT(*)::int FROM vip_payment_postings p WHERE p.receipt_id=r.id) AS postings " +
      "FROM vip_receipts r WHERE r.id=$1",
    [adminReceiptId],
  );
  assert.equal(state.rows[0].review_status, "pending");
  assert.equal(state.rows[0].upload_source, "admin");
  assert.equal(state.rows[0].postings, 0);
});

test("encoded receipt IDs and persisted traversal keys fail closed", async () => {
  const encoded = await api(
    ownerCookie,
    `/api/vip/receipts/${encodeURIComponent(`../${receiptId}`)}/download`,
  );
  assert.equal(encoded.response.status, 404);

  const canaryPath = path.join(path.dirname(storageDir!), `vip-receipt-canary-${process.pid}`);
  const canary = Buffer.from("synthetic-outside-storage-canary");
  await writeFile(canaryPath, canary, { flag: "wx", mode: 0o600 });
  const original = await pool.query(
    "SELECT object_path FROM vip_receipts WHERE id=$1",
    [receiptId],
  );
  try {
    await pool.query(
      "UPDATE vip_receipts SET object_path=$2 WHERE id=$1",
      [receiptId, `../${path.basename(canaryPath)}`],
    );
    const rejected = await api(
      ownerCookie,
      `/api/vip/receipts/${receiptId}/download`,
    );
    assert.equal(rejected.response.status, 503);
    assert.equal(rejected.text.includes(canary.toString()), false);
    assert.ok((await readFile(canaryPath)).equals(canary));
  } finally {
    await pool.query(
      "UPDATE vip_receipts SET object_path=$2 WHERE id=$1",
      [receiptId, original.rows[0].object_path],
    );
    await unlink(canaryPath).catch(() => {});
  }
});

test("finance approval is explicit, role-bound, and cannot self-approve", async () => {
  const ownerQueue = await api(ownerCookie, "/api/admin/vip/finance/receipts");
  assert.equal(ownerQueue.response.status, 403);
  const ungrantedAdminQueue = await api(managerCookie, "/api/admin/vip/finance/receipts");
  assert.equal(ungrantedAdminQueue.response.status, 403,
    "administrator status alone does not grant the finance queue");
  const buyerReview = await api(
    ownerCookie,
    `/api/admin/vip/receipts/${receiptId}/review`,
    "POST",
    { decision: "approve", verifiedAmount: "50.00", note: "Synthetic check" },
  );
  assert.equal(buyerReview.response.status, 403);
  const ungrantedFinance = await api(
    financeCookie,
    `/api/admin/vip/receipts/${receiptId}/review`,
    "POST",
    { decision: "approve", verifiedAmount: "50.00", note: "Synthetic check" },
  );
  assert.equal(ungrantedFinance.response.status, 403);
  const ungrantedQueue = await api(financeCookie, "/api/admin/vip/finance/receipts");
  assert.equal(ungrantedQueue.response.status, 403,
    "finance queue requires an active explicit grant");

  const grant = await api(
    managerCookie,
    "/api/admin/vip/finance-permissions",
    "POST",
    { email: `vip_${runId}_finance@fixture.example.test` },
  );
  assert.equal(grant.response.status, 200);
  const financeList = await api(financeCookie, "/api/admin/vip/receipts");
  assert.equal(financeList.response.status, 403,
    "finance reviewers cannot read the administrator's full receipt history");
  const financeQueue = await api(financeCookie, "/api/admin/vip/finance/receipts");
  assert.equal(financeQueue.response.status, 200);
  const initialQueueRows = JSON.parse(financeQueue.text).receipts as Array<{
    id: string; review_status: string; uploaded_by: number;
  }>;
  assert.ok(initialQueueRows.some((row) => Number(row.id) === receiptId));
  assert.ok(initialQueueRows.every(
    (row) => row.review_status === "pending" && Number(row.uploaded_by) !== users.finance,
  ), "finance queue contains only pending receipts uploaded by someone else");
  const pendingReceiptDownload = await api(
    financeCookie,
    `/api/vip/receipts/${receiptId}/download`,
  );
  assert.equal(pendingReceiptDownload.response.status, 200,
    "authorized reviewer can download another user's pending receipt");
  assert.ok(Buffer.from(pendingReceiptDownload.text).equals(PDF));

  const selfReceipt = await pool.query(
    "INSERT INTO vip_receipts(installment_id,object_path,file_name,mime_type,size_bytes,uploaded_by,upload_source) " +
      "VALUES($1,$2,'synthetic-self.pdf','application/pdf',$3,$4,'admin') RETURNING id",
    [
      installmentId,
      `kinglike-vip/receipts/${randomUUID()}.pdf`,
      PDF.length,
      users.finance,
    ],
  );
  const selfDownload = await api(
    financeCookie,
    `/api/vip/receipts/${selfReceipt.rows[0].id}/download`,
  );
  assert.equal(selfDownload.response.status, 404,
    "finance reviewers cannot download their own uploaded receipt");
  const selfReview = await api(
    financeCookie,
    `/api/admin/vip/receipts/${selfReceipt.rows[0].id}/review`,
    "POST",
    { decision: "approve", verifiedAmount: "1.00", note: "Self review blocked" },
  );
  assert.equal(selfReview.response.status, 403);
  const queueAfterSelfUpload = await api(financeCookie, "/api/admin/vip/finance/receipts");
  assert.equal(
    JSON.parse(queueAfterSelfUpload.text).receipts.some(
      (row: { id: string }) => Number(row.id) === Number(selfReceipt.rows[0].id),
    ),
    false,
    "reviewer cannot see their own upload in the finance queue",
  );

  const approved = await api(
    financeCookie,
    `/api/admin/vip/receipts/${receiptId}/review`,
    "POST",
    { decision: "approve", verifiedAmount: "50.00", note: "Synthetic bank check" },
  );
  assert.equal(approved.response.status, 200);
  const reviewedDownload = await api(financeCookie, `/api/vip/receipts/${receiptId}/download`);
  assert.equal(reviewedDownload.response.status, 404,
    "finance-only access ends after the receipt leaves pending review");
  const managerReviewedDownload = await api(
    managerCookie,
    `/api/vip/receipts/${receiptId}/download`,
  );
  assert.equal(managerReviewedDownload.response.status, 200,
    "administrators retain authorized access to reviewed receipt history");
  const queueAfterApproval = await api(financeCookie, "/api/admin/vip/finance/receipts");
  assert.equal(
    JSON.parse(queueAfterApproval.text).receipts.some(
      (row: { id: string }) => Number(row.id) === receiptId,
    ),
    false,
    "reviewed receipts leave the actionable finance queue",
  );
  const duplicate = await api(
    financeCookie,
    `/api/admin/vip/receipts/${receiptId}/review`,
    "POST",
    { decision: "approve", verifiedAmount: "50.00", note: "Duplicate blocked" },
  );
  assert.equal(duplicate.response.status, 409);
  const verified = await pool.query(
    "SELECT r.review_status," +
      "(SELECT COUNT(*)::int FROM vip_payment_postings p WHERE p.receipt_id=r.id) AS postings " +
      "FROM vip_receipts r WHERE r.id=$1",
    [receiptId],
  );
  assert.equal(verified.rows[0].review_status, "approved");
  assert.equal(verified.rows[0].postings, 1);

  const revoke = await api(
    managerCookie,
    "/api/admin/vip/finance-permissions",
    "DELETE",
    { email: `vip_${runId}_finance@fixture.example.test` },
  );
  assert.equal(revoke.response.status, 200);
  const afterRevoke = await api(
    financeCookie,
    `/api/admin/vip/receipts/${adminReceiptId}/review`,
    "POST",
    { decision: "approve", verifiedAmount: "1.00", note: "Revoked finance check" },
  );
  assert.equal(afterRevoke.response.status, 403);
  const stillPending = await pool.query(
    "SELECT review_status FROM vip_receipts WHERE id=$1",
    [adminReceiptId],
  );
  assert.equal(stillPending.rows[0].review_status, "pending");
});

test("the synthetic storage root contains only test files and no symlinks", async () => {
  assert.ok(storageDir);
  const files = await countFiles(storageDir!);
  assert.equal(files, 2, "two uploaded synthetic receipts should exist");
  const rootInfo = await stat(storageDir!);
  assert.ok(rootInfo.isDirectory());
});
