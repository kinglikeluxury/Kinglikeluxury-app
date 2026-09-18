import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveKayMissionGeneratorStatus } from "./kayMissionService";

test("global scheduler gate does not imply an active Kay Mission Generator", () => {
  assert.equal(deriveKayMissionGeneratorStatus(true, false, false), "NOT RUNNING");
});

test("manual mode is explicit when global schedulers are disabled", () => {
  assert.equal(deriveKayMissionGeneratorStatus(false, false, false), "MANUAL MODE");
});

test("Kay Mission Generator reports running only with runtime evidence", () => {
  assert.equal(deriveKayMissionGeneratorStatus(true, true, false), "RUNNING");
  assert.equal(deriveKayMissionGeneratorStatus(true, true, true), "DEGRADED");
});

test("Control Center renders the operations health status and preserves the last cycle", () => {
  const client = readFileSync(new URL("../client/src/pages/admin/kay-control-center.tsx", import.meta.url), "utf8");
  assert.match(client, /operationsHealth\?\.scheduler/);
  assert.match(client, /operationsHealth\?\.lastSuccessfulCycle/);
});