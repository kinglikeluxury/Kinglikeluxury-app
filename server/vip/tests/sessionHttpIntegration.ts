import express from "express";
import session from "express-session";
import type {AddressInfo} from "node:net";
import {strict as assert} from "node:assert";
import {pool} from "./localDbShim";
import {registerVipRoutes} from "../registerVipRoutes";

/**
 * Execute production VIP route registration + real express-session cookies
 * against the disposable localhost-only PostgreSQL database.
 *
 * ONLY the /__qa/login helper below is synthetic. No app login route, public
 * endpoint, live data, secrets or production storage is used. It is never
 * imported by the deployed app or included in its server build.
 */
async function main(){
 const createUser=async(username:string,isAdmin=false)=>{
  const email=username+"@fixture.example.test";
  const r=await pool.query(
   "INSERT INTO users(username,email,role,is_verified,is_active,is_admin) "+
   "VALUES($1,$2,'user',TRUE,TRUE,$3) RETURNING id",
   [username,email,isAdmin]);
  return Number(r.rows[0].id);
 };
 const buyer1=await createUser("vip_session_buyer1");
 const buyer2=await createUser("vip_session_buyer2");
 const administrator=await createUser("vip_session_manager",true);
 const project=(await pool.query(
  "INSERT INTO vip_projects(name) VALUES('Session-isolated QA') RETURNING id")).rows[0].id;
 const unit1=(await pool.query(
  "INSERT INTO vip_units(project_id,unit_number) VALUES($1,'AUTH-101') RETURNING id",
  [project])).rows[0].id;
 const unit2=(await pool.query(
  "INSERT INTO vip_units(project_id,unit_number) VALUES($1,'AUTH-202') RETURNING id",
  [project])).rows[0].id;
 await pool.query(
  "INSERT INTO vip_unit_access(unit_id,user_id,access_role) VALUES($1,$2,'owner'),($3,$4,'owner')",
  [unit1,buyer1,unit2,buyer2]);

 const app=express();
 app.disable("x-powered-by");
 app.use(express.json({limit:"16kb"}));
 app.use(session({
   secret:"vip-qa-isolated-only-not-for-production-"+process.pid,
   resave:false,saveUninitialized:false,
   cookie:{httpOnly:true,sameSite:"lax",secure:false,maxAge:60000}
 }));
 // Synthetic login is not part of any production file. It only issues
 // a session for fixture users already created in local vipdb.
 app.post("/__qa/login",async(req,res)=>{
  const userId=req.body?.userId;
  if(![buyer1,buyer2,administrator].includes(userId))return res.status(403).json({error:"Not a QA account"});
  req.session.userId=userId;
  return res.json({loggedIn:true});
 });

 process.env.KINGLIKE_VIP_ENABLED="false";
 registerVipRoutes(app);
 const server=app.listen(0,"127.0.0.1");
 await new Promise<void>((resolve,reject)=>{
  server.once("listening",resolve);server.once("error",reject);
 });
 const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
 async function api(cookie:string|null,path:string,method="GET",body?:unknown,origin?:string){
   const headers:Record<string,string>={Origin:origin??base};
   if(cookie)headers.Cookie=cookie;
   if(body!==undefined)headers["Content-Type"]="application/json";
   const r=await fetch(base+path,{
     method,headers,redirect:"manual",
     body:body===undefined?undefined:JSON.stringify(body)
   });
   return {status:r.status,body:await r.json().catch(()=>({}))};
 }
 async function login(userId:number){
  const r=await fetch(base+"/__qa/login",{
   method:"POST",
   headers:{"Content-Type":"application/json",Origin:base},
   body:JSON.stringify({userId})
  });
  assert.equal(r.status,200);
  const cookie=r.headers.get("set-cookie")?.split(";")[0];
  assert(cookie?.startsWith("connect.sid="),"Real signed session cookie must be issued");
  return cookie;
 }

 try{
  assert.equal((await api(null,"/api/vip/me")).status,404,
   "VIP feature flag OFF must hide even an unauthenticated route");
  process.env.KINGLIKE_VIP_ENABLED="true";

  assert.equal((await api(null,"/api/vip/me")).status,401,
   "Active flag alone must not bypass real session authentication");
  assert.equal((await api("connect.sid=s%3Amalicious.bad","/api/vip/me")).status,401,
   "Forged cookie must not create a valid VIP session");

  const c1=await login(buyer1),c2=await login(buyer2),ca=await login(administrator);
  const own1=await api(c1,"/api/vip/me");
  const own2=await api(c2,"/api/vip/me");
  assert.equal(own1.status,200,JSON.stringify(own1.body));
  assert.equal(own2.status,200,JSON.stringify(own2.body));
  assert.deepEqual(own1.body.units.map((x:{unit_id:number})=>Number(x.unit_id)),[Number(unit1)]);
  assert.deepEqual(own2.body.units.map((x:{unit_id:number})=>Number(x.unit_id)),[Number(unit2)]);

  assert.equal((await api(c1,"/api/admin/vip/overview")).status,403,
    "Buyer cookie cannot open admin dashboard");
  const admin=await api(ca,"/api/admin/vip/overview");
  assert.equal(admin.status,200,JSON.stringify(admin.body));
  assert(Number(admin.body.overview.units)>=2);

  // Per-unit entitlement checks must follow the authenticated session,
  // never a user ID submitted by the browser.
  assert.equal((await api(c1,"/api/vip/units/"+unit2+"/journey")).status,404);
  assert.equal((await api(c2,"/api/vip/units/"+unit1+"/account")).status,404);
  assert.equal((await api(c1,"/api/vip/units/"+unit1+"/journey")).status,200);
  assert.equal((await api(c2,"/api/vip/units/"+unit2+"/account")).status,200);
  assert.equal((await api(null,"/api/vip/notifications")).status,401);

  // Same-origin writes with real cookies: a cross-site fetch must not
  // modify an owner's preferences, even with a valid session.
  assert.equal((await api(c1,"/api/vip/notification-preferences","PUT",
    {inAppDueReminders:false},"https://malicious.example.test")).status,403);
  assert.equal((await api(c1,"/api/vip/notification-preferences")).body.inAppDueReminders,true);
  assert.equal((await api(c1,"/api/vip/notification-preferences","PUT",
    {inAppDueReminders:false})).status,200);
  assert.equal((await api(c1,"/api/vip/notification-preferences")).body.inAppDueReminders,false);
  assert.equal((await api(c2,"/api/vip/notification-preferences")).body.inAppDueReminders,true,
    "Another buyer's preference cannot be modified by buyer1");

  // The same signed cookie must fail as soon as the associated account
  // is disabled. Session data cannot override DB-based active checks.
  await pool.query("UPDATE users SET is_active=FALSE WHERE id=$1",[administrator]);
  assert.equal((await api(ca,"/api/admin/vip/overview")).status,403,
    "Deactivated admin cannot continue using an old valid cookie");

  await pool.query("UPDATE vip_unit_access SET revoked_at=NOW() "+
    "WHERE unit_id=$1 AND user_id=$2 AND access_role='owner' AND revoked_at IS NULL",
    [unit1,buyer1]);
  const revoked=await api(c1,"/api/vip/me");
  assert.equal(revoked.status,200);
  assert.equal(revoked.body.units.length,0,"Revoked buyer sees no units even with valid cookie");
  assert.equal((await api(c1,"/api/vip/units/"+unit1+"/account")).status,404);
  assert.equal((await api(c1,"/api/vip/units/"+unit1+"/journey")).status,404);

  process.env.KINGLIKE_VIP_ENABLED="false";
  assert.equal((await api(c1,"/api/vip/me")).status,404,
    "Feature kill switch must work immediately, even for existing sessions");

  process.stdout.write("VIP real Express session / cookie / role / CSRF / kill-switch tests passed\n");
 }finally{
  process.env.KINGLIKE_VIP_ENABLED="false";
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  await pool.end();
 }
}
main().catch(error=>{
 process.stderr.write((error instanceof Error?error.stack:String(error))+"\n");
 process.exitCode=1;
});
