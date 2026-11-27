import {test} from "node:test";
import {strict as assert} from "node:assert";
import {supportTicketInput,supportMessageInput,supportAssignmentInput,validSupportTransition,validSupportId} from "./vipSupportRules";
test("support ticket and message validation",()=>{
 assert(supportTicketInput.safeParse({unitId:1,category:"payment",subject:"Payment followup",message:"I have a question about this installment."}).success);
 assert(!supportTicketInput.safeParse({unitId:0,category:"payment",subject:"Payment followup",message:"Some message"}).success);
 assert(!supportTicketInput.safeParse({unitId:1,category:"payment",subject:"x",message:"Some message"}).success);
 assert(!supportMessageInput.safeParse({message:""}).success);
 assert.equal(validSupportId("14"),14);
 assert.equal(validSupportId("1 OR 1=1"),null);
});
test("no arbitrary support workflow jumps",()=>{
 assert(validSupportTransition("open","in_progress"));
 assert(!validSupportTransition("closed","open"));
 assert(!validSupportTransition("open","open"));
 assert(!validSupportTransition("in_progress","open"));
 assert(supportAssignmentInput.safeParse({status:"in_progress",assigneeEmail:"employee@kinglikeluxury.com",dueAt:null,internalNote:"Assigned to assigned employee"}).success);
 assert(!supportAssignmentInput.safeParse({status:"in_progress",assigneeEmail:"invalid",dueAt:null,internalNote:"short"}).success);
});
