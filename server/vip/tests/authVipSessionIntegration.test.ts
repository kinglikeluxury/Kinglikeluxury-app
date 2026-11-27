import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import bcrypt from "bcrypt";
import connectPg from "connect-pg-simple";
import express from "express";
import session from "express-session";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { assertTemporaryPostgresProcessIdentity } from "../qaLocalPostgresIdentity";
import { pool } from "./localDbShim";
import {
  createSessionAuthGuards,
  registerAuthSessionRoutes,
} from "../../authSessionRoutes";
import { registerVipRoutes } from "../registerVipRoutes";

const syntheticPassword = "synthetic-local-vip-password-2026";
const runId = `auth_${process.pid}_${Date.now()}`;
const cookiePolicy = { secure: false, sameSite: "lax" as const };

type TestUser = {
  id: number;
  username: string;
  password: string;
  email: string;
  phoneNumber: string | null;
  whatsappNumber: string | null;
  facebookId: string | null;
  authMethod: string;
  isAdmin: boolean;
  role: string;
  isActive: boolean;
  isVerified: boolean;
};

const userFromRow = (row: any): TestUser => ({
  id: Number(row.id),
  username: row.username,
  password: row.password,
  email: row.email,
  phoneNumber: row.phone_number,
  whatsappNumber: row.whatsapp_number,
  facebookId: row.facebook_id,
  authMethod: row.auth_method,
  isAdmin: row.is_admin === true,
  role: row.role,
  isActive: row.is_active,
  isVerified: row.is_verified,
});

const userColumns = `
  id, username, password, email, phone_number, whatsapp_number, facebook_id,
  auth_method, is_admin, role, is_active, is_verified
`;

const storage = {
  async getUser(id: number) {
    const result = await pool.query(
      `SELECT ${userColumns} FROM users WHERE id=$1 LIMIT 1`,
      [id],
    );
    return result.rows[0] ? userFromRow(result.rows[0]) as any : undefined;
  },
  async getUserByUsername(username: string) {
    const result = await pool.query(
      `SELECT ${userColumns} FROM users WHERE username=$1 LIMIT 1`,
      [username],
    );
    return result.rows[0] ? userFromRow(result.rows[0]) : undefined;
  },
  async getUserByEmail(email: string) {
    const result = await pool.query(
      `SELECT ${userColumns} FROM users WHERE lower(email)=lower($1) LIMIT 1`,
      [email],
    );
    return result.rows[0] ? userFromRow(result.rows[0]) : undefined;
  },
  async getUserByPhone(phoneNumber: string) {
    const result = await pool.query(
      `SELECT ${userColumns} FROM users WHERE phone_number=$1 LIMIT 1`,
      [phoneNumber],
    );
    return result.rows[0] ? userFromRow(result.rows[0]) : undefined;
  },
  async getUserByField(field: string, value: string) {
    const column = ({
      phoneNumber: "phone_number",
      whatsappNumber: "whatsapp_number",
      facebookId: "facebook_id",
    } as Record<string, string>)[field];
    if (!column) throw new Error("Unsupported synthetic login field");
    const result = await pool.query(
      `SELECT ${userColumns} FROM users WHERE ${column}=$1 LIMIT 1`,
      [value],
    );
    return result.rows[0] ? userFromRow(result.rows[0]) : undefined;
  },
};

let baseUrl = "";
let server: ReturnType<express.Express["listen"]> | undefined;
let buyerA: TestUser;
let buyerB: TestUser;
let buyerC: TestUser;
let seller: TestUser;
let admin: TestUser;
let inactive: TestUser;
let unverified: TestUser;
let unitA: number;
let unitB: number;
let unitC: number;

async function createUser(
  suffix: string,
  options: Partial<Pick<TestUser, "isAdmin" | "role" | "isActive" | "isVerified">> = {},
): Promise<TestUser> {
  const username = `${runId}_${suffix}`;
  const email = `${username}@fixture.example.test`;
  const password = await bcrypt.hash(syntheticPassword, 4);
  const result = await pool.query(
    `INSERT INTO users
      (username,password,email,role,is_verified,is_active,is_admin)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${userColumns}`,
    [
      username,
      password,
      email,
      options.role ?? "user",
      options.isVerified ?? true,
      options.isActive ?? true,
      options.isAdmin ?? false,
    ],
  );
  return userFromRow(result.rows[0]);
}

async function call(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
  } = {},
) {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    redirect: "manual",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => ({}));
  const setCookie = response.headers.get("set-cookie");
  return { status: response.status, body, setCookie };
}

