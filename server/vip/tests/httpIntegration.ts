import express from "express";
import type {AddressInfo} from "node:net";
import {strict as assert} from "node:assert";
import {pool} from "./localDbShim";
import {registerVipSupportRoutes} from "../vipSupportRoutes";
import {registerVipOperationsRoutes} from "../vipOperationsRoutes";
import {registerVipCrmBridgeRoutes} from "../vipCrmBridgeRoutes";
import {registerVipAdvancedFinanceRoutes} from "../vipAdvancedFinanceRoutes";
import {registerVipSellerRoutes} from "../vipSellerRoutes";
import {registerVipExperienceRoutes} from "../vipExperienceRoutes";
import {registerVipAccountingRoutes} from "../vipAccountingRoutes";
import {registerVipNotificationRoutes} from "../vipNotificationRoutes";
import {registerVipKeyReceiptRoutes} from "../vipKeyReceiptRoutes";
import {registerVipReferralLinkRoutes} from "../vipReferralLinkRoutes";
import {registerVipReceiptRoutes} from "../vipReceiptRoutes";
import {registerVipStatementRoutes} from "../vipStatementRoutes";

/**
 * HTTP integration test against disposable localhost PostgreSQL only.
 * Never imports production server/index or production DB credentials.
 * Authentication middleware below is fixture-only; route authorization and
 * database row-level scoping are the production modules under test.
 */
