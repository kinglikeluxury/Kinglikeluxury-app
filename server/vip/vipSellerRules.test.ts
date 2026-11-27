import {test} from "node:test";
import {strict as assert} from "node:assert";
import {validSellerAccount,validSellerReason,validSellerEmail} from "./vipSellerRules";
test("only active verified existing staff accounts can be assigned as selling agent",()=>{
 const staff={is_active:true,is_verified:true,is_admin:false,role:"sub_agent",email:"seller@example.com"};
 assert(validSellerAccount(staff));
 assert(validSellerAccount({...staff,role:"crm_employee"}));
 for(const change of [{role:"user"},{is_active:false},{is_verified:false},{is_admin:true},{email:null}]){
  assert(!validSellerAccount({...staff,...change}));
 }
});
test("seller assignment and reassignment require meaningful reason",()=>{
 assert(validSellerReason("This employee closed the transaction"));
 assert(!validSellerReason("quick"));
 assert(!validSellerReason("x".repeat(241)));
 assert(!validSellerReason("Client\nOther"));
 assert.equal(validSellerEmail(" SALES@EXAMPLE.COM "),"sales@example.com");
 assert.equal(validSellerEmail("none"),null);
});
