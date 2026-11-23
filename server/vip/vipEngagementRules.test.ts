import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  normalizedReferralName,normalizedReferralPhone,newMembershipCode,validMembershipCode,
  canTransitionReferral,canTransitionReward,isVipTier
} from "./vipEngagementRules";

test("phone numbers require international E.164 format",()=>{
  assert.equal(normalizedReferralPhone("+995555123456"),"+995555123456");
  assert.equal(normalizedReferralPhone("+905551234567"),"+905551234567");
  for(const bad of ["0555123456","+00","+123","995555123456","+995 555 123456","+12345678901234567",""])assert.equal(normalizedReferralPhone(bad),null);
});
test("names sanitize controls and disallow markup",()=>{
  assert.equal(normalizedReferralName("  Sarah   Ali "),"Sarah Ali");
  assert.equal(normalizedReferralName("<script>"),null);
  assert.equal(normalizedReferralName("a"),null);
});
test("public card codes are high-entropy and never contain personal data",()=>{
  const code=newMembershipCode();
  assert(validMembershipCode(code));
  assert.notEqual(code,newMembershipCode());
  assert.equal(validMembershipCode("KLV-1"),false);
});
test("referrals cannot auto-convert and rewards cannot auto-fulfill",()=>{
  assert(canTransitionReferral("new","contacted"));
  assert(!canTransitionReferral("new","converted"));
  assert(!canTransitionReferral("converted","new"));
  assert(canTransitionReferral("qualified","converted"));
  assert(canTransitionReward("proposed","approved"));
  assert(!canTransitionReward("proposed","fulfilled"));
  assert(canTransitionReward("approved","fulfilled"));
  assert(isVipTier("Platinum"));
  assert(!isVipTier("Diamond"));
});
