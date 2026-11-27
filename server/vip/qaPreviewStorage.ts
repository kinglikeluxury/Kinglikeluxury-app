import {randomUUID} from "node:crypto";
import {type ReceiptMime,MAX_VIP_RECEIPT_BYTES} from "./vipReceiptValidation";

/**
 * Process-local temporary object storage for the isolated VIP QA build.
 * Nothing is sent to GCS, Neon S3, or a persistent filesystem.
 */
const objects=new Map<string,Buffer>();

function put(prefix:string,data:Buffer,extension:string,maxBytes:number):string{
  if(!Buffer.isBuffer(data)||data.length<1||data.length>maxBytes)throw Error("Invalid QA file");
  const key=prefix+randomUUID()+"."+extension;
  objects.set(key,Buffer.from(data));
  return key;
}
function get(key:string,prefix:string,extensions:RegExp,maxBytes:number):Buffer{
  if(!key.startsWith(prefix)||!extensions.test(key))throw Error("Invalid QA file key");
  const value=objects.get(key);
  if(!value||value.length>maxBytes)throw Error("QA file unavailable");
  return Buffer.from(value);
}

export async function savePrivateReceipt(data:Buffer,_mime:ReceiptMime,extension:string):Promise<string>{
  if(!["pdf","jpg","png"].includes(extension))throw Error("Invalid QA receipt extension");
  return put("kinglike-vip/receipts/",data,extension,MAX_VIP_RECEIPT_BYTES);
}
export async function readPrivateReceipt(key:string):Promise<Buffer>{
  return get(key,"kinglike-vip/receipts/",/^kinglike-vip\/receipts\/[0-9a-f-]{36}\.(pdf|jpg|png)$/,MAX_VIP_RECEIPT_BYTES);
}
export async function removePrivateReceipt(key:string):Promise<void>{
  if(/^kinglike-vip\/receipts\/[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(key))objects.delete(key);
}

export async function savePrivateProjectPhoto(
  projectId:number,data:Buffer,mime:"image/jpeg"|"image/png"
):Promise<string>{
  if(!Number.isSafeInteger(projectId)||projectId<1)throw Error("Invalid QA project");
  const extension=mime==="image/jpeg"?"jpg":"png";
  return put(`kinglike-vip/project-photos/${projectId}/`,data,extension,8*1024*1024);
}
export async function readPrivateProjectPhoto(key:string):Promise<Buffer>{
  return get(key,"kinglike-vip/project-photos/",/^kinglike-vip\/project-photos\/[1-9]\d*\/[0-9a-f-]{36}\.(jpg|png)$/,8*1024*1024);
}
export async function removePrivateProjectPhoto(key:string):Promise<void>{
  if(/^kinglike-vip\/project-photos\/[1-9]\d*\/[0-9a-f-]{36}\.(jpg|png)$/.test(key))objects.delete(key);
}

export async function savePrivateOfficialStatement(data:Buffer):Promise<string>{
  return put("kinglike-vip/official-statements/",data,"pdf",10*1024*1024);
}
export async function readPrivateOfficialStatement(key:string):Promise<Buffer>{
  return get(key,"kinglike-vip/official-statements/",/^kinglike-vip\/official-statements\/[0-9a-f-]{36}\.pdf$/,10*1024*1024);
}
export async function removePrivateOfficialStatement(key:string):Promise<void>{
  if(/^kinglike-vip\/official-statements\/[0-9a-f-]{36}\.pdf$/.test(key))objects.delete(key);
}
