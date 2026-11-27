import express from "express";
import session from "express-session";
import pg from "pg";
import { assertTemporaryPostgresProcessIdentity } from "../qaLocalPostgresIdentity.ts";
import { createQaPostgresSessionStore } from "../qaPostgresSessionStore.ts";

const allowedEnvironment = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "NODE_ENV",
  "VIP_TEST_SESSION_RESTART",
  "VIP_TEST_DATABASE_URL",
  "VIP_TEST_EXPECTED_DATA_DIRECTORY",
  "VIP_TEST_RUN_ID",
  "VIP_TEST_SESSION_SECRET",
  "VIP_TEST_SESSION_COOKIE",
  "PGPORT",
]);

let server;
let pool;

try {
  if (
    Object.keys(process.env).some((key) => !allowedEnvironment.has(key)) ||
    process.env.NODE_ENV !== "test" ||
    process.env.VIP_TEST_SESSION_RESTART !== "read" ||
    process.env.VIP_TEST_SESSION_SECRET !== "synthetic-local-session-secret-not-for-deployment" ||
    !/^[A-Za-z0-9_-]{4,32}$/.test(process.env.VIP_TEST_RUN_ID || "") ||
    !process.env.VIP_TEST_SESSION_COOKIE
  ) {
    throw new Error("worker environment refused");
  }

  const port = Number(process.env.PGPORT);
  const databaseUrl = new URL(process.env.VIP_TEST_DATABASE_URL || "");
  if (
    databaseUrl.protocol !== "postgresql:" ||
    databaseUrl.hostname !== "127.0.0.1" ||
    databaseUrl.pathname !== "/vipdb" ||
    Number(databaseUrl.port) !== port ||
    decodeURIComponent(databaseUrl.username) !== `vipqa_${process.env.VIP_TEST_RUN_ID}` ||
    databaseUrl.password ||
    databaseUrl.searchParams.get("sslmode") !== "disable"
  ) {
    throw new Error("worker database target refused");
  }
  assertTemporaryPostgresProcessIdentity(
    process.env.VIP_TEST_EXPECTED_DATA_DIRECTORY,
    port,
  );

  const { Pool } = pg;
  pool = new Pool({
    connectionString: databaseUrl.toString(),
    max: 2,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 1000,
  });
  const identity = await pool.query(
    "SELECT current_database() AS database,current_user AS role," +
      "host(inet_server_addr()) AS address,inet_server_port() AS port",
  );
  if (
    identity.rows.length !== 1 ||
    identity.rows[0].database !== "vipdb" ||
    identity.rows[0].role !== `vipqa_${process.env.VIP_TEST_RUN_ID}` ||
    identity.rows[0].address !== "127.0.0.1" ||
    Number(identity.rows[0].port) !== port
  ) {
    throw new Error("worker database identity refused");
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(session({
    store: createQaPostgresSessionStore(pool),
    secret: process.env.VIP_TEST_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 60_000 },
  }));
  app.get("/__verify", (req, res) => {
    const userId = Number(req.session?.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).end();
    }
    return res.json({ session: "restored", userId });
  });

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
    throw new Error("worker listener refused");
  }
  const response = await fetch(`http://127.0.0.1:${address.port}/__verify`, {
    headers: { Cookie: process.env.VIP_TEST_SESSION_COOKIE },
  });
  if (response.status !== 200) throw new Error("worker session not restored");
  const body = await response.json();
  if (!Number.isSafeInteger(body.userId) || body.session !== "restored") {
    throw new Error("worker session response refused");
  }
  process.stdout.write(JSON.stringify(body));
} catch {
  process.stderr.write("PostgreSQL session restart verification failed.\n");
  process.exitCode = 1;
} finally {
  if (server) {
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
  await pool?.end().catch(() => {});
}
