import {test} from "node:test";
import {strict as assert} from "node:assert";
import {approveHandoverInput,buyerKeysAcknowledgmentInput,confirmKeysInput,canApproveHandover} from "./vipKeyReceiptRules";

test("handover requires completed inspection, all checks and no open snags",()=>{
 const pass={electrical:"passed",plumbing:"passed",windows:"passed",walls:"passed",fixtures:"passed",access:"passed"};
 assert(canApproveHandover("inspection_completed",0,pass));
 assert(!canApproveHandover("appointment_scheduled",0,pass));
 assert(!canApproveHandover("inspection_completed",1,pass));
 assert(!canApproveHandover("inspection_completed",0,{...pass,access:"issue"}));
});
test("approval and key delivery must be separately evidenced",()=>{
 const approve={developerReference:"DEV-LETTER-2027",note:"Inspected and approved by manager",acknowledgedNoOpenSnags:true};
 assert(approveHandoverInput.safeParse(approve).success);
 assert(!approveHandoverInput.safeParse({...approve,developerReference:"none"}).success);
 const buyer={receivedKeys:true,keyCount:2,receivedDate:"2027-09-30",note:"Two keys"};
 assert(buyerKeysAcknowledgmentInput.safeParse(buyer).success);
 assert(!buyerKeysAcknowledgmentInput.safeParse({...buyer,receivedKeys:false}).success);
 assert(!buyerKeysAcknowledgmentInput.safeParse({...buyer,receivedDate:"2027-02-31"}).success);
 assert(confirmKeysInput.safeParse({developerReference:"DEV-KEYS-2027",note:"Delivery verified with owner",confirmedPhysicalDelivery:true}).success);
 assert(!confirmKeysInput.safeParse({developerReference:"DEV-KEYS-2027",note:"Delivery verified with owner",confirmedPhysicalDelivery:false}).success);
});
