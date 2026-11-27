import {randomUUID} from "node:crypto";
import {pool} from "./qaRailwayPreviewDb";
import {type ReceiptMime,MAX_VIP_RECEIPT_BYTES} from "./vipReceiptValidation";

const RECEIPT_KEY=/^kinglike-vip\/receipts\/[0-9a-f-]{36}\.(pdf|jpg|png)$/;
const PHOTO_KEY=/^kinglike-vip\/project-photos\/[1-9]\d*\/[0-9a-f-]{36}\.(jpg|png)$/;
const STATEMENT_KEY=/^kinglike-vip\/official-statements\/[0-9a-f-]{36}\.pdf$/;

function extensionMime(extension:string):ReceiptMime{
  if(extension==="pdf")return "application/pdf";
  if(extension==="jpg")return "image/jpeg";
  if(extension==="png")return "image/png";
  throw new Error("Invalid synthetic QA file type");
}

async function store(key:string,data:Buffer,mime:string,maxBytes:number):Promise<string>{
  if(!Buffer.isBuffer(data)||data.length<1||data.length>maxBytes){
    throw new Error("Invalid synthetic QA file size");
  }
  await pool.query(
    "INSERT INTO public.vip_qa_file_objects(object_key,content_type,size_bytes,object_bytes) "+
    "VALUES($1,$2,$3,$4)",
    [key,mime,data.length,data],
  );
  return key;
}

async function read(key:string,pattern:RegExp,minBytes:number,maxBytes:number):Promise<Buffer>{
  if(!pattern.test(key))throw new Error("Invalid synthetic QA object key");
  const result=await pool.query<{content_type:string;size_bytes:number;object_bytes:Buffer}>(
    "SELECT content_type,size_bytes,object_bytes FROM public.vip_qa_file_objects "+
    "WHERE object_key=$1 LIMIT 1",
    [key],
  );
  const row=result.rows[0];
  if(!row||!Buffer.isBuffer(row.object_bytes)||!Number.isSafeInteger(Number(row.size_bytes))||
    Number(row.size_bytes)<minBytes||Number(row.size_bytes)>maxBytes||
    row.object_bytes.length!==Number(row.size_bytes)){
    throw new Error("Synthetic QA object unavailable");
  }
  const extension=key.endsWith(".pdf")?"pdf":key.endsWith(".jpg")?"jpg":"png";
  if(row.content_type!==extensionMime(extension))throw new Error("Synthetic QA object type mismatch");
  return Buffer.from(row.object_bytes);
}

async function remove(key:string,pattern:RegExp):Promise<void>{
  if(!pattern.test(key))return;
  await pool.query("DELETE FROM public.vip_qa_file_objects WHERE object_key=$1",[key]);
}

export async function savePrivateReceipt(data:Buffer,mime:ReceiptMime,extension:string):Promise<string>{
  if(extensionMime(extension)!==mime)throw new Error("Synthetic QA receipt type mismatch");
  return store(`kinglike-vip/receipts/${randomUUID()}.${extension}`,data,mime,MAX_VIP_RECEIPT_BYTES);
}
export async function readPrivateReceipt(key:string):Promise<Buffer>{
  return read(key,RECEIPT_KEY,1,MAX_VIP_RECEIPT_BYTES);
}
export async function removePrivateReceipt(key:string):Promise<void>{
  return remove(key,RECEIPT_KEY);
}

export async function savePrivateProjectPhoto(
  projectId:number,data:Buffer,mime:"image/jpeg"|"image/png",
):Promise<string>{
  if(!Number.isSafeInteger(projectId)||projectId<1||!Buffer.isBuffer(data)||data.length<8){
    throw new Error("Invalid synthetic QA project photo");
  }
  const extension=mime==="image/jpeg"?"jpg":"png";
  return store(`kinglike-vip/project-photos/${projectId}/${randomUUID()}.${extension}`,
    data,mime,8*1024*1024);
}
export async function readPrivateProjectPhoto(key:string):Promise<Buffer>{
  return read(key,PHOTO_KEY,8,8*1024*1024);
}
export async function removePrivateProjectPhoto(key:string):Promise<void>{
  return remove(key,PHOTO_KEY);
}

export async function savePrivateOfficialStatement(data:Buffer):Promise<string>{
  if(!Buffer.isBuffer(data)||data.length<10)throw new Error("Invalid synthetic QA statement");
  return store(`kinglike-vip/official-statements/${randomUUID()}.pdf`,
    data,"application/pdf",10*1024*1024);
}
export async function readPrivateOfficialStatement(key:string):Promise<Buffer>{
  return read(key,STATEMENT_KEY,10,10*1024*1024);
}
export async function removePrivateOfficialStatement(key:string):Promise<void>{
  return remove(key,STATEMENT_KEY);
}
