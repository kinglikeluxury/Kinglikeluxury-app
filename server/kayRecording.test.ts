import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getKayRecordingStorageStatus, createKayRecordingSignedReadUrl } from "./kayRecordingStorage";

const routes = readFileSync(new URL("./kayRecordingRoutes.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("./kayRecordingService.ts", import.meta.url), "utf8");
const storage = readFileSync(new URL("./kayRecordingStorage.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../artifacts/kay-recording-foundation-v1-migration.sql", import.meta.url), "utf8");
const ownership = readFileSync(new URL("./kayDataOwnership.ts", import.meta.url), "utf8");
const storageEnvKeys = [
  "KAY_RECORDING_STORAGE_ENDPOINT",
  "KAY_RECORDING_STORAGE_BUCKET",
  "KAY_RECORDING_STORAGE_ACCESS_KEY_ID",
  "KAY_RECORDING_STORAGE_SECRET_ACCESS_KEY",
];

test("recording archive and direct playback/download URLs use the live Kay admin gate", () => {
  assert.match(routes, /requireKayAdmin/);
  assert.match(routes, /\/api\/admin\/kay\/recordings\/:id\/play/);
  assert.match(routes, /\/api\/admin\/kay\/recordings\/:id\/download/);
  assert.match(routes, /getKayRecordingPlaybackUrl/);
  assert.match(service, /KAY_SUPERVISED_EMPLOYEES/);
  assert.match(service, /24, name: "Fadi"/);
  assert.match(service, /29, name: "Samer"/);
  assert.match(service, /31, name: "Jwana"/);
  assert.doesNotMatch(routes, /isAuthenticated/);
});

test("recording foundation separates employee archives and manager debriefs", () => {
  assert.match(service, /EMPLOYEE_CALL/);
  assert.match(service, /MANAGER_DEBRIEF/);
  assert.match(service, /canBeginKayCrmDiscussion/);
  assert.match(service, /notice_status === "PLAYED"/);
  assert.match(service, /KAY_RECORDING_STORAGE_UNAVAILABLE/);
  assert.match(service, /consentFlow: false/);
  assert.match(service, /employeeStop: false/);
  assert.match(service, /employeeDelete: false/);
});

test("private storage fails closed and does not expose a URL without its configuration", () => {
  assert.match(storage, /KAY_RECORDING_STORAGE_ENDPOINT/);
  assert.match(storage, /KAY_RECORDING_SIGNED_URL_TTL_SECONDS = 300/);
  const saved = Object.fromEntries(storageEnvKeys.map(key => [key, process.env[key]]));
  try {
    for (const key of storageEnvKeys) delete process.env[key];
    assert.equal(getKayRecordingStorageStatus().configured, false);
    assert.equal(createKayRecordingSignedReadUrl("recordings/example.webm"), null);
  } finally {
    for (const key of storageEnvKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("metadata migration is additive, private, and grants no delete/truncate", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS kay_recording_sessions/);
  assert.match(migration, /objection_at TIMESTAMPTZ/);
  assert.match(migration, /objection_reason TEXT/);
  assert.match(migration, /archive_type.*EMPLOYEE_CALL.*MANAGER_DEBRIEF/s);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON TABLE kay_recording_sessions/);
  assert.match(migration, /REVOKE DELETE, TRUNCATE/);
  assert.doesNotMatch(migration, /\b(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\s+crm_/i);
  assert.match(ownership, /kay_recording_sessions.*KAY_OWNED/);
});

test("ADMIN_TEST lifecycle metadata stores only bounded event evidence", () => {
  assert.match(migration, /lifecycle_events JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(service, /recordKayAdminTestLifecycle/);
  assert.match(service, /jsonb_build_object/);
  assert.match(service, /clock_timestamp/);
  assert.match(service, /eventName/);
  assert.match(service, /reason_code/);
  const lifecycle = service.slice(service.indexOf("recordKayAdminTestLifecycle"), service.indexOf("export async function recordKayRecordingObjection"));
  assert.doesNotMatch(lifecycle, /audio|crm_/i);
});