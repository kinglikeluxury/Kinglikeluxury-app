import {test} from "node:test";
import {strict as assert} from "node:assert";
import {fxRateInput,internalCommissionInput,internalCommissionAction,commissionEstimate} from "./vipAdvancedFinanceRules";
test("FX rates require source, date and pair of different currencies",()=>{
 const r={baseCurrency:"USD",quoteCurrency:"GEL",rate:"2.70000000",effectiveDate:"2026-11-23",source:"Bank of Georgia",sourceReference:"Official quotation 2026-11-23",published:true};
 assert(fxRateInput.safeParse(r).success);
 assert(!fxRateInput.safeParse({...r,quoteCurrency:"USD"}).success);
 assert(!fxRateInput.safeParse({...r,effectiveDate:"2026-02-31"}).success);
 assert(!fxRateInput.safeParse({...r,sourceReference:"unknown"}).success);
});
test("commission records accept either percentage or fixed value, never both",()=>{
 const r={unitId:123,side:"expense",category:"employee",basisAmount:"139000.00",percentage:"1.0000",fixedAmount:null,currency:"USD",payeeLabel:"Sales employee",contractReference:"Signed agreement 2026/11",note:"Internal estimate"};
 assert(internalCommissionInput.safeParse(r).success);
 assert(!internalCommissionInput.safeParse({...r,fixedAmount:"2000.00"}).success);
 assert(!internalCommissionInput.safeParse({...r,percentage:"120.0000"}).success);
 assert(internalCommissionInput.safeParse({...r,basisAmount:null,percentage:null,fixedAmount:"2000.00"}).success);
 assert.equal(commissionEstimate({basis_amount:"139000.00",percentage:"1.0000",fixed_amount:null}),"1390.00");
 assert.equal(commissionEstimate({basis_amount:null,percentage:null,fixed_amount:"2000.00"}),"2000.00");
});
test("recording a real settlement requires an external reference",()=>{
 assert(internalCommissionAction.safeParse({action:"approve",note:"Finance reviewed this record",paymentReference:null}).success);
 assert(!internalCommissionAction.safeParse({action:"record_settlement",note:"Finance approved the transfer",paymentReference:null}).success);
});
