import {randomUUID} from "node:crypto";
import type {ReceiptMime} from "../vipReceiptValidation";

/**
 * Disposable, in-memory test adapter. NEVER used by QA preview or production.
 * Only esbuild fixture test resolves VIP private storage imports to this file.
 * No cloud bucket, GCS credentials, network, or customer files are accessed.
 */
const assets=new Map<string,Buffer>();
export async function savePrivateReceipt(data:Buffer,_kind:ReceiptMime,ext:string):Promise<string>{
 const name="kinglike-vip/receipts/"+randomUUID()+"."+ext;
 assets.set(name,Buffer.from(data));return name;
}
export async function readPrivateReceipt(name:string):Promise<Buffer>{
 const result=assets.get(name);if(!result)throw Error("Fixture file unavailable");
 return Buffer.from(result);
}
export async function removePrivateReceipt(name:string):Promise<void>{assets.delete(name);}
export async function savePrivateOfficialStatement(data:Buffer):Promise<string>{
 const name="kinglike-vip/official-statements/"+randomUUID()+".pdf";
 assets.set(name,Buffer.from(data));return name;
}
export async function readPrivateOfficialStatement(name:string):Promise<Buffer>{
 const result=assets.get(name);if(!result)throw Error("Fixture statement unavailable");
 return Buffer.from(result);
}
export async function removePrivateOfficialStatement(name:string):Promise<void>{assets.delete(name);}
export async function savePrivateProjectPhoto(projectId:number,data:Buffer,kind:"image/jpeg"|"image/png"):Promise<string>{
 const name="kinglike-vip/project-photos/"+projectId+"/"+randomUUID()+(kind==="image/jpeg"?".jpg":".png");
 assets.set(name,Buffer.from(data));return name;
}
export async function readPrivateProjectPhoto(name:string):Promise<Buffer>{
 const result=assets.get(name);if(!result)throw Error("Fixture photo unavailable");
 return Buffer.from(result);
}
export async function removePrivateProjectPhoto(name:string):Promise<void>{assets.delete(name);}
