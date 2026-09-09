import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = {
  scheduler: readFileSync(new URL("./kayAutoRescueService.ts", import.meta.url), "utf8"),
  mission: readFileSync(new URL("./kayMissionService.ts", import.meta.url), "utf8"),
  rescue: readFileSync(new URL("./kayRescueService.ts", import.meta.url), "utf8"),
};

test("Kay production write paths import and invoke the centralized fail-closed boundary", () => {
  for (const [name, source] of Object.entries(files)) {
    assert.match(source, /from "\.\/kaySyntheticSafety"/, `${name} imports centralized safety`);
    assert.match(source, /assertKayProductionEntry\(/, `${name} checks production entry`);
  }
});

test("Kay boundary is checked before scheduler/mission/rescue work opens its transaction", () => {
  const scheduler = files.scheduler.slice(files.scheduler.indexOf("export async function runKayAutoRescueWorker"));
  const rescue = files.rescue.slice(files.rescue.indexOf("export async function executeRescueTransaction"));
  const mission = files.mission.slice(files.mission.indexOf("export async function generateKayMissions"));
  assert.ok(scheduler.indexOf("assertKayProductionEntry();") < scheduler.indexOf("try {"));
  assert.ok(rescue.indexOf("assertKayProductionEntry(command)") < rescue.indexOf("pool.connect()"));
  assert.ok(mission.indexOf("assertKayProductionEntry(undefined)") < mission.indexOf("acquireKayMissionGeneratorLease()"));
});