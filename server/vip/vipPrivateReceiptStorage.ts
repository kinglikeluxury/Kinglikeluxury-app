import { Storage } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";
import { type ReceiptMime, MAX_VIP_RECEIPT_BYTES } from "./vipReceiptValidation";

/**
 * Dedicated, non-public Google Cloud Storage bucket using the already-installed
 * @google-cloud/storage SDK. No public URL or browser upload is ever exposed.
 * A private Railway-compatible object-storage adapter can replace this module
 * later without changing permissions, database tables, or client UX.
 *
 * Service account JSON and bucket name must be configured only in isolated
 * staging before the first smoke test. Absent configuration fails CLOSED.
 */
let storage: Storage | null = null;
let verifiedBucketName: string | null = null;

function configuredBucket() {
  const name = process.env.KINGLIKE_VIP_PRIVATE_BUCKET;
  const rawCredentials = process.env.KINGLIKE_VIP_GCS_CREDENTIALS_JSON;
  if (!name || !rawCredentials || !/^[a-z0-9][a-z0-9._-]{2,62}$/.test(name)) {
    throw new Error("VIP private storage is not configured");
  }
  if (!storage) {
    const credentials = JSON.parse(rawCredentials);
    if (typeof credentials?.client_email !== "string" ||
        typeof credentials?.private_key !== "string" ||
        typeof credentials?.project_id !== "string") {
      throw new Error("VIP private storage credentials invalid");
    }
    storage = new Storage({ projectId: credentials.project_id, credentials });
  }
  return storage.bucket(name);
}

async function checkedBucket() {
  const bucket = configuredBucket();
  if (verifiedBucketName !== bucket.name) {
    const [meta] = await bucket.getMetadata();
    if (meta.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true ||
        meta.iamConfiguration?.publicAccessPrevention !== "enforced") {
      throw new Error("VIP bucket must enforce uniform access and prevent public access");
    }
    verifiedBucketName = bucket.name;
  }
  return bucket;
}

export async function savePrivateReceipt(data: Buffer, mime: ReceiptMime, extension: string) {
  if (!data.length || data.length > MAX_VIP_RECEIPT_BYTES) throw new Error("Invalid receipt size");
  const bucket = await checkedBucket();
  const key = "kinglike-vip/receipts/" + randomUUID() + "." + extension;
  await bucket.file(key).save(data, {
    resumable: false,
    contentType: mime,
    metadata: { cacheControl: "private, no-store" },
    preconditionOpts: { ifGenerationMatch: 0 },
  });
  return key;
}

export async function readPrivateReceipt(key: string): Promise<Buffer> {
  if (!/^kinglike-vip\/receipts\/[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(key)) {
    throw new Error("Invalid receipt key");
  }
  const bucket = await checkedBucket();
  const [meta] = await bucket.file(key).getMetadata();
  const size = Number(meta.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_VIP_RECEIPT_BYTES) {
    throw new Error("Stored receipt has invalid size");
  }
  const [buffer] = await bucket.file(key).download();
  if (buffer.length !== size) throw new Error("Stored receipt size changed");
  return buffer;
}

export async function removePrivateReceipt(key: string) {
  if (!/^kinglike-vip\/receipts\/[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(key)) return;
  const bucket = await checkedBucket();
  await bucket.file(key).delete({ignoreNotFound:true});
}


/** Private construction photos: never served from public Cloudinary or object URLs. */
export async function savePrivateProjectPhoto(projectId:number,data:Buffer,kind:"image/jpeg"|"image/png") {
  if(!Number.isSafeInteger(projectId)||projectId<1||data.length<8||data.length>8*1024*1024) {
    throw new Error("Invalid private project photo");
  }
  const bucket=await checkedBucket();
  const ext=kind==="image/jpeg"?"jpg":"png";
  const key="kinglike-vip/project-photos/"+projectId+"/"+randomUUID()+"."+ext;
  await bucket.file(key).save(data,{
    resumable:false,contentType:kind,
    metadata:{cacheControl:"private, no-store"},
    preconditionOpts:{ifGenerationMatch:0}
  });
  return key;
}

export async function readPrivateProjectPhoto(key:string):Promise<Buffer> {
  if(!/^kinglike-vip\/project-photos\/[1-9]\d*\/[0-9a-f-]{36}\.(jpg|png)$/.test(key)) {
    throw new Error("Invalid photo key");
  }
  const bucket=await checkedBucket();
  const [meta]=await bucket.file(key).getMetadata();
  const size=Number(meta.size);
  if(!Number.isSafeInteger(size)||size<8||size>8*1024*1024)throw new Error("Invalid photo size");
  const [data]=await bucket.file(key).download();
  if(data.length!==size)throw new Error("Private photo changed size");
  return data;
}

export async function removePrivateProjectPhoto(key:string):Promise<void> {
  if(!/^kinglike-vip\/project-photos\/[1-9]\d*\/[0-9a-f-]{36}\.(jpg|png)$/.test(key))return;
  const bucket=await checkedBucket();
  await bucket.file(key).delete({ignoreNotFound:true});
}
