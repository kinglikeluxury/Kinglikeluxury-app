import {strict as assert} from "node:assert";
import type {AddressInfo} from "node:net";
import bcrypt from "bcrypt";
import {pool} from "../qaPreviewDb";
import {createQaApp} from "../qaPreviewServer";

/**
 * End-to-end HTTP test of the staging-only service: private Basic gateway,
 * actual bcrypt user passwords, signed session cookies and real VIP handlers.
 * No production host, live account, email or external API is consulted.
 */
async function main(){
 const createUser=async(name:string,isAdmin:boolean)=>{
   const passHash=await bcrypt.hash("SyntheticQaOnly-Password-418!",8);
   const r=await pool.query(
     "INSERT INTO users(username,email,password,role,is_verified,is_active,is_admin) "+
     "VALUES($1,$2,$3,'user',TRUE,TRUE,$4) RETURNING id",
     [name,name+"@fixture.example.test",passHash,isAdmin]);
   return Number(r.rows[0].id);
 };
 const buyer=await createUser("qa_preview_buyer",false);
 const stranger=await createUser("qa_preview_stranger",false);
 const manager=await createUser("qa_preview_manager",true);
 const project=(await pool.query(
  "INSERT INTO vip_projects(name) VALUES('Isolated Preview Test') RETURNING id")).rows[0].id;
 const unit=(await pool.query(
  "INSERT INTO vip_units(project_id,unit_number) VALUES($1,'QA-PORTAL-101') RETURNING id",
  [project])).rows[0].id;
 await pool.query(
  "INSERT INTO vip_unit_access(unit_id,user_id,access_role) VALUES($1,$2,'owner')",
  [unit,buyer]);
 const app=createQaApp();
 const server=app.listen(0,"127.0.0.1");
 await new Promise<void>((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject)});
 const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
 const validGate="Basic "+Buffer.from(
   process.env.KINGLIKE_VIP_QA_GATE_USER+":"+process.env.KINGLIKE_VIP_QA_GATE_PASSWORD
 ).toString("base64");
 async function call(path:string,method="GET",body?:unknown,
  cookie?:string,auth?:string|null,origin?:string){
   const headers:Record<string,string>={Origin:origin||base};
   if(auth!==null)headers.Authorization=auth===undefined?validGate:auth;
   if(cookie)headers.Cookie=cookie;
   if(body!==undefined)headers["Content-Type"]="application/json";
   const r=await fetch(base+path,{method,headers,
    body:body===undefined?undefined:JSON.stringify(body)});
   return {status:r.status,cookie:r.headers.get("set-cookie"),
    contentType:r.headers.get("content-type"),
    body:await r.text()};
 }
 async function login(username:string,password:string){
   const result=await call("/api/auth/login","POST",{username,password});
   assert.equal(result.status,200,JSON.stringify(result));
   const cookie=result.cookie?.split(";")[0];
   if(!cookie||!cookie.startsWith("kinglike.vip.qa.sid="))
     throw Error("QA login did not create a signed cookie");
   return cookie;
 }
 try{
   assert.equal((await call("/api/vip/me","GET",undefined,undefined,"Basic BAD")).status,401,
     "Gateway must block invalid Basic authorization");
   assert.equal((await call("/api/vip/me","GET",undefined,undefined,null)).status,401,
     "Gateway must block requests without Authorization");
   assert.equal((await call("/api/vip/me")).status,401,
     "Gateway alone cannot bypass user session");
   assert.equal((await call("/api/auth/login","POST",{
     username:"qa_preview_buyer",password:"wrong-password"
   })).status,401);
   assert.equal((await call("/api/auth/register","POST",{
     username:"random",password:"not-allowed",email:"fake@example.com"
   })).status,403,"Public account registration must be disabled");

   const buyerCookie=await login("qa_preview_buyer","SyntheticQaOnly-Password-418!");
   const otherCookie=await login("qa_preview_stranger","SyntheticQaOnly-Password-418!");
   const managerCookie=await login("qa_preview_manager","SyntheticQaOnly-Password-418!");
   const buyerInfo=await call("/api/auth/me","GET",undefined,buyerCookie);
   assert.equal(buyerInfo.status,200);
   const own=await call("/api/vip/me","GET",undefined,buyerCookie);
   assert.equal(own.status,200);
   const ownData=JSON.parse(own.body);
   assert.deepEqual(ownData.units.map((u:{unit_id:number})=>Number(u.unit_id)),[Number(unit)]);
   assert.equal((await call("/api/admin/vip/overview","GET",undefined,buyerCookie)).status,403);
   assert.equal((await call("/api/admin/vip/overview","GET",undefined,managerCookie)).status,200);
   assert.equal((await call("/api/vip/units/"+unit+"/account","GET",undefined,otherCookie)).status,404);
   assert.equal((await call("/api/vip/units/"+unit+"/journey","GET",undefined,buyerCookie)).status,200);

   // Even after both the private gateway and signed session succeed,
   // a mutation with an untrusted Origin must be rejected.
   assert.equal((await call("/api/vip/notification-preferences","PUT",
     {inAppDueReminders:false},buyerCookie,undefined,"https://outside.example.test")).status,403);
   assert.equal((await call("/api/vip/notification-preferences","PUT",
     {inAppDueReminders:false},buyerCookie)).status,200);

   await pool.query("UPDATE users SET is_active=FALSE WHERE id=$1",[manager]);
   assert.equal((await call("/api/admin/vip/overview","GET",undefined,managerCookie)).status,403,
     "Disabled admin's signed session must lose privileges");
   await pool.query("UPDATE vip_unit_access SET revoked_at=NOW() "+
     "WHERE unit_id=$1 AND user_id=$2 AND access_role='owner' AND revoked_at IS NULL",
     [unit,buyer]);
   assert.equal((await call("/api/vip/me","GET",undefined,buyerCookie)).status,200);
   assert.equal((await call("/api/vip/units/"+unit+"/account","GET",undefined,buyerCookie)).status,404);
   const html=await call("/vip","GET",undefined,buyerCookie);
   assert.equal(html.status,200,"Production React VIP page should load from QA build");
   assert(html.contentType?.includes("text/html"),"QA serves the React SPA");

   process.stdout.write("VIP private QA gateway + bcrypt + signed sessions + React assets verified\n");
 }finally{
   await new Promise<void>(resolve=>server.close(()=>resolve()));
   await pool.end();
 }
}
main().catch(error=>{
 process.stderr.write((error instanceof Error?error.stack:String(error))+"\n");
 process.exitCode=1;
});
