import test from "node:test";
import assert from "node:assert/strict";
import {
  createKayLeadCreatedObserver,
  createKayModeUpdater,
  resolveKayMode,
  sanitizeKayJson,
  type KayModeTransactionRunner,
  type KayModeTransition,
  validateKayModeUpdate,
} from "./kayService";

test("Kay mode resolves invalid or absent stored settings to safe shadow", () => {
  assert.equal(resolveKayMode(undefined), "shadow");
  assert.equal(resolveKayMode({ mode: "invalid" }), "shadow");
  assert.equal(resolveKayMode({ mode: "assisted" }), "assisted");
  assert.equal(resolveKayMode(resolveKayMode(undefined) === "shadow" ? { mode: "shadow" } : undefined), "shadow");
});

test("Kay mode update validation permits only shadow and assisted", () => {
  assert.deepEqual(validateKayModeUpdate({ mode: "shadow" }), { ok: true, mode: "shadow" });
  assert.deepEqual(validateKayModeUpdate({ mode: "assisted" }), { ok: true, mode: "assisted" });
  for (const mode of ["active", "controlled_automation", "full_approved_automation", "unknown", "AUTO", "FULL", true, 1]) {
    assert.equal(validateKayModeUpdate({ mode }).ok, false);
  }
  assert.equal(validateKayModeUpdate({ mode: "shadow", extra: true }).ok, false);
});

test("Kay JSON sanitization recursively removes credential-like metadata", () => {
  const createdAt = new Date("2026-09-03T12:00:00.000Z");
  assert.deepEqual(sanitizeKayJson({
    safe: "value", accessToken: "never-store", nested: { passwordHash: "never-store", ok: true },
    values: [{ otpSecret: "never-store", apiKey: "never-store", authorization: "never-store", allowed: 1 }],
    createdAt,
  }), {
    safe: "value",
    nested: { ok: true },
    values: [{ allowed: 1 }],
    createdAt: "2026-09-03T12:00:00.000Z",
  });
});

test("forced Kay persistence failure is isolated from successful core lead result", async () => {
  const warnings: string[] = [];
  const observer = createKayLeadCreatedObserver({
    getMode: async () => "shadow",
    persistLeadCreated: async () => { throw new Error("Kay database unavailable"); },
    warn: (message) => warnings.push(message),
  });
  const coreLeadResponse = { id: 42, status: "created" };
  await observer({ id: 42, status: "new" }, 7);
  assert.deepEqual(coreLeadResponse, { id: 42, status: "created" });
  assert.equal(warnings.length, 1);
});

test("one normal lead-created observation invokes Kay persistence exactly once", async () => {
  let persistenceCalls = 0;
  const observer = createKayLeadCreatedObserver({
    getMode: async () => "shadow",
    persistLeadCreated: async () => { persistenceCalls += 1; return true; },
    warn: () => assert.fail("successful observation must not warn"),
  });
  await observer({ id: 43, status: "new" }, 7);
  assert.equal(persistenceCalls, 1);
});

function memoryModeRunner(options: { failAudit?: boolean } = {}) {
  let stored: unknown = { mode: "shadow" };
  const audits: KayModeTransition[] = [];
  let queue = Promise.resolve();
  const runner: KayModeTransactionRunner = async (apply) => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const storedBefore = stored;
    const auditCountBefore = audits.length;
    try {
      await apply(stored, async (transition) => {
        stored = { mode: transition.newMode };
        audits.push(transition);
        if (options.failAudit) throw new Error("forced audit failure");
      });
    } catch (error) {
      stored = storedBefore;
      audits.splice(auditCountBefore);
      throw error;
    } finally {
      release();
    }
  };
  return { runner, getStored: () => stored, audits };
}

test("successful mode update records one previous/new/admin/time transition", async () => {
  const memory = memoryModeRunner();
  const changedAt = new Date("2026-09-03T12:00:00.000Z");
  await createKayModeUpdater(memory.runner, () => changedAt)("shadow", 17);
  assert.deepEqual(memory.getStored(), { mode: "shadow" });
  assert.deepEqual(memory.audits, [{
    previousMode: "shadow", newMode: "shadow", updatedBy: 17, changedAt,
  }]);
});

test("failed mode audit rolls back setting and leaves no false success record", async () => {
  const memory = memoryModeRunner({ failAudit: true });
  await assert.rejects(createKayModeUpdater(memory.runner)("shadow", 17), /forced audit failure/);
  assert.deepEqual(memory.getStored(), { mode: "shadow" });
  assert.equal(memory.audits.length, 0);
});

test("concurrent mode updates serialize deterministically and preserve both audit records", async () => {
  const memory = memoryModeRunner();
  let tick = 0;
  const update = createKayModeUpdater(memory.runner, () => new Date(1_000 + tick++));
  await Promise.all([update("shadow", 17), update("shadow", 23)]);
  assert.deepEqual(memory.getStored(), { mode: "shadow" });
  assert.deepEqual(memory.audits.map(({ updatedBy }) => updatedBy), [17, 23]);
  assert.ok(memory.audits[0].changedAt < memory.audits[1].changedAt);
});