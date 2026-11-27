import http,{type IncomingHttpHeaders, type IncomingMessage, type ServerResponse} from "node:http";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import type {Duplex} from "node:stream";
import {assertQaLocalProxyEnvironment,isForbiddenQaPath,qaGateMatches} from "./qaPreviewRules";

export const QA_PROXY_HOST="127.0.0.1";
export const QA_PROXY_PORT=54823;
export const QA_UPSTREAM_HOST="127.0.0.1";
export const QA_UPSTREAM_PORT=54821;
export const QA_PROXY_ORIGIN=`http://${QA_PROXY_HOST}:${QA_PROXY_PORT}`;
export const QA_UPSTREAM_ORIGIN=`http://${QA_UPSTREAM_HOST}:${QA_UPSTREAM_PORT}`;
export const QA_PROXY_MAX_BODY_BYTES=12*1024*1024;

const proxyAuthority=`${QA_PROXY_HOST}:${QA_PROXY_PORT}`;
const upstreamAuthority=`${QA_UPSTREAM_HOST}:${QA_UPSTREAM_PORT}`;
const allowedMethods=new Set(["GET","HEAD","POST","PUT","PATCH","DELETE"]);
const forwardedRequestHeaders=[
 "accept","accept-encoding","accept-language","content-type","content-length",
 "if-match","if-modified-since","if-none-match","if-range","range"
] as const;
const forwardedResponseHeaders=[
 "accept-ranges","content-disposition","content-encoding","content-length",
 "content-range","content-type","content-security-policy","content-security-policy-report-only",
 "etag","last-modified","vary","www-authenticate"
] as const;
const qaSessionCookieName="kinglike.vip.qa.sid";
const maxConcurrentRequests=24;
const maxConcurrentMutations=4;
let activeRequests=0;
let activeMutations=0;

class RequestBodyTooLarge extends Error{}

export function proxyRequestPath(raw:string):string|undefined{
 if(!raw.startsWith("/")||raw.startsWith("//")||raw.includes("\\")||
    /[\u0000-\u001f\u007f]/.test(raw)||isForbiddenQaPath(raw))return undefined;
 return raw;
}

export function selectQaSessionCookie(raw:unknown):string|undefined{
 if(typeof raw!=="string"||raw.length>4096)return undefined;
 const matches=raw.split(";").map(part=>part.trim())
  .filter(part=>part.startsWith(`${qaSessionCookieName}=`));
 return matches.length===1?matches[0]:undefined;
}

export function buildQaUpstreamRequestHeaders(headers:IncomingHttpHeaders):IncomingHttpHeaders{
 const forwarded:IncomingHttpHeaders={
  host:upstreamAuthority,
  connection:"close"
 };
 for(const name of forwardedRequestHeaders){
  const value=headers[name];
  if(typeof value==="string")forwarded[name]=value;
 }
 const authorization=headers.authorization;
 if(typeof authorization==="string")forwarded.authorization=authorization;
 const cookie=selectQaSessionCookie(headers.cookie);
 if(cookie)forwarded.cookie=cookie;
 if(headers.origin!==undefined)forwarded.origin=QA_UPSTREAM_ORIGIN;
 return forwarded;
}

export function selectQaUpstreamSetCookies(value:unknown):string[]{
 const cookies=Array.isArray(value)?value:typeof value==="string"?[value]:[];
 return cookies.filter((cookie):cookie is string=>
   typeof cookie==="string"&&cookie.split(";",1)[0].trim().startsWith(`${qaSessionCookieName}=`))
  .map(cookie=>cookie.replace(/;\s*domain=[^;]*/ig,""));
}

function noStoreHeaders(res:ServerResponse,csp="default-src 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'"){
 res.setHeader("Cache-Control","no-store");
 res.setHeader("X-Robots-Tag","noindex, nofollow, noarchive");
 res.setHeader("X-Content-Type-Options","nosniff");
 res.setHeader("Referrer-Policy","no-referrer");
 res.setHeader("X-Frame-Options","DENY");
 res.setHeader("Cross-Origin-Resource-Policy","same-origin");
 res.setHeader("Content-Security-Policy",csp);
 res.setHeader("Connection","close");
 res.removeHeader("Server");
 res.removeHeader("X-Powered-By");
}

