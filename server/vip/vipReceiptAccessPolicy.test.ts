import {strict as assert} from "node:assert";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {canDownloadVipReceipt} from "./vipReceiptAccessPolicy";

const receipt=(overrides:Partial<Parameters<typeof canDownloadVipReceipt>[0]>={})=>({
  isAdmin:false,
  hasUnitEntitlement:false,
  isFinanceApprover:false,
  reviewStatus:"pending",
  uploadedBy:11,
  actorId:22,
  ...overrides,
});

test("finance reviewers can download only pending receipts uploaded by someone else",()=>{
  assert.equal(canDownloadVipReceipt(receipt({isFinanceApprover:true})),true);
  assert.equal(canDownloadVipReceipt(receipt({isFinanceApprover:true,uploadedBy:22})),false);
  assert.equal(canDownloadVipReceipt(receipt({isFinanceApprover:true,reviewStatus:"approved"})),false);
  assert.equal(canDownloadVipReceipt(receipt({isFinanceApprover:true,reviewStatus:"rejected"})),false);
  assert.equal(canDownloadVipReceipt(receipt()),false);
});

test("admin and active unit entitlements retain authorized historical access",()=>{
  assert.equal(canDownloadVipReceipt(receipt({isAdmin:true,reviewStatus:"approved"})),true);
  assert.equal(canDownloadVipReceipt(receipt({
    hasUnitEntitlement:true,reviewStatus:"rejected",uploadedBy:22,
  })),true);
});

test("receipt history and finance review APIs keep separate server authorization",()=>{
  const routes=readFileSync("server/vip/vipReceiptRoutes.ts","utf8");
  assert.match(routes,/app\.get\("\/api\/admin\/vip\/receipts",enabled,authenticated,adminOnly/);
  assert.match(routes,/review_status='pending' AND r\.uploaded_by<>\$1/);
  assert.match(routes,/FOR SHARE OF perm,staff/);
});
