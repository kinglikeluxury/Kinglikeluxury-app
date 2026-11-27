import { createHash, createHmac } from "node:crypto";
import { readVipNeonStorageConfig, type VipNeonStorageConfig } from "./vipNeonStorageConfig";

/**
 * Server-side Neon Object Storage transport. Reuses the project's proven
 * dependency-free AWS SigV4 pattern (see kayRecordingStorage.ts) instead of
 * installing an SDK or requiring another Railway service.
 *
 * Crucial: the Neon bucket MUST be 'private' in its control plane. The app
 * must not enable this transport until the owner explicitly verifies it and
 * sets KINGLIKE_VIP_NEON_BUCKET_PRIVATE_APPROVED. No presigned/browser URLs.
 */
const SAFE_KEY = /^kinglike-vip\/(?:receipts\/[0-9a-f-]{36}\.(?:pdf|jpg|png)|project-photos\/[1-9]\d*\/[0-9a-f-]{36}\.(?:jpg|png)|official-statements\/[0-9a-f-]{36}\.pdf)$/;
const MAX_BYTES = 10 * 1024 * 1024;
const EMPTY_HASH = createHash("sha256").update("").digest("hex");

function sha256(value:Buffer|string):string {
  return createHash("sha256").update(value).digest("hex");
}
function hmac(key:Buffer|string, message:string):Buffer {
  return createHmac("sha256",key).update(message).digest();
}
function checkedKey(key:string):string {
  if(typeof key!=="string"||!SAFE_KEY.test(key))throw Error("Invalid VIP object key");
  return key;
}
type Method = "GET"|"PUT"|"HEAD"|"DELETE";

function makeSignature(
  config:VipNeonStorageConfig,method:Method,key:string,
  bodyHash:string, contentType?:string,
) {
  const date=new Date().toISOString().replace(/[-:]|\.\d{3}/g,"");
  const short=date.slice(0,8);
  const host=new URL(config.endpoint).host;
  const scope=short+"/"+config.region+"/s3/aws4_request";
  const uri="/"+encodeURIComponent(config.bucket)+"/"+
    key.split("/").map(encodeURIComponent).join("/");
  const headers:Record<string,string>={
    host,
    "x-amz-content-sha256":bodyHash,
    "x-amz-date":date,
  };
  if(contentType)headers["content-type"]=contentType;
  // A random, unguessable key already makes collisions negligible. The S3
  // conditional header is defense-in-depth; if Neon rejects it, fail closed
  // rather than silently falling back to an overwrite-capable PUT.
  if(method==="PUT")headers["if-none-match"]="*";
  const sorted=Object.keys(headers).sort();
  const canonicalHeaders=sorted.map(h=>h+":"+headers[h].trim()+"\n").join("");
  const canonical=[method,uri,"",canonicalHeaders,sorted.join(";"),bodyHash].join("\n");
  const toSign=["AWS4-HMAC-SHA256",date,scope,sha256(canonical)].join("\n");
  const signingKey=hmac(hmac(hmac(hmac("AWS4"+config.secretAccessKey,short),config.region),"s3"),"aws4_request");
  const signature=createHmac("sha256",signingKey).update(toSign).digest("hex");
  const authorization="AWS4-HMAC-SHA256 Credential="+config.accessKeyId+"/"+scope+
    ", SignedHeaders="+sorted.join(";")+", Signature="+signature;
  const outbound:Record<string,string>={
    "x-amz-content-sha256":bodyHash,
    "x-amz-date":date,
    "Authorization":authorization,
  };
  if(contentType)outbound["Content-Type"]=contentType;
  if(method==="PUT")outbound["If-None-Match"]="*";
  return {uri,headers:outbound};
}
async function signedRequest(
  method:Method,key:string,body?:Buffer,mime?:string,
):Promise<Response> {
  checkedKey(key);
  const config=readVipNeonStorageConfig();
  const hash=body?sha256(body):EMPTY_HASH;
  const signed=makeSignature(config,method,key,hash,mime);
  // No URL may ever contain S3 secret material or a presigned signature.
  const response=await fetch(config.endpoint+signed.uri,{
    method,
    headers:signed.headers,
    ...(body?{body}:{}),
    signal:AbortSignal.timeout(20_000),
    cache:"no-store",
  });
  return response;
}
function validSizeHeader(value:string|null,maxBytes:number):number {
  if(!value||!/^(?:0|[1-9]\d*)$/.test(value))throw Error("Missing object size");
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<=0||n>maxBytes)throw Error("Stored VIP object too large");
  return n;
}
async function limitedRead(response:Response,maxBytes:number):Promise<Buffer> {
  const expected=validSizeHeader(response.headers.get("content-length"),maxBytes);
  if(!response.body)throw Error("Stored VIP object has no body");
  const reader=response.body.getReader();
  const chunks:Buffer[]=[];
  let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>maxBytes||total>expected)throw Error("Stored VIP object exceeds authorized size");
      chunks.push(Buffer.from(value));
    }
  }catch(e){
    await reader.cancel().catch(()=>{});
    throw e;
  }finally{
    reader.releaseLock();
  }
  if(total!==expected)throw Error("Stored VIP object size mismatch");
  return Buffer.concat(chunks,total);
}

export async function saveNeonPrivateObject(
  key:string,data:Buffer,mime:"application/pdf"|"image/jpeg"|"image/png",
):Promise<string>{
  checkedKey(key);
  if(!Buffer.isBuffer(data)||data.length<1||data.length>MAX_BYTES){
    throw Error("Invalid VIP private object size");
  }
  const expectedMime=key.endsWith(".pdf")?"application/pdf":
    key.endsWith(".jpg")?"image/jpeg":key.endsWith(".png")?"image/png":null;
  if(!expectedMime || mime!==expectedMime) {
    throw Error("VIP private file type does not match its storage key");
  }
  const response=await signedRequest("PUT",key,data,mime);
  if(!response.ok)throw Error("Private VIP storage write failed");
  try{
    const head=await signedRequest("HEAD",key);
    if(!head.ok||validSizeHeader(head.headers.get("content-length"),MAX_BYTES)!==data.length){
      throw Error("Private VIP storage verification failed");
    }
  }catch{
    await removeNeonPrivateObject(key).catch(()=>{});
    throw Error("Private VIP storage verification failed");
  }
  return key;
}

export async function readNeonPrivateObject(key:string,maxBytes=MAX_BYTES):Promise<Buffer>{
  checkedKey(key);
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_BYTES){
    throw Error("Invalid VIP read bound");
  }
  const response=await signedRequest("GET",key);
  if(!response.ok)throw Error("Private VIP storage read failed");
  return limitedRead(response,maxBytes);
}

export async function removeNeonPrivateObject(key:string):Promise<void>{
  checkedKey(key);
  const response=await signedRequest("DELETE",key);
  if(!response.ok && response.status!==404){
    throw Error("Private VIP storage cleanup failed");
  }
}
