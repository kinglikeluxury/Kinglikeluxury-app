import {strict as assert} from "node:assert";
import {test} from "node:test";
import {isAllowedVipQaReceiptUpload} from "./qaSyntheticUploadPolicy";

test("Railway QA accepts only synthetic receipt names and internal sources",()=>{
  const base={runtime:"railway",previewEnabled:true,normalizedFileName:"synthetic-receipt.pdf"};
  assert.equal(isAllowedVipQaReceiptUpload({...base,isAdmin:false,source:"client"}),true);
  assert.equal(isAllowedVipQaReceiptUpload({...base,isAdmin:true,source:"admin"}),true);
  assert.equal(isAllowedVipQaReceiptUpload({...base,isAdmin:true,source:"email"}),false);
  assert.equal(isAllowedVipQaReceiptUpload({...base,isAdmin:true,source:"whatsapp"}),false);
  assert.equal(isAllowedVipQaReceiptUpload({...base,isAdmin:false,source:"admin"}),false);
  assert.equal(isAllowedVipQaReceiptUpload({
    ...base,isAdmin:false,source:"client",normalizedFileName:"receipt.pdf",
  }),false);
});

test("non-Railway local and production upload policy stays unchanged",()=>{
  for(const runtime of [undefined,"local"]){
    assert.equal(isAllowedVipQaReceiptUpload({
      runtime,previewEnabled:false,isAdmin:true,source:"whatsapp",normalizedFileName:"receipt.pdf",
    }),true);
  }
  assert.equal(isAllowedVipQaReceiptUpload({
    runtime:"railway",previewEnabled:false,isAdmin:true,source:"email",
    normalizedFileName:"receipt.pdf",
  }),true);
});
