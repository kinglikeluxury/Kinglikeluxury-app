import assert from "node:assert/strict";
import childProcess from "node:child_process";
import dns from "node:dns";
import dgram from "node:dgram";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import workerThreads from "node:worker_threads";
import cluster from "node:cluster";

process.env.KINGLIKE_VIP_QA_DATABASE_URL=
  "postgresql://vipqa_runtime:synthetic-only@vip-pg.railway.internal:5432/vipqa_demo";
process.env.KINGLIKE_VIP_QA_EXPECTED_DB_HOST="vip-pg.railway.internal";
process.env.KINGLIKE_VIP_QA_EXPECTED_DB_NAME="vipqa_demo";
process.env.KINGLIKE_VIP_QA_EXPECTED_DB_ROLE="vipqa_runtime";
process.env.KINGLIKE_VIP_QA_EXPECTED_DB_ADDRESS="10.21.4.7";
await import("../qaRailwayNetworkGuard.mjs");

let assertions=0;
const throwsBlocked=(operation)=>{
  assert.throws(operation,error=>error?.code==="EACCES");
  assertions++;
};
throwsBlocked(()=>http.request("https://outside.invalid"));
throwsBlocked(()=>http.get("https://outside.invalid"));
throwsBlocked(()=>https.request("https://outside.invalid"));
throwsBlocked(()=>https.get("https://outside.invalid"));
throwsBlocked(()=>http2.connect("https://outside.invalid"));
throwsBlocked(()=>net.connect({host:"outside.invalid",port:443}));
throwsBlocked(()=>tls.connect({host:"outside.invalid",port:443}));
throwsBlocked(()=>dgram.createSocket("udp4"));
throwsBlocked(()=>new dgram.Socket({type:"udp4"}).send(Buffer.from("synthetic"),53,"outside.invalid"));
throwsBlocked(()=>childProcess.spawn("synthetic-command",[]));
throwsBlocked(()=>new workerThreads.Worker(new URL("data:text/javascript,0")));
throwsBlocked(()=>cluster.fork());
throwsBlocked(()=>dns.resolve4("outside.invalid",()=>{}));
throwsBlocked(()=>dns.resolveMx("outside.invalid",()=>{}));
throwsBlocked(()=>new dns.Resolver().resolveTxt("outside.invalid",()=>{}));
throwsBlocked(()=>dns.promises.resolveCname("outside.invalid"));

await assert.rejects(fetch("https://outside.invalid"),error=>error?.code==="EACCES");
assertions++;
await new Promise(resolve=>{
  dns.lookup("outside.invalid",error=>{
    assert.equal(error?.code,"EACCES");
    assertions++;
    resolve();
  });
});
await assert.rejects(dns.promises.lookup("outside.invalid"),error=>error?.code==="EACCES");
assertions++;

process.stdout.write(`network guard denials verified: ${assertions}\n`);
