import assert from "node:assert/strict";
import {test} from "node:test";
import {
  readPrivateReceipt,
  removePrivateReceipt,
  savePrivateReceipt,
} from "./qaPreviewStorage";

test("local QA file adapter keeps synthetic files in process memory only", async () => {
  const source=Buffer.from("%PDF-1.7\nsynthetic QA file\n%%EOF");
  const key=await savePrivateReceipt(source,"application/pdf","pdf");
  source.fill(0);

  const read=await readPrivateReceipt(key);
  assert.match(key,/^kinglike-vip\/receipts\/[0-9a-f-]{36}\.pdf$/);
  assert.equal(read.toString(),"%PDF-1.7\nsynthetic QA file\n%%EOF");
  read.fill(0);
  assert.equal((await readPrivateReceipt(key)).toString(),"%PDF-1.7\nsynthetic QA file\n%%EOF");

  await removePrivateReceipt(key);
  await assert.rejects(readPrivateReceipt(key),/unavailable/);
});

test("local QA file adapter rejects unexpected prefixes and oversize content", async () => {
  await assert.rejects(readPrivateReceipt("outside/file.pdf"),/Invalid QA file key/);
  await assert.rejects(
    savePrivateReceipt(Buffer.alloc(10*1024*1024+1),"application/pdf","pdf"),
    /Invalid QA file/,
  );
});
