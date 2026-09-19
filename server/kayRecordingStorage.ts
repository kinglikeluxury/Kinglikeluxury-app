import { createHash, createHmac } from "node:crypto";

export const KAY_RECORDING_SIGNED_URL_TTL_SECONDS = 300;
export const KAY_RECORDING_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const KAY_RECORDING_AUDIO_MIME_TYPES = Object.freeze({
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
} as const);

export type KayRecordingStorageStatus = {
  configured: boolean;
  provider: "s3-compatible" | "unconfigured";
  reason?: string;
};

type StorageConfig = {
  endpoint: URL;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

function readConfig(): StorageConfig | null {
  const endpoint = process.env.KAY_RECORDING_STORAGE_ENDPOINT?.trim();
  const bucket = process.env.KAY_RECORDING_STORAGE_BUCKET?.trim();
  const accessKeyId = process.env.KAY_RECORDING_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.KAY_RECORDING_STORAGE_SECRET_ACCESS_KEY?.trim();
  const region = process.env.KAY_RECORDING_STORAGE_REGION?.trim() || "auto";
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

  try {
    const parsed = new URL(endpoint);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return { endpoint: parsed, bucket, accessKeyId, secretAccessKey, region };
  } catch {
    return null;
  }
}

export function getKayRecordingStorageStatus(): KayRecordingStorageStatus {
  return readConfig()
    ? { configured: true, provider: "s3-compatible" }
    : {
        configured: false,
        provider: "unconfigured",
        reason: "Private recording storage is not configured; playback and upload remain unavailable.",
      };
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, "/");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function hash(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeObjectKey(value: string): string | null {
  const key = value.trim();
  if (
    !key ||
    key.length > 512 ||
    key.startsWith("/") ||
    key.includes("..") ||
    key.includes("\\") ||
    key.includes("\0")
  ) return null;
  return key;
}

export function isSafeKayRecordingObjectKey(value: string): boolean {
  return safeObjectKey(value) !== null;
}

function storageError(message: string, code: string, status?: number): Error & {
  code: string;
  status?: number;
} {
  return Object.assign(new Error(message), { code, ...(status === undefined ? {} : { status }) });
}

type SignedRequest = {
  method: "GET" | "HEAD" | "PUT" | "DELETE";
  objectKey: string;
  contentType?: string;
  payloadHash: string;
  query?: Record<string, string>;
  presigned?: boolean;
};

type SigningContext = {
  amzDate: string;
  shortDate: string;
  credentialScope: string;
};

function createSigningContext(config: StorageConfig): SigningContext {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const shortDate = amzDate.slice(0, 8);
  return {
    amzDate,
    shortDate,
    credentialScope: `${shortDate}/${config.region}/s3/aws4_request`,
  };
}

function signRequest(
  config: StorageConfig,
  request: SignedRequest,
  context = createSigningContext(config),
) {
  const key = safeObjectKey(request.objectKey);
  if (!key) throw storageError("Invalid private recording object key.", "KAY_RECORDING_INVALID_OBJECT_KEY", 400);

  const host = config.endpoint.host;
  const path = `${config.endpoint.pathname.replace(/\/$/, "")}/${encodePathPart(config.bucket)}/${encodePathPart(key)}`;
  const headers: Record<string, string> = { host };
  if (request.contentType) headers["content-type"] = request.contentType;
  if (!request.presigned) {
    headers["x-amz-content-sha256"] = request.payloadHash;
    headers["x-amz-date"] = context.amzDate;
  }
  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map(name => `${name}:${headers[name]}\n`).join("");
  const canonicalQuery = Object.entries(request.query ?? {})
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
  const canonicalRequest = [
    request.method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders.join(";"),
    request.payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    context.amzDate,
    context.credentialScope,
    hash(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, context.shortDate), config.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${context.credentialScope}`,
    `SignedHeaders=${signedHeaders.join(";")}`,
    `Signature=${signature}`,
  ].join(", ");

  return {
    method: request.method,
    path: canonicalQuery ? `${path}?${canonicalQuery}` : path,
    headers: {
      Host: host,
      ...(request.contentType ? { "Content-Type": request.contentType } : {}),
      "x-amz-content-sha256": request.payloadHash,
      "x-amz-date": context.amzDate,
      Authorization: authorization,
    },
    amzDate: context.amzDate,
    credential: `${config.accessKeyId}/${context.credentialScope}`,
  };
}

type StorageResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  errorCode?: string;
};

async function requestStorage(
  config: StorageConfig,
  signed: ReturnType<typeof signRequest>,
  body?: Buffer,
): Promise<StorageResponse> {
  const response = await fetch(`${config.endpoint.origin}${signed.path}`, {
    method: signed.method,
    headers: {
      ...signed.headers,
      ...(body === undefined
        ? (signed.method === "HEAD" || signed.method === "DELETE" ? { "Content-Length": "0" } : {})
        : { "Content-Length": String(body.length) }),
    },
    body: body === undefined ? undefined : body,
    signal: AbortSignal.timeout(20_000),
  });
  const headers = Object.fromEntries(response.headers.entries());
  const responseBody = response.ok || signed.method === "HEAD" ? "" : await response.text().catch(() => "");
  return {
    statusCode: response.status,
    headers,
    errorCode: responseBody.match(/<Code>([^<]+)<\/Code>/)?.[1],
  };
}

function isTransientStorageFailure(error: any): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(error?.statusCode)) ||
    ["EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ENETUNREACH", "ETIMEDOUT"].includes(error?.code);
}

function responseHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Creates an S3-compatible SigV4 GET URL without importing a provider SDK.
 * This remains the only externally usable object access path.
 */
export function createKayRecordingSignedReadUrl(
  objectKey: string,
  ttlSeconds = KAY_RECORDING_SIGNED_URL_TTL_SECONDS,
  disposition: "inline" | "attachment" = "inline",
): string | null {
  const config = readConfig();
  const key = safeObjectKey(objectKey);
  if (!config || !key) return null;

  const expires = Math.max(1, Math.min(KAY_RECORDING_SIGNED_URL_TTL_SECONDS, Math.floor(ttlSeconds)));
  const context = createSigningContext(config);
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${context.credentialScope}`,
    "X-Amz-Date": context.amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
    "response-content-disposition": disposition === "attachment"
      ? "attachment; filename=\"kay-recording.webm\""
      : "inline",
  };
  const signed = signRequest(config, {
    method: "GET",
    objectKey: key,
    payloadHash: "UNSIGNED-PAYLOAD",
    query,
    presigned: true,
  }, context);
  const queryString = Object.entries({
    ...query,
    "X-Amz-Signature": signed.headers.Authorization.split("Signature=")[1],
  })
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
  const signedPath = signed.path.split("?")[0];
  return `${config.endpoint.origin}${signedPath}?${queryString}`;
}

export type KayRecordingStorageUploadResult = {
  bytesUploaded: number;
  sha256: string;
  etag: string | null;
  checksumSha256: string | null;
};

export async function uploadKayRecordingObject(input: {
  objectKey: string;
  body: Buffer;
  contentType: string;
}): Promise<KayRecordingStorageUploadResult> {
  const config = readConfig();
  const key = safeObjectKey(input.objectKey);
  if (!config) throw storageError("Private recording storage is not configured.", "KAY_RECORDING_STORAGE_UNAVAILABLE", 503);
  if (!key) throw storageError("Invalid private recording object key.", "KAY_RECORDING_INVALID_OBJECT_KEY", 400);
  if (!Buffer.isBuffer(input.body)) throw storageError("Audio upload body must be a Buffer.", "KAY_RECORDING_INVALID_BODY", 400);
  if (input.body.length > KAY_RECORDING_MAX_AUDIO_BYTES) {
    throw storageError("Audio upload exceeds the maximum allowed size.", "KAY_RECORDING_AUDIO_TOO_LARGE", 413);
  }

  const payloadHash = hash(input.body);
  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const signed = signRequest(config, {
        method: "PUT",
        objectKey: key,
        contentType: input.contentType,
        payloadHash,
      });
      const response = await requestStorage(config, {
        ...signed,
        headers: { ...signed.headers, "Content-Type": input.contentType },
      }, input.body);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Object.assign(new Error("Private storage upload was rejected."), {
          code: "KAY_RECORDING_STORAGE_UPLOAD_REJECTED",
          statusCode: response.statusCode,
        });
      }
      const head = await headKayRecordingObject(key);
      return {
        bytesUploaded: input.body.length,
        sha256: payloadHash,
        etag: responseHeader(response.headers, "etag") ?? head.etag,
        checksumSha256: responseHeader(response.headers, "x-amz-checksum-sha256") ?? null,
      };
    } catch (error) {
      lastError = error;
      if (!isTransientStorageFailure(error) || attempt === 2) break;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  if (lastError?.code === "KAY_RECORDING_STORAGE_UPLOAD_REJECTED") {
    const error = storageError("Private storage upload failed.", "KAY_RECORDING_STORAGE_UPLOAD_FAILED", 503);
    (error as any).storageStatus = lastError.statusCode;
    throw error;
  }
  const error = storageError("Private storage upload failed.", "KAY_RECORDING_STORAGE_UPLOAD_FAILED", 503);
  if (lastError?.storageStatus !== undefined) (error as any).storageStatus = lastError.storageStatus;
  throw error;
}

export async function headKayRecordingObject(objectKey: string): Promise<{
  etag: string | null;
  bytes: number | null;
}> {
  const config = readConfig();
  const key = safeObjectKey(objectKey);
  if (!config) throw storageError("Private recording storage is not configured.", "KAY_RECORDING_STORAGE_UNAVAILABLE", 503);
  if (!key) throw storageError("Invalid private recording object key.", "KAY_RECORDING_INVALID_OBJECT_KEY", 400);
  const signed = signRequest(config, {
    method: "HEAD",
    objectKey: key,
    payloadHash: hash(""),
  });
  const response = await requestStorage(config, {
    ...signed,
    headers: { ...signed.headers },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = storageError("Private storage object verification failed.", "KAY_RECORDING_OBJECT_VERIFY_FAILED", 503);
    (error as any).storageStatus = response.statusCode;
    (error as any).storageCode = response.errorCode;
    throw error;
  }
  const contentLength = responseHeader(response.headers, "content-length");
  return {
    etag: responseHeader(response.headers, "etag") ?? null,
    bytes: contentLength && /^\d+$/.test(contentLength) ? Number(contentLength) : null,
  };
}

/**
 * Reserved for a future admin-controlled retention cleanup job. No route or
 * automatic lifecycle path calls this function.
 */
export async function deleteKayRecordingObject(objectKey: string): Promise<void> {
  const config = readConfig();
  const key = safeObjectKey(objectKey);
  if (!config) throw storageError("Private recording storage is not configured.", "KAY_RECORDING_STORAGE_UNAVAILABLE", 503);
  if (!key) throw storageError("Invalid private recording object key.", "KAY_RECORDING_INVALID_OBJECT_KEY", 400);
  const signed = signRequest(config, {
    method: "DELETE",
    objectKey: key,
    payloadHash: hash(""),
  });
  const response = await requestStorage(config, {
    ...signed,
    headers: { ...signed.headers },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = storageError("Private storage deletion failed.", "KAY_RECORDING_STORAGE_DELETE_FAILED", 503);
    (error as any).storageStatus = response.statusCode;
    (error as any).storageCode = response.errorCode;
    throw error;
  }
}
