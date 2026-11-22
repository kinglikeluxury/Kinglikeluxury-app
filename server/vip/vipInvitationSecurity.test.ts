import { strict as assert } from "node:assert";
import { test } from "node:test";
import { allowedVipInviteRecipient, hashInvitationToken, newInvitationToken,
 normalizedVipEmail, sameEmail, validInvitationToken, validNewVipPassword, vipActivationLink, safeEmailMarkup
} from "./vipInvitationSecurity";

test("invitation tokens have 256 bits of randomness and are only stored hashed",()=>{
  const t = newInvitationToken();
  assert.equal(t.length,64);
  assert.ok(validInvitationToken(t));
  assert.equal(hashInvitationToken(t).length,64);
  assert.notEqual(hashInvitationToken(t),t);
  assert.notEqual(newInvitationToken(),t);
  assert.equal(validInvitationToken("x".repeat(64)),false);
});

test("email comparison normalizes case but not identity",()=>{
  assert.equal(normalizedVipEmail(" CUSTOMER@EXAMPLE.COM "), "customer@example.com");
  assert.equal(sameEmail("Customer@Example.com","customer@example.com"),true);
  assert.equal(sameEmail("customer2@example.com","customer@example.com"),false);
  assert.equal(normalizedVipEmail("bad address"),null);
});

test("VIP password strength and markup",()=>{
  assert.ok(validNewVipPassword("SecureClient1298!"));
  assert.equal(validNewVipPassword("weakpass"),false);
  assert.equal(validNewVipPassword("ALLCAPS12345"),false);
  assert.equal(safeEmailMarkup("<script>&"),"&lt;script&gt;&amp;");
});

test("no invitations are sent without explicit email flag and recipient allowlist",()=>{
  const oldEnabled=process.env.KINGLIKE_VIP_EMAIL_ENABLED;
  const oldAllow=process.env.KINGLIKE_VIP_INVITE_ALLOWED_EMAILS;
  const oldLive=process.env.KINGLIKE_VIP_EMAIL_LIVE_APPROVED;
  try {
    process.env.KINGLIKE_VIP_EMAIL_ENABLED="false";
    process.env.KINGLIKE_VIP_INVITE_ALLOWED_EMAILS="a@example.com";
    process.env.KINGLIKE_VIP_EMAIL_LIVE_APPROVED="false";
    assert.equal(allowedVipInviteRecipient("a@example.com"),false);
    process.env.KINGLIKE_VIP_EMAIL_ENABLED="true";
    assert.equal(allowedVipInviteRecipient("other@example.com"),false);
    assert.equal(allowedVipInviteRecipient("a@example.com"),true);
  } finally {
    if(oldEnabled===undefined)delete process.env.KINGLIKE_VIP_EMAIL_ENABLED; else process.env.KINGLIKE_VIP_EMAIL_ENABLED=oldEnabled;
    if(oldAllow===undefined)delete process.env.KINGLIKE_VIP_INVITE_ALLOWED_EMAILS; else process.env.KINGLIKE_VIP_INVITE_ALLOWED_EMAILS=oldAllow;
    if(oldLive===undefined)delete process.env.KINGLIKE_VIP_EMAIL_LIVE_APPROVED; else process.env.KINGLIKE_VIP_EMAIL_LIVE_APPROVED=oldLive;
  }
});

test("activation links require HTTPS and carry token only in query",()=>{
  const old=process.env.KINGLIKE_VIP_BASE_URL;
  try {
    process.env.KINGLIKE_VIP_BASE_URL="https://example.com";
    const t=newInvitationToken();
    assert.equal(new URL(vipActivationLink(t)).searchParams.get("token"),t);
    process.env.KINGLIKE_VIP_BASE_URL="http://example.com";
    assert.throws(()=>vipActivationLink(t));
  } finally {
    if(old===undefined)delete process.env.KINGLIKE_VIP_BASE_URL;
    else process.env.KINGLIKE_VIP_BASE_URL=old;
  }
});
