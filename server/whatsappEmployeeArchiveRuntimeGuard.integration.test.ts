import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { registerWhatsappOperationsStatusRoutes } from "./whatsappOperationsStatusRoutes";

function openTestStatus(env: NodeJS.ProcessEnv): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve,reject)=>{
    const app=express();
    registerWhatsappOperationsStatusRoutes(app,{
      proofDb:null, env,
      authorizeAdmin:async req => req.get("x-synthetic-admin") === "yes" ? 101 : null,
    });
    const server=app.listen(0,"127.0.0.1",()=>{
      const address=server.address() as AddressInfo;
      resolve({server,origin:"http://127.0.0.1:"+address.port});
    });
    server.on("error",reject);
  });
}
async function stop(server: Server): Promise<void> {
  await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
}

test("Staging readiness is admin-only, no-store, inert and never leaks credentials",async () => {
  const env: NodeJS.ProcessEnv = {
    APP_DEPLOYMENT_MODE:"staging",
    WHATSAPP_EMPLOYEE_ARCHIVE_STAGING_RUNTIME_ENABLED:"false",
    WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:
      "postgresql://sensitiveuser:ultra-secret@private.railway.internal/sensitive_archive",
    WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64:Buffer.alloc(32,5).toString("base64"),
  };
  const {server,origin}=await openTestStatus(env);
  try {
    const noAdmin=await fetch(origin+"/api/admin/staging/whatsapp-archive-readiness");
    assert.equal(noAdmin.status,403);
    const admin=await fetch(origin+"/api/admin/staging/whatsapp-archive-readiness",{
      headers:{"x-synthetic-admin":"yes"},
    });
    assert.equal(admin.status,200);
    assert.match(admin.headers.get("cache-control")??"",/no-store/);
    const payload:any=await admin.json();
    assert.equal(payload.environment,"isolated_staging");
    assert.equal(payload.status,"disabled");
    assert.equal(payload.databaseProbe,"not_run");
    assert.equal(payload.liveConnection,"not_connected");
    assert.equal(payload.liveNumbers,"not_verified");
    assert.equal(payload.webhookActive,false);
    assert.ok(payload.blockers.includes("runtime_disabled"));
    const serialized=JSON.stringify(payload);
    for(const fragment of ["sensitiveuser","ultra-secret","sensitive_archive",
      "private.railway.internal",env.WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64!]){
      assert.equal(serialized.includes(fragment),false);
    }
  } finally { await stop(server); }
});

test("archive readiness is completely hidden outside Staging",async () => {
  const {server,origin}=await openTestStatus({APP_DEPLOYMENT_MODE:"production"});
  try {
    const result=await fetch(origin+"/api/admin/staging/whatsapp-archive-readiness",{
      headers:{"x-synthetic-admin":"yes"},
    });
    assert.equal(result.status,404);
  } finally { await stop(server); }
});
