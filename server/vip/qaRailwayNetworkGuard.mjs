import dns from "node:dns";
import dgram from "node:dgram";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import childProcess from "node:child_process";
import workerThreads from "node:worker_threads";
import cluster from "node:cluster";

const blocked=()=>{
  const error=new Error("Outbound traffic is disabled in Railway VIP QA");
  error.code="EACCES";
  return error;
};
const denyRequest=function(){throw blocked();};

const forbiddenEnv=/^(?:DATABASE_URL|NEON_DATABASE_URL|CLOUDINARY_|RESEND_API_KEY$|GMAIL_|TWILIO_|WHATSAPP_|META_|VAPID_)/i;
if(Object.keys(process.env).some(name=>forbiddenEnv.test(name))){
  throw new Error("Railway VIP QA refused an external-service environment variable");
}

let parsed;
try{
  parsed=new URL(process.env.KINGLIKE_VIP_QA_DATABASE_URL||"");
}catch{
  throw new Error("Railway VIP QA database target is invalid");
}
const dbHost=(process.env.KINGLIKE_VIP_QA_EXPECTED_DB_HOST||"").toLowerCase();
const expectedAddress=process.env.KINGLIKE_VIP_QA_EXPECTED_DB_ADDRESS||"";
const dbPort=parsed.port?Number(parsed.port):5432;
const dbName=decodeURIComponent(parsed.pathname.replace(/^\/+/,""));
const dbRole=decodeURIComponent(parsed.username);
if(!["postgres:","postgresql:"].includes(parsed.protocol)||
  parsed.hostname.toLowerCase()!==dbHost||
  !/^[a-z0-9.-]+\.railway\.internal$/i.test(dbHost)||
  !net.isIPv4(expectedAddress)||
  !isPrivateAddress(expectedAddress)||
  !/^vipqa_[a-z0-9_]{2,32}$/.test(dbName)||
  !/^vipqa_[a-z0-9_]{2,32}$/.test(dbRole)||dbPort!==5432||
  parsed.search||parsed.hash){
  throw new Error("Railway VIP QA database target is outside its private allowlist");
}

function isPrivateAddress(value){
  const octets=value.split(".").map(Number);
  return octets[0]===10||
    (octets[0]===172&&octets[1]>=16&&octets[1]<=31)||
    (octets[0]===192&&octets[1]===168)||
    (octets[0]===100&&octets[1]>=64&&octets[1]<=127);
}

export function isAllowedRailwayQaTarget(host,port){
  return typeof host==="string"&&host.toLowerCase()===dbHost&&Number(port)===dbPort;
}

function targetFrom(args){
  const first=args[0];
  if(first&&typeof first==="object"){
    return {
      host:first.host||first.hostname||"",
      port:Number(first.port),
    };
  }
  return {
    host:typeof args[1]==="string"?args[1]:"",
    port:Number(first),
  };
}

const allowedSockets=new WeakSet();
const originalSocketConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  const target=targetFrom(args);
  if(!isAllowedRailwayQaTarget(target.host,target.port))throw blocked();
  allowedSockets.add(this);
  return Reflect.apply(originalSocketConnect,this,args);
};

const originalLookup=dns.lookup;
dns.lookup=function(hostname,...args){
  if(typeof hostname!=="string"||hostname.toLowerCase()!==dbHost){
    const callback=args.at(-1);
    if(typeof callback==="function"){
      queueMicrotask(()=>callback(blocked()));
      return;
    }
    throw blocked();
  }
  const callback=args.at(-1);
  if(typeof callback!=="function")throw blocked();
  const wrapped=(error,address,family)=>{
    if(error)return callback(error,address,family);
    if(Array.isArray(address)){
      const allowed=address.filter(item=>item?.address===expectedAddress);
      if(allowed.length===0)return callback(blocked());
      return callback(null,allowed,4);
    }
    if(address!==expectedAddress)return callback(blocked());
    return callback(null,address,family);
  };
  args[args.length-1]=wrapped;
  return Reflect.apply(originalLookup,dns,[hostname,...args]);
};
const originalPromiseLookup=dns.promises.lookup.bind(dns.promises);
dns.promises.lookup=async(hostname,...args)=>{
  if(typeof hostname!=="string"||hostname.toLowerCase()!==dbHost)throw blocked();
  const result=await originalPromiseLookup(hostname,...args);
  if(Array.isArray(result)){
    const allowed=result.filter(item=>item?.address===expectedAddress);
    if(allowed.length===0)throw blocked();
    return allowed;
  }
  if(result?.address!==expectedAddress)throw blocked();
  return result;
};
for(const method of Object.getOwnPropertyNames(dns)){
  if((method==="reverse"||method.startsWith("resolve"))&&typeof dns[method]==="function"){
    dns[method]=denyRequest;
  }
}
for(const method of Object.getOwnPropertyNames(dns.promises)){
  if((method==="reverse"||method.startsWith("resolve"))&&typeof dns.promises[method]==="function"){
    dns.promises[method]=denyRequest;
  }
}
for(const method of Object.getOwnPropertyNames(dns.Resolver.prototype)){
  if((method==="reverse"||method.startsWith("resolve"))&&typeof dns.Resolver.prototype[method]==="function"){
    dns.Resolver.prototype[method]=denyRequest;
  }
}
for(const method of ["bind","send","connect"]){
  if(typeof dgram.Socket.prototype[method]==="function")dgram.Socket.prototype[method]=denyRequest;
}

const originalTlsConnect=tls.connect;
tls.connect=function(...args){
  const options=args[0]&&typeof args[0]==="object"?args[0]:{};
  const socket=options.socket;
  const host=options.servername||options.host||options.hostname||"";
  const allowedSocket=!!socket&&allowedSockets.has(socket);
  const allowedTarget=isAllowedRailwayQaTarget(host,options.port);
  if(!allowedSocket&&!allowedTarget)throw blocked();
  return Reflect.apply(originalTlsConnect,tls,args);
};

http.request=denyRequest;
http.get=denyRequest;
https.request=denyRequest;
https.get=denyRequest;
http2.connect=denyRequest;
globalThis.fetch=async()=>{throw blocked();};
dgram.createSocket=denyRequest;
for(const method of ["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork"]){
  if(typeof childProcess[method]==="function")childProcess[method]=denyRequest;
}
workerThreads.Worker=denyRequest;
cluster.fork=denyRequest;
if(typeof cluster.setupPrimary==="function")cluster.setupPrimary=denyRequest;
if(typeof cluster.setupMaster==="function")cluster.setupMaster=denyRequest;
