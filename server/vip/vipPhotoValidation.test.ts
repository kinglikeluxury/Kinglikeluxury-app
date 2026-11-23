import { test } from "node:test";
import { strict as assert } from "node:assert";
import { MAX_VIP_PHOTO_BYTES,validVipPhoto,vipDate } from "./vipPhotoValidation";
test("private construction photos accept only JPEG or PNG bytes",()=>{
 const jpeg=Buffer.from([255,216,255,224,0,16,74,70,73,70,1,2]);
 const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13]);
 assert.equal(validVipPhoto(jpeg),"image/jpeg");
 assert.equal(validVipPhoto(png),"image/png");
 assert.equal(validVipPhoto(Buffer.from("<svg><script>")),null);
 assert.equal(validVipPhoto(Buffer.alloc(MAX_VIP_PHOTO_BYTES+1)),null);
});
test("photo date rejects impossible calendar dates",()=>{
 assert.equal(vipDate("2026-11-22"),"2026-11-22");
 assert.equal(vipDate("2026-02-31"),null);
 assert.equal(vipDate("yesterday"),null);
});
