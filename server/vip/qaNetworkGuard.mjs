import dns from "node:dns";
import http2 from "node:http2";
import net from "node:net";
import tls from "node:tls";

const localHosts=new Set(["localhost","127.0.0.1","::1","[::1]"]);
const isLoopback=(host)=>typeof host==="string"&&localHosts.has(host.toLowerCase());
const blocked=()=>{
  const error=new Error("External networking is disabled in local VIP QA");
  error.code="EACCES";
  return error;
};

const originalSocketConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  const first=args[0];
  const options=first&&typeof first==="object"
    ? first
    : typeof first==="number"
      ? {port:first,host:typeof args[1]==="string"?args[1]:"localhost"}
      : null;
  if(!options||!isLoopback(options.host||options.hostname||"localhost"))throw blocked();
  return Reflect.apply(originalSocketConnect,this,args);
};

const originalLookup=dns.lookup;
dns.lookup=function(hostname,options,callback){
  const cb=typeof options==="function"?options:callback;
  if(!isLoopback(hostname)){
    const error=blocked();
    if(typeof cb==="function"){queueMicrotask(()=>cb(error));return;}
    throw error;
  }
  return Reflect.apply(originalLookup,this,[hostname,options,callback].filter((_,i)=>i<3));
};
const originalPromiseLookup=dns.promises.lookup.bind(dns.promises);
dns.promises.lookup=async(hostname,...args)=>{
  if(!isLoopback(hostname))throw blocked();
  return originalPromiseLookup(hostname,...args);
};

tls.connect=function(){throw blocked();};
http2.connect=function(){throw blocked();};

const originalFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=async(input,init={})=>{
  let url;
  try{
    const source=typeof input==="string"?input:input instanceof URL?input.href:input.url;
    url=new URL(source);
  }catch{throw blocked();}
  if(url.protocol!=="http:"||!isLoopback(url.hostname))throw blocked();
  return originalFetch(input,{...init,redirect:"manual"});
};
