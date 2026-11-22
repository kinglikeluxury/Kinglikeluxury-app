import { test } from "node:test";
import { strict as assert } from "node:assert";
import { validateVipCameraUrl } from "./vipCameraSecurity";

test("camera links must be HTTPS on an exact provider allowlist",()=>{
 const list="video.example.com,camera.example.org";
 assert.equal(validateVipCameraUrl("https://video.example.com/live/1",list),"https://video.example.com/live/1");
 for(const url of [
   "http://video.example.com/live",
   "https://video.example.com.evil.test/live",
   "https://127.0.0.1/live",
   "https://localhost/live",
   "https://video.example.com:8080/live",
   "https://user:pass@video.example.com/live",
   "https://camera.example.org/live#fragment",
   "javascript:alert(1)"
 ]) assert.equal(validateVipCameraUrl(url,list),null,url);
 assert.equal(validateVipCameraUrl("https://video.example.com/live",undefined),null);
});
