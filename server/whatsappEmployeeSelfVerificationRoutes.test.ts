import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import {
  employeeWhatsappVerificationState,
  registerEmployeeWhatsappVerificationRoutes,
  type EmployeeVerificationActor,
} from "./whatsappEmployeeSelfVerificationRoutes";

const samer:EmployeeVerificationActor={id:101,isActive:true,isAdmin:false,role:"sub_agent"};
const env:NodeJS.ProcessEnv={
  APP_DEPLOYMENT_MODE:"staging",
  WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_EMPLOYEE_ID:"101",
  WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED:"false",
  WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED:"false",
};
async function fixture(actor:EmployeeVerificationActor|null,fn:(base:string)=>Promise<void>) {
  const app=express();
  registerEmployeeWhatsappVerificationRoutes(app,{
    currentActor:async()=>actor,env,
  });
  const server=app.listen(0,"127.0.0.1");
  await once(server,"listening");
  try{
    const a=server.address();
    assert.ok(a&&typeof a!=="string");
    await fn("http://127.0.0.1:"+a.port);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
}

test("employee sees only their own read-only Meta verification status",async()=>{
  await fixture({...samer,role:"crm_employee"},async base=>{
    const response=await fetch(base+"/api/employee/whatsapp-meta-verification");
    assert.equal(response.status,200);
    assert.equal(response.headers.get("cache-control"),"no-store");
    const body=await response.json();
    assert.equal(body.mode,"employee_verification_only");
    assert.equal(body.status,"awaiting_company_setup");
    assert.equal(body.phoneConnected,false);
    assert.equal(body.employeeCanCancelEnrollment,false);
    assert.equal(body.employeeCanDisconnect,false);
    assert.deepEqual(body.availableActions,[]);
    for(const word of ["+995","101","wabaId","token","password"])
      assert.equal(JSON.stringify(body).includes(word),false);
    for(const method of ["POST","PUT","PATCH","DELETE"]){
      const altered=await fetch(base+"/api/employee/whatsapp-meta-verification",
        {method,headers:{"Content-Type":"application/json"},body:method==="DELETE"?undefined:"{}"});
      assert.equal(altered.status,404,method);
    }
  });
});
test("guest, admin, inactive and ordinary client are denied server-side",async()=>{
  for(const actor of [
    null,
    {...samer,isAdmin:true},
    {...samer,isActive:false},
    {...samer,role:"user"},
    {...samer,id:0},
  ]){
    await fixture(actor,async base=>{
      assert.equal((await fetch(base+"/api/employee/whatsapp-meta-verification")).status,403);
    });
  }
});
test("valid CRM employee role, foreign employee and production never infer verified enrollment",()=>{
  assert.equal(employeeWhatsappVerificationState(env,{...samer,role:"crm_employee"}),"awaiting_company_setup");
  assert.equal(employeeWhatsappVerificationState(env,{...samer,id:202}),"awaiting_company_setup");
  assert.equal(employeeWhatsappVerificationState({...env,APP_DEPLOYMENT_MODE:"production"},samer),"awaiting_company_setup");
  const asserted={...env,WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED:"true",
    WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED:"true"};
  assert.equal(employeeWhatsappVerificationState(asserted,samer),"awaiting_meta_verification");
});