async function main(){
 // Foundation now tests the live users schema shape rather than a simplified
 // fixture. No production credentials or production data are consulted.

 async function user(email:string,role:string,admin=false){
  const r=await pool.query(
   "INSERT INTO users(username,email,role,is_verified,is_active,is_admin) "+
   "VALUES($1,$2,$3,TRUE,TRUE,$4) RETURNING id",
   ["vip_http_"+email.split("@")[0].replace(/[^a-z0-9_]/gi,"_"),email,role,admin]);
  return Number(r.rows[0].id);
 }
 const buyer=await user("http-buyer@qa.local","user");
 const stranger=await user("http-stranger@qa.local","user");
 const staff=await user("http-agent@qa.local","sub_agent");
 const manager=await user("http-admin@qa.local","user",true);
 const reviewer=await user("http-finance@qa.local","crm_employee");
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
 registerVipSellerRoutes(app,enabled,auth,admin);
 registerVipExperienceRoutes(app,enabled,auth,admin);
 registerVipAccountingRoutes(app,enabled,auth,admin);
 registerVipNotificationRoutes(app,enabled,auth,admin);
 registerVipKeyReceiptRoutes(app,enabled,auth,admin);
 registerVipReferralLinkRoutes(app,enabled,auth);
 registerVipReceiptRoutes(app,enabled,auth,admin);
 registerVipStatementRoutes(app,enabled,auth,admin);
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

  // Real HTTP account isolation: no guessed unit ID may expose another
  // buyer's investments or signed financial information.
  assert.equal((await api(stranger,"/api/vip/units/"+unit+"/account")).status,404);
  const ownerAccount=await api(buyer,"/api/vip/units/"+unit+"/account");
  assert.equal(ownerAccount.status,200,JSON.stringify(ownerAccount.body));
  assert.equal(ownerAccount.body.official,false);
  assert.equal((await api(staff,"/api/vip/units/"+unit+"/account")).status,404);

  // A buyer cannot publish project construction milestones, discounts,
  // or self-assign sales staff. These are owner/admin operations only.
  assert.equal((await api(buyer,"/api/admin/vip/units/"+unit+"/journey","PUT",{
    stage:"construction",status:"in_progress",plannedDate:"2027-09-01",
    actualDate:null,note:"Customer request",published:true
  })).status,403);
  assert.equal((await api(buyer,"/api/admin/vip/units/"+unit+"/seller","PUT",{
    email:"http-agent@qa.local",reason:"I wish to assign a sales agent"
  })).status,403);
  assert.equal((await api(staff,"/api/vip/seller/units/"+unit)).status,404);
  const sellerAssignment=await api(manager,"/api/admin/vip/units/"+unit+"/seller","PUT",{
    email:"http-agent@qa.local",reason:"Agent completed verified sales transaction"
  });
  assert.equal(sellerAssignment.status,200,JSON.stringify(sellerAssignment.body));
  assert.equal((await api(staff,"/api/vip/seller/units/"+unit)).status,200,
    "Assigned employee receives read-only file");
  assert.equal((await api(stranger,"/api/vip/seller/units/"+unit)).status,404);

  const journey=await api(manager,"/api/admin/vip/units/"+unit+"/journey","PUT",{
    stage:"construction",status:"in_progress",plannedDate:"2027-09-01",
    actualDate:null,note:"Construction progress published by management",published:true
  });
  assert.equal(journey.status,200,JSON.stringify(journey.body));
  const journeyVisible=await api(buyer,"/api/vip/units/"+unit+"/journey");
  assert.equal(journeyVisible.status,200);
  assert(journeyVisible.body.milestones.some((m:{stage_code:string})=>m.stage_code==="construction"));
  assert.equal((await api(stranger,"/api/vip/units/"+unit+"/journey")).status,404);

  // Buyer-facing fees must be sourced and published explicitly. An internal
  // accounting note cannot be made public by switching a visibility flag.
  const internal=await api(manager,"/api/admin/vip/units/"+unit+"/adjustments","POST",{
    category:"maintenance",amount:"2.06",currency:"USD",
    description:"Internal accounting draft for service maintenance",
    source:"internal_note",sourceReference:"",publish:false
  });
  assert.equal(internal.status,201,JSON.stringify(internal.body));
  const buyerFinancial=await api(buyer,"/api/vip/units/"+unit+"/account");
  assert.equal(buyerFinancial.status,200);
  assert.equal(buyerFinancial.body.adjustments.length,0,"Internal fees must remain hidden");
  assert.equal((await api(manager,"/api/admin/vip/adjustments/"+
    internal.body.adjustment.id,"PATCH",{action:"publish"})).status,409);

  // In-app notifications go to the current owner only; a stranger may
  // access their empty own inbox, never the buyer's notification data.
  const sent=await api(manager,"/api/admin/vip/units/"+unit+"/notifications","POST",{
    title:"New developer update",body:"Please review the latest approved project milestone."
  });
  assert.equal(sent.status,201,JSON.stringify(sent.body));
  const inbox=await api(buyer,"/api/vip/notifications");
  assert.equal(inbox.status,200);
  assert(inbox.body.notifications.some((n:{title:string})=>n.title==="New developer update"));
  const strangerInbox=await api(stranger,"/api/vip/notifications");
  assert.equal(strangerInbox.status,200);
  assert(!strangerInbox.body.notifications.some((n:{title:string})=>n.title==="New developer update"));
  const notifyId=inbox.body.notifications.find((n:{title:string})=>n.title==="New developer update").id;
  assert.equal((await api(stranger,"/api/vip/notifications/"+notifyId+"/read","POST",{})).status,404);
  assert.equal((await api(buyer,"/api/vip/notifications/"+notifyId+"/read","POST",{})).status,200);
  assert.equal((await api(buyer,"/api/vip/notification-preferences","PUT",{
    inAppDueReminders:false
  })).status,200);
  assert.equal((await api(buyer,"/api/vip/notification-preferences")).body.inAppDueReminders,false);

  // A card-style anonymous link never exposes client account information.
  const referral=await api(buyer,"/api/vip/referral-link","POST",{});
  assert.equal(referral.status,201,JSON.stringify(referral.body));
  const invitationCode=referral.body.link.code;
  assert(/^KLR-[A-F0-9]{32}$/.test(invitationCode));
  const publicLookup=await api(0,"/api/vip/referral-share/"+invitationCode);
  assert.equal(publicLookup.status,200);
  assert.deepEqual(publicLookup.body,{valid:true});
  const disabledLink=await api(0,"/api/vip/referral-share/KLR-BAD");
  assert.deepEqual(disabledLink.body,{valid:false});

  // Handover signoff must not be bypassed by sending a key count when the
  // developer has not approved the unit's physical inspection.
  assert.equal((await api(buyer,"/api/vip/units/"+unit+"/keys/acknowledge","POST",{
    receivedKeys:true,keyCount:2,receivedDate:"2026-11-21",note:""
  })).status,409);
  assert.equal((await api(stranger,"/api/vip/units/"+unit+"/keys")).status,404);
  assert.equal((await api(buyer,"/api/vip/units/"+unit+"/keys")).status,200);

  // Protected, actual multipart receipt upload -> separate finance reviewer ->
  // posting -> tenant isolation, using ONLY an in-memory storage adapter.
  const installment=(await pool.query(
    "INSERT INTO vip_installments(unit_id,sequence_number,due_date,amount,currency) "+
    "VALUES($1,1,'2027-07-01',120,'USD') RETURNING id",[unit])).rows[0].id;
  const form=new FormData();
  const pdf="%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n";
  form.set("receipt",new Blob([pdf],{type:"application/pdf"}),"bank-transfer.pdf");
  form.set("source","client");
  const receiptResponse=await fetch(base+"/api/vip/installments/"+installment+"/receipts",{
   method:"POST",headers:{"x-vip-fixture-user":String(buyer),Origin:base},body:form
  });
  assert.equal(receiptResponse.status,201,await receiptResponse.text().then(t=>t.slice(0,500)));
  // The file had a valid PDF signature, but payment remains pending until a
  // different active, finance-granted reviewer confirms an exact amount.
  const receiptList=await api(buyer,"/api/vip/units/"+unit+"/receipts");
  assert.equal(receiptList.status,200,JSON.stringify(receiptList.body));
  assert.equal(receiptList.body.receipts.length,1);
  assert.equal(receiptList.body.receipts[0].review_status,"pending");
  const receiptId=receiptList.body.receipts[0].id;
  assert.equal((await api(stranger,"/api/vip/units/"+unit+"/receipts")).status,404);
  assert.equal((await api(stranger,"/api/vip/receipts/"+receiptId+"/download")).status,404);

  // Permission revocation on the MAIN app must take effect without
  // waiting for an explicit VIP assignment edit. Reusing a seller grant
  // after staff demotion must not expose customer financial attachments.
  assert.equal((await api(staff,"/api/vip/seller/units/"+unit)).status,200);
  assert.equal((await api(staff,"/api/vip/receipts/"+receiptId+"/download")).status,200,
    "Verified, assigned active sales employee may download their buyer's receipt");
  await pool.query("UPDATE users SET role='user' WHERE id=$1",[staff]);
  assert.equal((await api(staff,"/api/vip/seller/units")).status,403,
    "Former sales employee must lose seller menu access immediately");
  assert.equal((await api(staff,"/api/vip/seller/units/"+unit)).status,404,
    "Former sales employee must not discover whether that customer file exists");
  assert.equal((await api(staff,"/api/vip/receipts/"+receiptId+"/download")).status,404,
    "Former sales employee cannot download receipt from a stale VIP grant");
  await pool.query("UPDATE users SET role='sub_agent' WHERE id=$1",[staff]);
  assert.equal((await api(staff,"/api/vip/seller/units/"+unit)).status,200,
    "Restored verified sales account may use its still-active unit assignment");


  const fileResponse=await fetch(base+"/api/vip/receipts/"+receiptId+"/download",{
    headers:{"x-vip-fixture-user":String(buyer),Origin:base}
  });
  assert.equal(fileResponse.status,200);
  assert.equal(await fileResponse.text(),pdf);
  assert.equal((await api(buyer,"/api/admin/vip/receipts/"+receiptId+"/review","POST",{
   decision:"approve",verifiedAmount:"50.00",note:"Owner tried approving own payment"
  })).status,403);
  assert.equal((await api(reviewer,"/api/admin/vip/receipts/"+receiptId+"/review","POST",{
   decision:"approve",verifiedAmount:"50.00",note:"Unassigned reviewer"
  })).status,403);
  const grant=await api(manager,"/api/admin/vip/finance-permissions","POST",{
    email:"http-finance@qa.local"
  });
  assert.equal(grant.status,200,JSON.stringify(grant.body));
  assert.equal((await api(reviewer,"/api/admin/vip/finance/me")).body.canApprove,true);
  // The permission row must NOT outlive the employee's eligible role.
  // Changing staff role in the original app immediately suspends authority to
  // approve financial evidence; the upload must remain unverified.
  await pool.query("UPDATE users SET role='user' WHERE id=$1",[reviewer]);
  assert.equal((await api(reviewer,"/api/admin/vip/finance/me")).body.canApprove,false,
    "Demoted staff cannot keep old finance approval privileges");
  assert.equal((await api(reviewer,"/api/admin/vip/receipts")).status,403,
    "Demoted reviewer cannot list other clients' payment receipts");
  assert.equal((await api(reviewer,"/api/admin/vip/receipts/"+receiptId+"/review","POST",{
    decision:"approve",verifiedAmount:"50.00",note:"Attempt after finance role removal"
  })).status,403,"Demoted reviewer cannot approve even with old grant row");
  const remainsPending=await pool.query(
    "SELECT review_status FROM vip_receipts WHERE id=$1",[receiptId]);
  assert.equal(remainsPending.rows[0]?.review_status,"pending");
  const noPosting=await pool.query(
    "SELECT COUNT(*)::int AS count FROM vip_payment_postings WHERE receipt_id=$1",[receiptId]);
  assert.equal(noPosting.rows[0]?.count,0);
  await pool.query("UPDATE users SET role='crm_employee' WHERE id=$1",[reviewer]);
  assert.equal((await api(reviewer,"/api/admin/vip/finance/me")).body.canApprove,true);
  const financeReview=await api(reviewer,"/api/admin/vip/receipts/"+receiptId+"/review","POST",{
   decision:"approve",verifiedAmount:"50.00",note:"Bank proof reviewed against transfer"
  });
  assert.equal(financeReview.status,200,JSON.stringify(financeReview.body));
  assert.equal((await api(reviewer,"/api/admin/vip/receipts/"+receiptId+"/review","POST",{
   decision:"approve",verifiedAmount:"50.00",note:"Try to repeat the same posting"
  })).status,409,"Receipt cannot be posted twice");
  const financeTotals=await api(buyer,"/api/vip/units/"+unit+"/account");
  assert.equal(financeTotals.status,200);
  assert.equal(financeTotals.body.totals.length,1);
  assert.equal(financeTotals.body.totals[0].verified_paid,"50.00");
  assert.equal(financeTotals.body.totals[0].outstanding,"70.00");
  assert.equal((await api(stranger,"/api/vip/units/"+unit+"/account")).status,404);
  const disable=await api(manager,"/api/admin/vip/finance-permissions","DELETE",{
    email:"http-finance@qa.local"
  });
  assert.equal(disable.status,200,JSON.stringify(disable.body));
  assert.equal((await api(reviewer,"/api/admin/vip/finance/me")).body.canApprove,false);

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
  assert.equal((await api(staff,"/api/vip/seller/units/"+unit)).status,404,
    "Selling agent loses file access immediately after buyer revocation");
  assert.equal((await api(buyer,"/api/vip/units/"+unit+"/journey")).status,404);
  assert.equal((await api(buyer,"/api/vip/units/"+unit+"/account")).status,404);
  assert.equal((await api(buyer,"/api/vip/units/"+unit+"/keys")).status,404);
  const revokedInbox=await api(buyer,"/api/vip/notifications");
  assert.equal(revokedInbox.status,200);
  assert(!revokedInbox.body.notifications.some((n:{title:string})=>n.title==="New developer update"),
    "Revoked owner must no longer see messages connected to the unit");
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
