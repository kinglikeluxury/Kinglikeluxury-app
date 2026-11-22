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
 // Official RTSP.RUN HTTPS viewer pages work without arbitrary host allowlisting.
 assert.equal(validateVipCameraUrl("https://rtsp.run/en/demo",undefined),"https://rtsp.run/en/demo");
 assert.equal(validateVipCameraUrl("https://www.rtsp.run/en/demo",undefined),"https://www.rtsp.run/en/demo");
 assert.equal(validateVipCameraUrl("rtsp://camera.example.com/live",list),null);
 assert.equal(validateVipCameraUrl("https://rtsp.run.evil.example/en/demo",undefined),null);
 assert.equal(validateVipCameraUrl("https://rtsp.run/play?password=secret",undefined),null);
 assert.equal(validateVipCameraUrl("https://rtsp.run/play?source=rtsp%3A%2F%2Fsomewhere",undefined),null);
});
