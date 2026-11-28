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
process.env.KINGLIKE_VIP_QA_EXPECTED_DB_ADDRESS="auto";
process.env.PORT="3000";
let fakeDatabaseAddress="10.21.4.7";
const fakeLookup=(hostname,...args)=>{
  const callback=args.at(-1);
  if(typeof callback!=="function")throw new Error("test resolver requires callback");
  if(hostname!==process.env.KINGLIKE_VIP_QA_EXPECTED_DB_HOST){
    queueMicrotask(()=>callback(Object.assign(new Error("not found"),{code:"ENOTFOUND"})));
    return;
  }
  const options=args[0]&&typeof args[0]==="object"?args[0]:{};
  if(options.all){
    queueMicrotask(()=>callback(null,[
      {address:fakeDatabaseAddress,family:4},
      {address:"fd12::7",family:6},
    ]));
    return;
  }
  queueMicrotask(()=>callback(null,fakeDatabaseAddress,4));
};
dns.lookup=fakeLookup;
dns.promises.lookup=async hostname=>{
  if(hostname!==process.env.KINGLIKE_VIP_QA_EXPECTED_DB_HOST){
    throw Object.assign(new Error("not found"),{code:"ENOTFOUND"});
  }
  return {address:fakeDatabaseAddress,family:4};
};
const networkGuard=await import("../qaRailwayNetworkGuard.mjs");

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
const allowedDatabaseAddress=await new Promise((resolve,reject)=>{
  dns.lookup(process.env.KINGLIKE_VIP_QA_EXPECTED_DB_HOST,(error,address,family)=>{
    if(error)return reject(error);
    assert.equal(family,4);
    resolve(address);
  });
});
assert.equal(allowedDatabaseAddress,"10.21.4.7");
assert.equal((await dns.promises.lookup(
  process.env.KINGLIKE_VIP_QA_EXPECTED_DB_HOST,
  {family:4},
)).address,"10.21.4.7");
assert.equal((await import("../qaRailwayNetworkGuard.mjs"))
  .getPinnedRailwayQaDatabaseAddress(),"10.21.4.7");
assertions+=3;
assert.equal(networkGuard.isAllowedRailwayQaListener("0.0.0.0",3000),true);
assert.equal(networkGuard.isAllowedRailwayQaListener("127.0.0.1",3000),false);
assert.equal(networkGuard.isAllowedRailwayQaListener("0.0.0.0",3001),false);
assert.throws(()=>new net.Server().listen(3001,"0.0.0.0"),error=>error?.code==="EACCES");
assert.throws(()=>new net.Server().listen(3000,"127.0.0.1"),error=>error?.code==="EACCES");
assertions+=5;
fakeDatabaseAddress="10.21.4.8";
await new Promise(resolve=>{
  dns.lookup(process.env.KINGLIKE_VIP_QA_EXPECTED_DB_HOST,error=>{
    assert.equal(error?.code,"EACCES");
    assertions++;
    resolve();
  });
});
fakeDatabaseAddress="203.0.113.7";
await assert.rejects(dns.promises.lookup(
  process.env.KINGLIKE_VIP_QA_EXPECTED_DB_HOST,
  {family:4},
),error=>error?.code==="EACCES");
assertions++;

process.stdout.write(`network guard denials verified: ${assertions}\n`);