function respond(res:ServerResponse,status:number,message:string,challenge=false){
 noStoreHeaders(res);
 if(challenge)res.setHeader("WWW-Authenticate",'Basic realm="KINGLIKE VIP Private QA"');
 res.statusCode=status;
 res.setHeader("Content-Type","text/plain; charset=utf-8");
 res.setHeader("Content-Length",Buffer.byteLength(message));
 res.end(message);
}

function writeSocketResponse(socket:Duplex,status:number,phrase:string,challenge=false){
 const headers=[
  `HTTP/1.1 ${status} ${phrase}`,
  "Cache-Control: no-store",
  "X-Robots-Tag: noindex, nofollow, noarchive",
  "X-Content-Type-Options: nosniff",
  "Referrer-Policy: no-referrer",
  "X-Frame-Options: DENY",
  "Content-Security-Policy: default-src 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
  "Connection: close"
 ];
 if(challenge)headers.push('WWW-Authenticate: Basic realm="KINGLIKE VIP Private QA"');
 headers.push("Content-Type: text/plain; charset=utf-8","");
 socket.end(`${headers.join("\r\n")}Request rejected\r\n`);
}

function authorized(req:IncomingMessage):boolean{
 return qaGateMatches(req.headers.authorization,
  process.env.KINGLIKE_VIP_QA_GATE_USER||"",
  process.env.KINGLIKE_VIP_QA_GATE_PASSWORD||"");
}

function validateBeforeBody(req:IncomingMessage,res:ServerResponse):string|undefined{
 if(!authorized(req)){
  respond(res,401,"Private KINGLIKE VIP QA - login required",true);
  return "rejected";
 }
 if(req.headers.host!==proxyAuthority){
  respond(res,421,"Bad request");
  return "rejected";
 }
 const origin=req.headers.origin;
 if(origin!==undefined&&origin!==QA_PROXY_ORIGIN){
  respond(res,403,"Forbidden");
  return "rejected";
 }
 if(["POST","PUT","PATCH","DELETE"].includes(req.method||"")&&origin!==QA_PROXY_ORIGIN){
  respond(res,403,"Forbidden");
  return "rejected";
 }
 const path=proxyRequestPath(req.url||"");
 if(!path){
  respond(res,req.url?.startsWith("/")?404:400,req.url?.startsWith("/")?"Not found":"Bad request");
  return "rejected";
 }
 if(!allowedMethods.has(req.method||"")){
  res.setHeader("Allow","GET, HEAD, POST, PUT, PATCH, DELETE");
  respond(res,405,"Method not allowed");
  return "rejected";
 }
 const length=req.headers["content-length"];
 if(typeof length==="string"&&Number(length)>QA_PROXY_MAX_BODY_BYTES){
  res.setHeader("Connection","close");
  respond(res,413,"Request too large");
  return "rejected";
 }
 return path;
}

async function collectBoundedBody(req:IncomingMessage):Promise<Buffer>{
 const chunks:Buffer[]=[];
 let size=0;
 for await(const chunk of req){
  const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
  size+=data.length;
  if(size>QA_PROXY_MAX_BODY_BYTES)throw new RequestBodyTooLarge();
  chunks.push(data);
 }
 return Buffer.concat(chunks,size);
}

