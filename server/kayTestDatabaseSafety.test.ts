import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertSafeKayMutationTestDatabase, kaySyntheticMarker } from "./kayTestDatabaseSafety";

const base = {
  NODE_ENV: "test",
  KAY_ALLOW_DESTRUCTIVE_TEST_DATABASE: "true",
  KAY_TEST_RUN_ID: "incident-regression-001",
};

test("Kay destructive tests hard-fail on the production neondb identity", () => {
  assert.throws(() => assertSafeKayMutationTestDatabase("E2", {
    ...base,
    NEON_DATABASE_URL: "postgres://user:pass@prod.example/neondb",
    KAY_TEST_DATABASE_URL: "postgres://user:pass@prod.example/neondb",
  }), /not a dedicated test database/);
});

test("Kay destructive tests hard-fail when active DB differs from explicit test DB", () => {
  assert.throws(() => assertSafeKayMutationTestDatabase("E2", {
    ...base,
    NEON_DATABASE_URL: "postgres://user:pass@prod.example/neondb",
    KAY_TEST_DATABASE_URL: "postgres://user:pass@test.example/kay_test",
  }), /does not exactly match/);
});

test("Kay synthetic markers contain the explicit test run id", () => {
  const marker = kaySyntheticMarker("KAY_E2_TEST", {
    ...base,
    NEON_DATABASE_URL: "postgres://user:pass@test.example/kay_test",
    KAY_TEST_DATABASE_URL: "postgres://user:pass@test.example/kay_test",
  });
  assert.equal(marker, "KAY_E2_TEST:run:incident-regression-001");
});

test("E.2 fixtures cannot repurpose existing CRM leads and cleanup is run-owned", () => {
  const source = readFileSync(new URL("./kayPhaseE2.integration.test.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /UPDATE\s+crm_leads\s+SET[^;`]*full_name/is);
  assert.match(source, /INSERT INTO crm_leads\(lead_source,full_name,status,assigned_to,notes,wa_stage\)/);
  assert.match(source, /leadIds\.push\(leadId\)/);
  assert.match(source, /DELETE FROM crm_leads WHERE id=ANY\(\$1::int\[\]\) AND notes=\$2/);
  assert.match(source, /const marker = kaySyntheticMarker\("KAY_E2_TEST"\)/);
});

test("every Kay integration suite that can mutate imports the hard-fail guard", () => {
  for (const file of [
    "kayPhaseB.integration.test.ts", "kayPhaseC1.integration.test.ts",
    "kayPhaseC.integration.test.ts", "kayPhaseD.integration.test.ts",
    "kayPhaseE1.integration.test.ts", "kayPhaseE21.integration.test.ts",
    "kayPhaseE22.integration.test.ts", "kayPhaseE23.integration.test.ts",
    "kayPhaseE2.integration.test.ts",
  ]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.match(source, /assertSafeKayMutationTestDatabase\(/, file);
  }
});