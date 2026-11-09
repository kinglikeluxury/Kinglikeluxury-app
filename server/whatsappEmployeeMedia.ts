/**
 * Strict, metadata-only WhatsApp media normalization for the employee archive.
 * Never persist or expose Meta media IDs, temporary URLs, filenames, or raw
 * media bytes through this contract. Media retrieval is a separate future
 * gated workflow with access audits and private object storage.
 */
export type EmployeeWhatsappMediaKind = "image" | "video" | "document" | "audio" | "sticker";

export type EmployeeWhatsappMediaMetadata = {
  mimeType: string | null;
  sizeBytes: number | null;
  sha256Hex: string | null;
};

const KINDS: ReadonlySet<string> = new Set(["image", "video", "document", "audio", "sticker"]);
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

export function isEmployeeWhatsappMediaKind(value: unknown): value is EmployeeWhatsappMediaKind {
  return typeof value === "string" && KINDS.has(value);
}

function normalizedSha256(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();

  // Meta sends the SHA-256 digest as base64 in several media webhook shapes.
  if (!/^[a-zA-Z0-9+/]{43}=$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value) return null;
  return bytes.toString("hex");
}

export function normalizeEmployeeWhatsappMedia(
  type: unknown,
  message: unknown,
): EmployeeWhatsappMediaMetadata | null {
  if (!isEmployeeWhatsappMediaKind(type) || !message || typeof message !== "object" ||
      Array.isArray(message)) return null;

  const raw = (message as Record<string, unknown>)[type];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    // Media is declared but no metadata is supplied. Do not invent metadata.
    return { mimeType: null, sizeBytes: null, sha256Hex: null };
  }
  const record = raw as Record<string, unknown>;
  const candidate = typeof record.mime_type === "string" ? record.mime_type.trim().toLowerCase() : "";
  const mimeType = candidate.length <= 255 && MIME_PATTERN.test(candidate) ? candidate : null;
  const rawSize = record.file_size ?? record.size;
  const sizeBytes = typeof rawSize === "number" && Number.isSafeInteger(rawSize) && rawSize >= 0
    ? rawSize : null;

  return {
    mimeType,
    sizeBytes,
    sha256Hex: normalizedSha256(record.sha256),
  };
}
