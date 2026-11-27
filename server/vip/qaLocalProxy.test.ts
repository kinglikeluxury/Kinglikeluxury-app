import {strict as assert} from "node:assert";
import {test} from "node:test";
import {
 QA_PROXY_HOST,QA_PROXY_PORT,QA_UPSTREAM_HOST,QA_UPSTREAM_PORT,
 proxyRequestPath,buildQaUpstreamRequestHeaders,selectQaSessionCookie,
 selectQaUpstreamSetCookies,mapQaUpstreamLocation
} from "./qaLocalProxy";

test("local QA proxy uses fixed, distinct loopback endpoints",()=>{
 assert.equal(QA_PROXY_HOST,"127.0.0.1");
 assert.equal(QA_UPSTREAM_HOST,"127.0.0.1");
 assert.notEqual(QA_PROXY_PORT,QA_UPSTREAM_PORT);
 assert(QA_PROXY_PORT>1024&&QA_UPSTREAM_PORT>1024);
});

test("proxy target accepts only origin-relative safe QA routes",()=>{
 for(const path of [
  "/","/health","/robots.txt","/vip","/api/auth/me",
  "/assets/app-abc123.js"
 ])assert.equal(proxyRequestPath(path),path);
 for(const path of [
  "http://outside.example/health","//outside.example/health",
  "/%2e%2e/.env","/%252e%252e%252fserver%252findex.ts",
  "/vip/%2e%2e/server/index.ts","/vip/%5c..%5c.env",
  "/server/index.ts","/.replit","/android/signing",
  "/path\\outside","/bad\u0000path"
 ])assert.equal(proxyRequestPath(path),undefined,`rejected ${JSON.stringify(path)}`);
});

test("proxy forwards only the QA session cookie and fixed upstream headers",()=>{
 const source={
  host:`127.0.0.1:${QA_PROXY_PORT}`,
  origin:`http://127.0.0.1:${QA_PROXY_PORT}`,
  authorization:"Basic synthetic-only",
  cookie:"unrelated=must-not-forward; kinglike.vip.qa.sid=qa-session; another=value",
  "x-forwarded-host":"attacker.example",
  "x-forwarded-for":"203.0.113.9",
  "x-forwarded-proto":"https",
  referer:"https://attacker.example/path",
  "content-type":"application/json",
  "content-length":"2",
  accept:"application/json"
 };
 const headers=buildQaUpstreamRequestHeaders(source);
 assert.equal(headers.host,`127.0.0.1:${QA_UPSTREAM_PORT}`);
 assert.equal(headers.origin,`http://127.0.0.1:${QA_UPSTREAM_PORT}`);
 assert.equal(headers.authorization,"Basic synthetic-only");
 assert.equal(headers.cookie,"kinglike.vip.qa.sid=qa-session");
 assert.equal(headers["content-type"],"application/json");
 assert.equal(headers["x-forwarded-host"],undefined);
 assert.equal(headers["x-forwarded-for"],undefined);
 assert.equal(headers["x-forwarded-proto"],undefined);
 assert.equal(headers.referer,undefined);
 assert.equal(selectQaSessionCookie("a=1; b=2"),undefined);
 assert.equal(selectQaSessionCookie("kinglike.vip.qa.sid=one; kinglike.vip.qa.sid=two"),undefined);
 assert.equal(selectQaSessionCookie("kinglike.vip.qa.sid=x".repeat(4000)),undefined);
});

test("proxy response cookies are restricted to the QA session",()=>{
 const cookies=selectQaUpstreamSetCookies([
  "kinglike.vip.qa.sid=synthetic; Path=/; HttpOnly; SameSite=Lax; Domain=127.0.0.1",
  "session=must-not-escape; Path=/",
  "kinglike.vip.qa.sid=second; Path=/"
 ]);
 assert.deepEqual(cookies,[
  "kinglike.vip.qa.sid=synthetic; Path=/; HttpOnly; SameSite=Lax",
  "kinglike.vip.qa.sid=second; Path=/"
 ]);
});

test("proxy rewrites only fixed-upstream redirects and rejects external redirects",()=>{
 assert.equal(mapQaUpstreamLocation("/vip"),"/vip");
 assert.equal(
  mapQaUpstreamLocation(`http://127.0.0.1:${QA_UPSTREAM_PORT}/vip?view=admin`),
  `http://127.0.0.1:${QA_PROXY_PORT}/vip?view=admin`
 );
 assert.equal(mapQaUpstreamLocation("https://outside.example/collect"),undefined);
 assert.equal(mapQaUpstreamLocation("//outside.example/collect"),undefined);
 assert.equal(mapQaUpstreamLocation("/\\outside.example/collect"),undefined);
 assert.equal(mapQaUpstreamLocation("javascript:alert(1)"),undefined);
 assert.equal(mapQaUpstreamLocation("/vip\r\nLocation: https://outside.example"),undefined);
});
