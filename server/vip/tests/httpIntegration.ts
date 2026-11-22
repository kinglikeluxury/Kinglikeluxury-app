import express from "express";
import type {AddressInfo} from "node:net";
import {strict as assert} from "node:assert";
import {pool} from "./localDbShim";
import {registerVipSupportRoutes} from "../vipSupportRoutes";
import {registerVipOperationsRoutes} from "../vipOperationsRoutes";
import {registerVipCrmBridgeRoutes} from "../vipCrmBridgeRoutes";
import {registerVipAdvancedFinanceRoutes} from "../vipAdvancedFinanceRoutes";

/**
 * HTTP integration test against disposable localhost PostgreSQL only.
 * Never imports production server/index or production DB credentials.
 * Authentication middleware below is fixture-only; route authorization and
 * database row-level scoping are the production modules under test.
 */
async function main(){
 await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'");
 await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT TRUE");
 await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE");

 async function user(email:string,role:string,admin=false){
  const r=await pool.query(
   "INSERT INTO users(email,role,is_verified,is_active,is_admin) "+
   "VALUES($1,$2,TRUE,TRUE,$3) RETURNING id",[email,role,admin]);
  return Number(r.rows[0].id);
 }
 const buyer=await user("http-buyer@qa.local","user");
 const stranger=await user("http-stranger@qa.local","user");
 const staff=await user("http-agent@qa.local","sub_agent");
 const manager=await user("http-admin@qa.local","user",true);
 const project=(await pool.query("INSERT INTO vip_projects(name) VALUES('HTTP isolated QA') RETURNING id")).rows[0].id;
 const unit=(await pool.query(
  "INSERT INTO vip_units(project_id,unit_number) VALUES($1,'HTTP-101') RETURNING id",[project])).rows[0].id;
 await pool.query("INSERT INTO vip_unit_access(unit_id,user_id,access_role) VALUES($1,$2,'owner')",[unit,buyer]);

 const app=express();app.use(express.json({limit:"16kb"}));
 app.use((req,res,next)=>{
  const id=Number(req.get("x-vip-fixture-user"));
  res.locals.vipUser={id,isAdmin:id===manager};next();
 });
 const enabled=(_req:express.Request,_res:express.Response,next:express.NextFunction)=>next();
 const auth=(_req:express.Request,res:express.Response,next:express.NextFunction)=>{
  if(!Number.isSafeInteger(res.locals.vipUser?.id)||res.locals.vipUser.id<=0)return res.status(401).json({error:"Fixture authentication required"});
  next();
 };
 const admin=(_req:express.Request,res:express.Response,next:express.NextFunction)=>{
  if(!res.locals.vipUser?.isAdmin)return res.status(403).json({error:"Admin required"});
  next();
 };
 registerVipSupportRoutes(app,enabled,auth,admin);
 registerVipOperationsRoutes(app,enabled,auth,admin);
 registerVipCrmBridgeRoutes(app,enabled,auth,admin);
 registerVipAdvancedFinanceRoutes(app,enabled,auth,admin);
 const server=app.listen(0,"127.0.0.1");
 await new Promise<void>((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject)});
 const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
 async function api(userId:number,path:string,method="GET",body?:unknown){
  const headers:Record<string,string>={"x-vip-fixture-user":String(userId),Origin:base};
  if(body!==undefined)headers["Content-Type"]="application/json";
  const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const result=await r.json().catch(()=>({}));
  return {status:r.status,body:result};
 }
 try{
  const created=await api(buyer,"/api/vip/support","POST",{
   unitId:Number(unit),category:"payment",subject:"Question about payment",
   message:"Please explain the outstanding payment schedule."
  });
  assert.equal(created.status,201,JSON.stringify(created.body));
  const ticketId=created.body.ticket.id;
  assert(ticketId,"Ticket id returned");
  assert.equal((await api(stranger,"/api/vip/support/"+ticketId)).status,404,"Another buyer cannot read ticket");
  assert.equal((await api(staff,"/api/vip/support/"+ticketId)).status,404,"Unassigned staff cannot read ticket");
  assert.equal((await api(buyer,"/api/vip/support/"+ticketId)).status,200,"Owner can read ticket");
  assert.equal((await api(buyer,"/api/admin/vip/support")).status,403,"Buyer cannot access support management");
  assert.equal((await api(stranger,"/api/admin/vip/audit")).status,403,"Audit requires admin");

  const assign=await api(manager,"/api/admin/vip/support/"+ticketId,"PATCH",{
    status:"in_progress",assigneeEmail:"http-agent@qa.local",
    dueAt:null,internalNote:"Assigned to sales support desk for payment review"
  });
  assert.equal(assign.status,200,JSON.stringify(assign.body));
  const staffView=await api(staff,"/api/vip/support/"+ticketId);
  assert.equal(staffView.status,200,"Assigned and verified staff can read");
  assert.equal(staffView.body.messages.length,1);
  const response=await api(staff,"/api/vip/support/"+ticketId+"/reply","POST",{
    message:"Your request has been escalated to the financial desk."
  });
  assert.equal(response.status,201,JSON.stringify(response.body));
  const ownerView=await api(buyer,"/api/vip/support/"+ticketId);
  assert.equal(ownerView.status,200);
  assert.equal(ownerView.body.messages.length,2,"Owner can read response from authorized staff");

  const insights=await api(manager,"/api/admin/vip/insights");
  assert.equal(insights.status,200,JSON.stringify(insights.body));
  assert(Number(insights.body.metrics.open_support)>=1,"Executive dashboard reflects support queue");
  assert.equal((await api(buyer,"/api/admin/vip/insights")).status,403);
  const audit=await api(manager,"/api/admin/vip/audit");
  assert.equal(audit.status,200);
  assert(audit.body.events.some((e:{event_type:string})=>e.event_type==="vip_support_replied"));

  // CRM credentials are intentionally missing: must fail closed without
  // importing or mutating existing production CRM data.
  const crmUnavailable=await api(manager,"/api/admin/vip/crm/leads/1");
  assert.equal(crmUnavailable.status,503,"No CRM read-only secret means no access");

  // End buyer ownership and assert seller/support access is revoked too.
  await pool.query("UPDATE vip_unit_access SET revoked_at=NOW() "+
    "WHERE unit_id=$1 AND user_id=$2 AND access_role='owner' AND revoked_at IS NULL",
    [unit,buyer]);
  assert.equal((await api(buyer,"/api/vip/support/"+ticketId)).status,404,"Revoked buyer access stops");
  assert.equal((await api(staff,"/api/vip/support/"+ticketId)).status,404,"Assigned staff loses access when buyer ownership ends");
  const staffList=await api(staff,"/api/vip/support");
  assert.equal(staffList.status,200);
  assert(!staffList.body.tickets.some((t:{id:string})=>t.id===ticketId));

  process.stdout.write("VIP real HTTP role-isolation smoke tests passed (temporary localhost PostgreSQL)\n");
 }finally{
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  await pool.end();
 }
}
main().catch(e=>{process.stderr.write((e instanceof Error?e.stack:String(e))+"\n");process.exitCode=1});
