import { strict as assert } from "node:assert";
import { test, type TestContext } from "node:test";
import express from "express";
import bcrypt from "bcrypt";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { createChangePasswordHandler } from "./authChangePasswordRoute";

async function start(t: TestContext, initial: string, userId: number | undefined = 41) {
  let saved = initial;
  let writes = 0;
  const app = express();
  app.use(express.json());
  app.use((req,_res,next) => {
    (req as any).session = userId ? {userId} : {};
    next();
  });
  app.post("/api/auth/change-password",createChangePasswordHandler({
    getUser:async(id:number)=>id===41?({id:41,password:saved} as any):undefined,
    updateUserPassword:async(id:number,password:string)=>{
      if(id!==41) return undefined;
      writes++; saved=password;
      return {id:41,password} as any;
    },
  }));
  const server=app.listen(0,"127.0.0.1");
  await once(server,"listening");
  t.after(()=>new Promise<void>((resolve,reject)=>{
    server.close(err=>err?reject(err):resolve());
    server.closeAllConnections();
  }));
  const url="http://127.0.0.1:"+(server.address() as AddressInfo).port+"/api/auth/change-password";
  const post=async(body:unknown)=>{
    const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  };
  return {post,getStored:()=>saved,getWrites:()=>writes};
}

test("existing bcrypt user can change password; new credential is bcrypt-only",async(t)=>{
  const s=await start(t,await bcrypt.hash("CurrentPassword-2026!",10));
  assert.equal((await s.post({currentPassword:"CurrentPassword-2026!",newPassword:"NewPassword-2026!"})).status,200);
  assert.match(s.getStored(),/^\$2[ab]\$12\$/);
  assert.notEqual(s.getStored(),"NewPassword-2026!");
  assert.equal(await bcrypt.compare("NewPassword-2026!",s.getStored()),true);
  assert.equal(await bcrypt.compare("CurrentPassword-2026!",s.getStored()),false);
  assert.equal(s.getWrites(),1);
});

test("legacy plaintext account is upgraded to bcrypt when changing password",async(t)=>{
  const s=await start(t,"legacy-password");
  assert.equal((await s.post({currentPassword:"legacy-password",newPassword:"Upgraded-2026!"})).status,200);
  assert.match(s.getStored(),/^\$2[ab]\$12\$/);
  assert.equal(await bcrypt.compare("Upgraded-2026!",s.getStored()),true);
  assert.equal(s.getWrites(),1);
});

test("wrong current password and missing session never update account",async(t)=>{
  const s=await start(t,await bcrypt.hash("ValidPassword-2026!",10));
  const before=s.getStored();
  assert.equal((await s.post({currentPassword:"wrong",newPassword:"NewPassword-2026!"})).status,401);
  assert.equal(s.getStored(),before);
  assert.equal(s.getWrites(),0);
  const noSession=await start(t,"legacy-password",0);
  assert.equal((await noSession.post({currentPassword:"legacy-password",newPassword:"NewPassword-2026!"})).status,401);
  assert.equal(noSession.getWrites(),0);
});

test("missing or over-72-byte replacement passwords are rejected",async(t)=>{
  const s=await start(t,"old-pass");
  assert.equal((await s.post({currentPassword:"old-pass"})).status,400);
  assert.equal((await s.post({currentPassword:"old-pass",newPassword:"short"})).status,400);
  assert.equal((await s.post({currentPassword:"old-pass",newPassword:"ä".repeat(40)})).status,400);
  assert.equal(s.getWrites(),0);
});
