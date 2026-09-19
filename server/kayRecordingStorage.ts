import { createHash, createHmac } from "node:crypto";

const SIGNED_URL_TTL_SECONDS = 300;

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

/**
 * Creates an S3-compatible SigV4 GET URL without importing a provider SDK.
 * This is deliberately read-only: recording uploads are a future lifecycle hook,
 * not part of recording-foundation.
 */
export function createKayRecordingSignedReadUrl(
  objectKey: string,
  ttlSeconds = SIGNED_URL_TTL_SECONDS,
  disposition: "inline" | "attachment" = "inline",
): string | null {
  const config = readConfig();
  const key = objectKey.trim();
  if (!config || !key || key.includes("..") || key.startsWith("/")) return null;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const shortDate = amzDate.slice(0, 8);
  const host = config.endpoint.host;
  const path = `${config.endpoint.pathname.replace(/\/$/, "")}/${encodePathPart(config.bucket)}/${encodePathPart(key)}`;
  const credentialScope = `${shortDate}/${config.region}/s3/aws4_request`;
  const credential = `${config.accessKeyId}/${credentialScope}`;
  const expires = Math.max(1, Math.min(SIGNED_URL_TTL_SECONDS, Math.floor(ttlSeconds)));
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
    "response-content-disposition": disposition === "attachment"
      ? `attachment; filename="kay-recording-${shortDate}.webm"`
      : "inline",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map(name => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`)
    .join("&");
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    "GET",
    path,
    canonicalQuery,
    canonicalHeaders,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, shortDate), config.region), "s3"),
    "aws4_request",
  );
  query["X-Amz-Signature"] = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const finalQuery = Object.keys(query)
    .sort()
    .map(name => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`)
    .join("&");
  return `${config.endpoint.origin}${path}?${finalQuery}`;
}