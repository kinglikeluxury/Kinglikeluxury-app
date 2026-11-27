import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import type { ReceiptMime } from "../vipReceiptValidation";

const storageDir = process.env.VIP_TEST_STORAGE_DIR;
if (
  !storageDir ||
  !/^\/tmp\/kinglike-vip-files-[A-Za-z0-9_-]+$/.test(storageDir)
) {
  throw new Error("Receipt integration test requires a dedicated temporary file directory");
}

const root = path.resolve(storageDir);
const RECEIPT_KEY = /^kinglike-vip\/receipts\/[0-9a-f-]{36}\.(pdf|jpg|png)$/;
const MAX_BYTES = 10 * 1024 * 1024;

function resolveReceiptKey(key: string): string {
  if (typeof key !== "string" || !RECEIPT_KEY.test(key)) {
    throw new Error("Invalid synthetic receipt key");
  }
  const target = path.resolve(root, key);
  if (!target.startsWith(root + path.sep)) {
    throw new Error("Receipt path escaped temporary storage");
  }
  return target;
}

export async function savePrivateReceipt(
  data: Buffer,
  _mime: ReceiptMime,
  extension: string,
): Promise<string> {
  if (!Buffer.isBuffer(data) || data.length < 1 || data.length > MAX_BYTES) {
    throw new Error("Invalid synthetic receipt size");
  }
  const key = `kinglike-vip/receipts/${randomUUID()}.${extension}`;
  const target = resolveReceiptKey(key);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const parent = await lstat(path.dirname(target));
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error("Synthetic receipt directory is not a private directory");
  }
  const handle = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
  return key;
}

export async function readPrivateReceipt(key: string): Promise<Buffer> {
  const target = resolveReceiptKey(key);
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > MAX_BYTES) {
      throw new Error("Invalid synthetic receipt file");
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function removePrivateReceipt(key: string): Promise<void> {
  const target = resolveReceiptKey(key);
  await unlink(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
