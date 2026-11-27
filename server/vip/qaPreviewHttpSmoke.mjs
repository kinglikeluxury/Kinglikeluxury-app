import assert from "node:assert/strict";

const base=new URL(process.env.QA_BASE||"");
if(base.protocol!=="http:"||
  !["127.0.0.1","localhost","::1","[::1]"].includes(base.hostname)||
  !base.port||base.username||base.password||base.search||base.hash){
  throw new Error("VIP QA HTTP smoke test accepts loopback URLs only");
}
const gateUser=process.env.QA_GATE_USER||"";
const gatePassword=process.env.QA_GATE_PASSWORD||"";
const testPassword=process.env.QA_TEST_PASSWORD||"";
const otherUnitId=process.env.QA_OTHER_UNIT_ID||"";
if(gateUser.length<4||gatePassword.length<20||testPassword.length<16||
  !/^[1-9]\d*$/.test(otherUnitId)){
  throw new Error("Synthetic VIP QA smoke credentials and unit fixture are required");
}
const authorization="Basic "+Buffer.from(`${gateUser}:${gatePassword}`).toString("base64");

async function get(path,{auth=true,cookie=""}={}){
  const headers={};
  if(auth)headers.Authorization=authorization;
  if(cookie)headers.Cookie=cookie;
  return fetch(new URL(path,base),{headers,redirect:"manual"});
}
async function login(username){
  const response=await fetch(new URL("/api/auth/login",base),{
    method:"POST",
    headers:{
      Authorization:authorization,
      Origin:base.origin,
      "Content-Type":"application/json",
    },
    body:JSON.stringify({username,password:testPassword}),
    redirect:"manual",
  });
  assert.equal(response.status,200,`synthetic ${username} login`);
  const cookie=response.headers.get("set-cookie")?.split(";")[0]||"";
  assert.match(cookie,/^kinglike\.vip\.qa\.sid=/);
  return cookie;
}

const statuses={
  healthNoBasic:(await get("/health",{auth:false})).status,
  homeNoBasic:(await get("/",{auth:false})).status,
  apiNoBasic:(await get("/api/vip/me",{auth:false})).status,
  healthWithBasic:(await get("/health")).status,
  homeWithBasic:(await get("/")).status,
  meNoSession:(await get("/api/auth/me")).status,
  serviceWorker:(await get("/sw.js")).status,
};
assert.deepEqual([
  statuses.healthNoBasic,statuses.homeNoBasic,statuses.apiNoBasic,
  statuses.healthWithBasic,statuses.homeWithBasic,statuses.meNoSession,
  statuses.serviceWorker,
],[401,401,401,200,302,401,404]);

const buyerCookie=await login("qa_buyer_a");
const buyerMe=await get("/api/auth/me",{cookie:buyerCookie});
assert.equal(buyerMe.status,200);
const buyerUnits=await (await get("/api/vip/me",{cookie:buyerCookie})).json();
assert.equal(buyerUnits.units.length,1);
const otherUnit=await get(`/api/vip/units/${otherUnitId}/account`,{cookie:buyerCookie});
assert.equal(otherUnit.status,404);
const buyerAdmin=await get("/api/admin/vip/overview",{cookie:buyerCookie});
assert.equal(buyerAdmin.status,403);

const sellerCookie=await login("qa_seller");
const sellerUnits=await (await get("/api/vip/seller/units",{cookie:sellerCookie})).json();
assert.equal(sellerUnits.units.length,1);
const sellerOther=await get(`/api/vip/seller/units/${otherUnitId}`,{cookie:sellerCookie});
assert.equal(sellerOther.status,404);

const adminCookie=await login("qa_admin");
const adminOverview=await get("/api/admin/vip/overview",{cookie:adminCookie});
assert.equal(adminOverview.status,200);

const page=await get("/vip");
assert.equal(page.status,200);
const html=await page.text();
const scriptPath=html.match(/src="([^"]+\.js)"/i)?.[1];
assert.ok(scriptPath,"built SPA script path");
assert.equal((await get(scriptPath,{auth:false})).status,401);
assert.equal((await get(scriptPath)).status,200);

console.log(JSON.stringify({
  ...statuses,
  buyerLogin:200,
  buyerMe:buyerMe.status,
  buyerOwnUnits:buyerUnits.units.length,
  buyerCrossUnit:otherUnit.status,
  buyerAdmin:buyerAdmin.status,
  sellerLogin:200,
  sellerAssignedUnits:sellerUnits.units.length,
  sellerCrossUnit:sellerOther.status,
  adminLogin:200,
  adminOverview:adminOverview.status,
  vipPage:page.status,
  staticNoBasic:401,
  staticWithBasic:200,
}));
