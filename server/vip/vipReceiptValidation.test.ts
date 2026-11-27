import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  amountToCents, centsToAmount, inspectReceiptFile, normalizeReceiptName,
  MAX_VIP_RECEIPT_BYTES
} from "./vipReceiptValidation";

test("receipt type requires actual PDF signature and EOF", () => {
  const valid=Buffer.from("%PDF-1.7\n1 0 obj\nendobj\n%%EOF\n");
  assert.deepEqual(inspectReceiptFile(valid),{mime:"application/pdf",extension:"pdf"});
  assert.equal(inspectReceiptFile(Buffer.from("%PDF-bad data no trailer")),null);
  assert.equal(inspectReceiptFile(Buffer.from("<script>alert(1)</script>")),null);
});

test("receipt signatures accept JPEG and PNG only", () => {
  const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46]);
  const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0]);
  assert.deepEqual(inspectReceiptFile(jpeg),{mime:"image/jpeg",extension:"jpg"});
  assert.deepEqual(inspectReceiptFile(png),{mime:"image/png",extension:"png"});
  assert.equal(inspectReceiptFile(Buffer.alloc(5)),null);
  assert.equal(inspectReceiptFile(Buffer.alloc(MAX_VIP_RECEIPT_BYTES+1)),null);
});

test("file names remove traversal characters", () => {
  const safe=normalizeReceiptName("../../invoice<script>.pdf");
  assert(!safe.includes("/"));
  assert(!safe.includes("<"));
  assert(safe.length<=120);
});

test("money parse is exact, positive and limited to two decimals", () => {
  assert.equal(amountToCents("1250.05"),BigInt(125005));
  assert.equal(amountToCents("0.01"),BigInt(1));
  assert.equal(amountToCents("100"),BigInt(10000));
  for(const bad of ["-1","0","0.00","1.001","1e3","Infinity","01.2","0,01",""]) {
    assert.equal(amountToCents(bad),null,bad);
  }
  assert.equal(centsToAmount(BigInt(125005)),"1250.05");
  assert.equal(centsToAmount(BigInt(1)),"0.01");
});
