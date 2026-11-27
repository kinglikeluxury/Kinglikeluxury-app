import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("private receipt download remains gated and checks current unit entitlement", () => {
  const source = readFileSync(new URL("./vipReceiptRoutes.ts", import.meta.url), "utf8");
  const download = source.slice(
    source.indexOf('app.get("/api/vip/receipts/:receiptId/download"'),
    source.indexOf("// Finance status is read live"),
  );

  assert.match(download, /,\s*enabled\s*,\s*authenticated\s*,/);
  assert.match(download, /a\.user_id=\$1 AND a\.unit_id=\$2 AND a\.revoked_at IS NULL/);
  assert.match(download, /a\.access_role='owner'/);
  assert.match(download, /a\.access_role='seller'/);
  assert.match(download, /validSellerAccount\(item\)/);
  assert.match(download, /if\(!canDownloadVipReceipt\(\{/);
  assert.match(download, /hasUnitEntitlement:activeEntitlement/);
  assert.match(download, /isFinanceApprover:financeApprover/);
  assert.match(download, /reviewStatus:review_status/);
  assert.match(download, /uploadedBy:Number\(uploaded_by\)/);
  assert.match(download, /Cache-Control","private, no-store/);
  assert.match(download, /X-Content-Type-Options","nosniff/);
});

test("finance queue is grant-only and contains only pending receipts from other users", () => {
  const source = readFileSync(new URL("./vipReceiptRoutes.ts", import.meta.url), "utf8");
  const queue = source.slice(
    source.indexOf('app.get("/api/admin/vip/finance/receipts"'),
    source.indexOf('app.get("/api/vip/receipts/:receiptId/download"'),
  );

  assert.match(queue, /,\s*enabled\s*,\s*authenticated\s*,\s*requireFinance\s*,/);
  assert.match(queue, /r\.review_status='pending'\s+AND\s+r\.uploaded_by<>\$1/);
  assert.match(queue, /ORDER BY r\.created_at ASC LIMIT 250/);
});
