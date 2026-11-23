import {test} from "node:test";
import {strict as assert} from "node:assert";
import {newReferralCode,validReferralCode} from "./vipReferralLinkRules";

test("referral link uses a random unguessable 128-bit code",()=>{
 const code=newReferralCode();
 assert(validReferralCode(code));
 assert.notEqual(code,newReferralCode());
 for(const value of ["","KLR-1","KLR-0123/../","KLR-"+("Z".repeat(32)),null]){
  assert(!validReferralCode(value));
 }
});
