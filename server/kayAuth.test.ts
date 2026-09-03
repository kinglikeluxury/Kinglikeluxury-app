import test from "node:test";
import assert from "node:assert/strict";
import { createRequireKayAdmin } from "./kayAuth";

async function invoke(session: { userId?: number; isAdmin?: boolean }, liveAdmin = false) {
  let statusCode = 0;
  let body: unknown;
  let proceeded = false;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  };
  await createRequireKayAdmin(async () => liveAdmin)({ session } as any, res as any, () => {
    proceeded = true;
    res.status(200).json({ ok: true });
  });
  return { statusCode, body, proceeded };
}

test("Kay admin middleware returns 401 without session identity", async () => {
  assert.deepEqual(await invoke({}), { statusCode: 401, body: { message: "Not authenticated" }, proceeded: false });
});

test("Kay admin middleware returns 403 for an authenticated non-admin", async () => {
  assert.deepEqual(await invoke({ userId: 12, isAdmin: true }, false), { statusCode: 403, body: { message: "Not authorized" }, proceeded: false });
});

test("Kay admin middleware permits a live authenticated admin", async () => {
  assert.deepEqual(await invoke({ userId: 1, isAdmin: false }, true), { statusCode: 200, body: { ok: true }, proceeded: true });
});