export function mapQaUpstreamLocation(value:string):string|undefined{
 if(value.startsWith("/")&&!value.startsWith("//")&&!value.includes("\\")&&
  !/[\u0000-\u001f\u007f]/.test(value)){
  try{return new URL(value,QA_UPSTREAM_ORIGIN).origin===QA_UPSTREAM_ORIGIN?value:undefined;}
  catch{return undefined;}
 }
 try{
  const parsed=new URL(value,QA_UPSTREAM_ORIGIN);
  if(parsed.origin!==QA_UPSTREAM_ORIGIN||parsed.username||parsed.password||
    /[\u0000-\u001f\u007f]/.test(value))return undefined;
  return `${QA_PROXY_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
 }catch{return undefined;}
}

function applyUpstreamHeaders(res:ServerResponse,headers:IncomingHttpHeaders):boolean{
 for(const name of forwardedResponseHeaders){
  const value=headers[name];
  if(typeof value==="string")res.setHeader(name,value);
 }
 const location=headers.location;
 if(typeof location==="string"){
  const safe=mapQaUpstreamLocation(location);
  if(!safe)return false;
  res.setHeader("Location",safe);
 }
 const cookies=selectQaUpstreamSetCookies(headers["set-cookie"]);
 if(cookies.length)res.setHeader("Set-Cookie",cookies);
 const csp=headers["content-security-policy"];
 noStoreHeaders(res,typeof csp==="string"?csp:undefined);
 return true;
}

function forwardToFixedQaUpstream(req:IncomingMessage,res:ServerResponse,path:string,body:Buffer):Promise<void>{
 return new Promise(resolvePromise=>{
  let finished=false;
  const done=()=>{if(!finished){finished=true;resolvePromise();}};
  res.once("finish",done);
  res.once("close",done);
  const outgoing=http.request({
   hostname:QA_UPSTREAM_HOST,
   port:QA_UPSTREAM_PORT,
   method:req.method,
   path,
   headers:buildQaUpstreamRequestHeaders(req.headers),
   agent:false,
   maxHeaderSize:8192
  },incoming=>{
   if(!applyUpstreamHeaders(res,incoming.headers)){
    incoming.resume();
    respond(res,502,"QA upstream response rejected");
    return;
   }
   res.statusCode=incoming.statusCode||502;
   incoming.on("error",()=>{if(!res.headersSent)respond(res,502,"QA upstream unavailable");else res.destroy();});
   incoming.pipe(res);
  });
  outgoing.setTimeout(15000,()=>outgoing.destroy(new Error("timeout")));
  outgoing.on("error",()=>{
   if(!res.headersSent)respond(res,502,"QA upstream unavailable");
   else res.destroy();
  });
  outgoing.end(body);
 });
}

async function handleRequest(req:IncomingMessage,res:ServerResponse){
 const path=validateBeforeBody(req,res);
 if(path===undefined||path==="rejected")return;
 const mutation=["POST","PUT","PATCH","DELETE"].includes(req.method||"");
 if(activeRequests>=maxConcurrentRequests||(mutation&&activeMutations>=maxConcurrentMutations)){
  respond(res,503,"QA proxy busy");
  return;
 }
 activeRequests++;
 if(mutation)activeMutations++;
 try{
  const body=await collectBoundedBody(req);
  await forwardToFixedQaUpstream(req,res,path,body);
 }catch(error){
  if(!res.headersSent){
   if(error instanceof RequestBodyTooLarge)respond(res,413,"Request too large");
   else respond(res,502,"QA upstream unavailable");
  }else res.destroy();
 }finally{
  activeRequests--;
  if(mutation)activeMutations--;
 }
}

export function createQaLocalProxyServer(){
 const server=http.createServer({maxHeaderSize:8192},(req,res)=>{void handleRequest(req,res);});
 server.headersTimeout=8000;
 server.requestTimeout=20000;
 server.keepAliveTimeout=1000;
 server.maxHeadersCount=40;
 server.on("clientError",(error,socket)=>{
  if(!socket.writable)return;
   const code=(error as NodeJS.ErrnoException).code;
   writeSocketResponse(socket,code==="HPE_HEADER_OVERFLOW"?431:400,
    code==="HPE_HEADER_OVERFLOW"?"Request Header Fields Too Large":"Bad Request");
 });
 server.on("connect",(req,socket)=>{
  writeSocketResponse(socket,authorized(req)?405:401,
   authorized(req)?"Method Not Allowed":"Unauthorized",!authorized(req));
 });
 server.on("upgrade",(req,socket)=>{
  writeSocketResponse(socket,authorized(req)?426:401,
   authorized(req)?"Upgrade Required":"Unauthorized",!authorized(req));
 });
 server.on("checkContinue",(req,res)=>{
  if(!authorized(req))respond(res,401,"Private KINGLIKE VIP QA - login required",true);
  else respond(res,417,"Expectation failed");
 });
 return server;
}

export function startQaLocalProxy(){
 assertQaLocalProxyEnvironment(process.env);
 const server=createQaLocalProxyServer();
 server.listen(QA_PROXY_PORT,QA_PROXY_HOST,()=>{
  const address=server.address();
  if(!address||typeof address==="string"||address.address!==QA_PROXY_HOST||address.port!==QA_PROXY_PORT){
   server.close();
   throw new Error("QA proxy failed loopback binding verification");
  }
  process.stdout.write("Local KINGLIKE VIP QA proxy is ready.\n");
 });
 server.on("error",()=>{process.stderr.write("Local KINGLIKE VIP QA proxy failed to start.\n");process.exitCode=1;});
 return server;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)&&
 process.env.KINGLIKE_VIP_QA_PROXY_START==="true"){
 startQaLocalProxy();
}
