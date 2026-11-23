/**
 * Neon object storage is S3-compatible and scoped to a database branch.
 * This only VALIDATES server-side configuration: it never provisions buckets,
 * requests credentials, stores files, or makes network calls.
 *
 * Production activation also requires independently confirming in the Neon
 * control plane that the selected bucket has access_level="private".
 * Never equate S3 HeadBucket success with a private bucket guarantee.
 */
export type VipNeonStorageConfig = Readonly<{
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}>;

export function readVipNeonStorageConfig(
  env: Record<string, string | undefined> = process.env,
): VipNeonStorageConfig {
  if (env.KINGLIKE_VIP_STORAGE_PROVIDER !== "neon-s3" ||
      env.KINGLIKE_VIP_NEON_BUCKET_PRIVATE_APPROVED !== "true") {
    throw new Error("VIP Neon storage has not been approved");
  }
  const bucket = env.KINGLIKE_VIP_NEON_BUCKET_NAME;
  const rawEndpoint = env.KINGLIKE_VIP_NEON_S3_ENDPOINT;
  const region = env.KINGLIKE_VIP_NEON_S3_REGION;
  const accessKeyId = env.KINGLIKE_VIP_NEON_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.KINGLIKE_VIP_NEON_S3_SECRET_ACCESS_KEY;
  if (!bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
      !rawEndpoint || !region || !/^[a-z]{2}-[a-z]+-\d$/.test(region) ||
      !accessKeyId || accessKeyId.length < 12 ||
      !secretAccessKey || secretAccessKey.length < 20) {
    throw new Error("VIP Neon storage configuration incomplete or invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawEndpoint);
  } catch {
    throw new Error("VIP Neon S3 endpoint invalid");
  }
  const host = parsed.hostname.toLowerCase();
  // The branch-specific Neon endpoint, not an arbitrary HTTPS endpoint or a
  // user-provided host. No insecure localhost override exists in production.
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.port || parsed.search || parsed.hash ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      !/^br-[a-z0-9-]+\.storage\.c-\d+\.[a-z0-9-]+\.aws\.neon\.(?:tech|build)$/.test(host)) {
    throw new Error("VIP Neon S3 endpoint must be an official branch HTTPS endpoint");
  }
  // A region mismatch means credentials/endpoint may resolve to a different
  // branch or cause a signing failure. Require exact region in the host.
  if (!host.endsWith("." + region + ".aws.neon.tech") &&
      !host.endsWith("." + region + ".aws.neon.build")) {
    throw new Error("VIP Neon storage region does not match endpoint");
  }
  return Object.freeze({
    bucket,
    endpoint: parsed.origin,
    region,
    accessKeyId,
    secretAccessKey,
  });
}
