import {test} from "node:test";
import {strict as assert} from "node:assert";
import {crmVerifiedSaleInput,crmAssociationId,buyerEmailMatches} from "./vipCrmBridgeRules";
test("CRM link requires explicit signed contract and human buyer validation",()=>{
 const input={leadId:123,signedSaleReference:"CONTRACT-2026-044",buyerIdentityConfirmed:true,contractActuallySigned:true,note:"Checked the buyer and signed contract"};
 assert(crmVerifiedSaleInput.safeParse(input).success);
 assert(!crmVerifiedSaleInput.safeParse({...input,contractActuallySigned:false}).success);
 assert(!crmVerifiedSaleInput.safeParse({...input,leadId:-4}).success);
 assert(!crmVerifiedSaleInput.safeParse({...input,signedSaleReference:"n/a"}).success);
});
test("Never attach a CRM lead with a conflicting known buyer email",()=>{
 assert(buyerEmailMatches("buyer@domain.com","BUYER@DOMAIN.COM"));
 assert(!buyerEmailMatches("other@domain.com","buyer@domain.com"));
 assert(buyerEmailMatches(null,"buyer@domain.com"));
 assert(!buyerEmailMatches(null,null));
 assert.equal(crmAssociationId("42"),42);
 assert.equal(crmAssociationId("42;DROP TABLE"),null);
});
