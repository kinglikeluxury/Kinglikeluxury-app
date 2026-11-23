import {test} from "node:test";
import {strict as assert} from "node:assert";
import {journeyInput,benefitInput,serviceRequestInput,nextServiceStatus,positiveVipId} from "./vipExperienceRules";
test("journey milestones require actual dates before completion",()=>{
 const base={stage:"contract",status:"completed",plannedDate:"2026-12-20",actualDate:null,note:"",published:true};
 assert(!journeyInput.safeParse(base).success);
 assert(journeyInput.safeParse({...base,actualDate:"2026-12-19"}).success);
 assert(!journeyInput.safeParse({...base,actualDate:"2026-02-31"}).success);
 assert(!journeyInput.safeParse({...base,stage:"keys_delivered"}).success);
});
test("benefits must explain approved terms, never vague promises",()=>{
 const benefit={title:"Finishing options",details:"A quotation can be requested; subject to approval.",category:"fit_out",validUntil:null,published:true};
 assert(benefitInput.safeParse(benefit).success);
 assert(!benefitInput.safeParse({...benefit,details:"Free!"}).success);
});
test("service requests require details and cannot jump statuses",()=>{
 assert(!serviceRequestInput.safeParse({unitId:1,type:"other",details:"ok"}).success);
 assert(serviceRequestInput.safeParse({unitId:1,type:"furnishing",details:"Kitchen installation quote"}).success);
 assert(nextServiceStatus("requested","reviewing"));
 assert(!nextServiceStatus("requested","completed"));
 assert(!nextServiceStatus("completed","requested"));
 assert.equal(positiveVipId("12"),12);
 assert.equal(positiveVipId("12.4"),null);
});