function cookieValue(response: { setCookie: string | null }): string {
  assert.ok(response.setCookie?.startsWith("connect.sid="), "signed session cookie expected");
  return response.setCookie!.split(";")[0];
}

async function login(user: TestUser, cookie?: string) {
  return call("/api/auth/login", {
    method: "POST",
    cookie,
    body: { username: user.username, password: syntheticPassword },
  });
}

before(async () => {
  const expectedDataDirectory = process.env.VIP_TEST_EXPECTED_DATA_DIRECTORY;
  assertTemporaryPostgresProcessIdentity(expectedDataDirectory,Number(process.env.PGPORT));
  const target = await pool.query(
    "SELECT current_database() AS db, host(inet_server_addr()) AS address, inet_server_port() AS port",
  );
  assert.ok(expectedDataDirectory, "a temporary PostgreSQL data directory must be explicitly verified");
  assert.equal(target.rows[0].db,"vipdb","auth/VIP integration must use the local vipdb database");
  assert.ok(
    ["127.0.0.1","::1","::ffff:127.0.0.1"].includes(target.rows[0].address),
    "auth/VIP integration must use a loopback PostgreSQL address",
  );
  assert.equal(
    target.rows[0].port,
    Number(process.env.PGPORT),
    "auth/VIP integration must use the selected temporary PostgreSQL port",
  );

  buyerA = await createUser("buyer_a");
  buyerB = await createUser("buyer_b");
  buyerC = await createUser("buyer_c");
  seller = await createUser("seller", { role: "sales_agent" });
  admin = await createUser("admin", { isAdmin: true, role: "admin" });
  inactive = await createUser("inactive", { isActive: false });
  unverified = await createUser("unverified", { isVerified: false });

  const project = await pool.query(
    "INSERT INTO vip_projects(name) VALUES($1) RETURNING id",
    [`Auth integration ${runId}`],
  );
  const projectId = Number(project.rows[0].id);
  const unitAResult = await pool.query(
    "INSERT INTO vip_units(project_id,unit_number) VALUES($1,$2) RETURNING id",
    [projectId, `${runId}_A`],
  );
  const unitBResult = await pool.query(
    "INSERT INTO vip_units(project_id,unit_number) VALUES($1,$2) RETURNING id",
    [projectId, `${runId}_B`],
  );
  const unitCResult = await pool.query(
    "INSERT INTO vip_units(project_id,unit_number) VALUES($1,$2) RETURNING id",
    [projectId, `${runId}_C`],
  );
  unitA = Number(unitAResult.rows[0].id);
  unitB = Number(unitBResult.rows[0].id);
  unitC = Number(unitCResult.rows[0].id);
  await pool.query(
    `INSERT INTO vip_unit_access(unit_id,user_id,access_role)
     VALUES ($1,$2,'owner'),($3,$4,'owner'),($5,$6,'owner'),($1,$7,'seller')`,
    [unitA, buyerA.id, unitB, buyerB.id, unitC, buyerC.id, seller.id],
  );

  const app = express();
  app.use(express.json());
  const PgSessionStore = connectPg(session);
  const store = new PgSessionStore({
    pool,
    createTableIfMissing: true,
  });
  app.use(session({
    store,
    secret: "synthetic-only-auth-vip-session-secret-for-local-tests",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 60_000,
    },
  }));
  app.get("/__test/anonymous-session", (req, res) => {
    (req.session as any).anonymousMarker = "synthetic";
    res.json({ ready: true });
  });
  registerAuthSessionRoutes(app, {
    storage: storage as any,
    comparePassword: (plainText, hash) => bcrypt.compare(plainText, hash),
    allowPhoneOtpAttempt: () => true,
    cookiePolicy,
  });
  const guards = createSessionAuthGuards(storage as any, cookiePolicy);
  app.get(
    "/api/session-guard",
    guards.isAuthenticated,
    (req, res) => res.json({ userId: req.session.userId }),
  );
  app.get(
    "/api/admin/session-guard",
    guards.isAuthenticated,
    guards.isAdmin,
    (_req, res) => res.json({ admin: true }),
  );
  process.env.KINGLIKE_VIP_ENABLED = "true";
  registerVipRoutes(app);

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  process.env.KINGLIKE_VIP_ENABLED = "false";
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve());
      server!.closeAllConnections();
    });
  }
  await pool.end();
});

