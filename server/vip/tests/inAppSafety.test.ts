import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// Static release invariant checks complement (not replace) real HTTP,
// schema and permission tests. The default feature flags must stay OFF.
const read=(name:string)=>readFileSync(name,"utf8");

test("VIP stays inside existing app and starts behind two opt-in flags",()=>{
  const entry=read("server/index.ts");
  const router=read("server/vip/registerVipRoutes.ts");
  const app=read("client/src/App.tsx");
  const register=entry.indexOf("const server = await registerRoutes(app)");
  const vipRegister=entry.indexOf("registerVipRoutes(app)");
  assert(register>=0&&vipRegister>register,
    "VIP routes must register after existing app sessions");
  assert.match(router,/process\.env\.KINGLIKE_VIP_ENABLED\s*!==\s*"true"/,
    "Backend VIP is disabled by default");
  assert.match(app,/VITE_KINGLIKE_VIP_ENABLED\s*===\s*"true"/,
    "VIP user-facing pages must require a separate explicit build flag");
  assert(!entry.includes("vip:qa:migrate"),
    "Production startup must never execute disposable QA migrations");
  assert(!entry.includes("qaPreviewServer"),
    "Separate QA entrypoint must not be imported into production app");
});

test("VIP DDL cannot replace or alter the main app and CRM schema",()=>{
  const sql=read("server/vip/migrations/001_vip_foundation.sql");
  const tableNames=[...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi)]
    .map(x=>x[1].replace(/"/g,"").split(".").at(-1));
  assert(tableNames.length>15,"Expected substantial VIP schema");
  assert(tableNames.every(x=>x?.startsWith("vip_")),
    "Migration must create only new vip_* tables");
  assert(!/\b(?:ALTER|DROP|TRUNCATE)\s+TABLE\b/i.test(sql),
    "VIP initial schema must not alter or drop app tables");
  assert(!/\b(?:DELETE|UPDATE)\s+(?:FROM\s+)?(?:users|crm_\w+)\b/i.test(sql),
    "VIP schema must not mutate existing customer or CRM records");
});

test("VIP responses are excluded from the legacy API response-body logger",()=>{
  const entry=read("server/index.ts");
  assert.match(entry,/path\.startsWith\("\/api\/vip\/"\)/);
  assert.match(entry,/path\.startsWith\("\/api\/admin\/vip\/"\)/);
  assert.match(entry,/capturedJsonResponse\s*&&\s*!vipSensitiveApi/,
    "Sensitive VIP JSON must not be included in generic request logs");
});