test("real login rotates the signed session, serves /me, and switches identities", async () => {
  const anonymous = await call("/__test/anonymous-session");
  const oldCookie = cookieValue(anonymous);
  const first = await login(buyerA, oldCookie);
  assert.equal(first.status, 200);
  const buyerACookie = cookieValue(first);
  assert.notEqual(buyerACookie, oldCookie, "login must regenerate the session ID");
  assert.equal((await call("/api/auth/me", { cookie: oldCookie })).status, 401);
  assert.equal((await call("/api/auth/me", { cookie: buyerACookie })).body.id, buyerA.id);

  const switched = await login(buyerB, buyerACookie);
  assert.equal(switched.status, 200);
  const buyerBCookie = cookieValue(switched);
  assert.notEqual(buyerBCookie, buyerACookie, "account switch must regenerate the session ID");
  assert.equal((await call("/api/auth/me", { cookie: buyerACookie })).status, 401);
  assert.equal((await call("/api/auth/me", { cookie: buyerBCookie })).body.id, buyerB.id);
});

test("bad credentials, inactive accounts, and unverified accounts create no login session", async () => {
  const badPassword = await call("/api/auth/login", {
    method: "POST",
    body: { username: buyerA.username, password: "wrong synthetic password" },
  });
  assert.equal(badPassword.status, 401);
  assert.equal(badPassword.setCookie, null);

  for (const user of [inactive, unverified]) {
    const rejected = await login(user);
    assert.equal(rejected.status, 401);
    assert.equal(rejected.setCookie, null);
  }
});

test("logout destroys the server session and expires the client cookie", async () => {
  const signedIn = await login(buyerA);
  const cookie = cookieValue(signedIn);
  const loggedOut = await call("/api/auth/logout", { method: "POST", cookie });
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.setCookie ?? "", /connect\.sid=/);
  assert.equal((await call("/api/auth/me", { cookie })).status, 401);
  assert.equal((await call("/api/vip/me", { cookie })).status, 401);
});

test("deactivation or verification revocation destroys an existing session", async () => {
  for (const [user, column] of [
    [buyerA, "is_active"],
    [buyerB, "is_verified"],
  ] as const) {
    const signedIn = await login(user);
    const cookie = cookieValue(signedIn);
    await pool.query(`UPDATE users SET ${column}=FALSE WHERE id=$1`, [user.id]);
    const me = await call("/api/auth/me", { cookie });
    assert.equal(me.status, 401);
    assert.match(me.setCookie ?? "", /connect\.sid=/);
    assert.equal((await call("/api/session-guard", { cookie })).status, 401);
    assert.equal((await call("/api/vip/me", { cookie })).status, 401);
  }
});

test("current admin-role changes refresh /me and deny stale admin sessions", async () => {
  const signedIn = await login(admin);
  const cookie = cookieValue(signedIn);
  await pool.query(
    "UPDATE users SET is_admin=FALSE, role='user' WHERE id=$1",
    [admin.id],
  );
  const me = await call("/api/auth/me", { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.isAdmin, false);
  assert.equal(me.body.role, "user");
  assert.equal((await call("/api/admin/session-guard", { cookie })).status, 403);
  assert.equal((await call("/api/admin/vip/overview", { cookie })).status, 403);
});

test("buyer sessions cannot read another buyer's VIP unit", async () => {
  const signedIn = await login(buyerC);
  const cookie = cookieValue(signedIn);
  const own = await call("/api/vip/me", { cookie });
  assert.equal(own.status, 200);
  assert.deepEqual(own.body.units.map((unit: { unit_id: number }) => Number(unit.unit_id)), [unitC]);
  assert.equal(
    (await call(`/api/vip/units/${unitB}/account`, { cookie })).status,
    404,
  );
});

test("seller access is scoped to assigned units and revoked role/assignment fails closed", async () => {
  const signedIn = await login(seller);
  const cookie = cookieValue(signedIn);
  const units = await call("/api/vip/seller/units", { cookie });
  assert.equal(units.status, 200);
  assert.deepEqual(
    units.body.units.map((unit: { unit_id: number }) => Number(unit.unit_id)),
    [unitA],
  );
  assert.equal((await call(`/api/vip/seller/units/${unitB}`, { cookie })).status, 404);

  await pool.query(
    `UPDATE vip_unit_access SET revoked_at=NOW()
     WHERE unit_id=$1 AND user_id=$2 AND access_role='seller' AND revoked_at IS NULL`,
    [unitA, seller.id],
  );
  assert.equal((await call(`/api/vip/seller/units/${unitA}`, { cookie })).status, 404);

  await pool.query(
    `INSERT INTO vip_unit_access(unit_id,user_id,access_role) VALUES($1,$2,'seller')`,
    [unitA, seller.id],
  );
  await pool.query("UPDATE users SET role='user' WHERE id=$1", [seller.id]);
  assert.equal((await call("/api/vip/seller/units", { cookie })).status, 403);
});
