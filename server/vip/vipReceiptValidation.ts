export const MAX_VIP_RECEIPT_BYTES = 10 * 1024 * 1024;
export type ReceiptMime = "application/pdf" | "image/jpeg" | "image/png";

export function inspectReceiptFile(data: Buffer): { mime: ReceiptMime; extension: "pdf" | "jpg" | "png" } | null {
  if (!Buffer.isBuffer(data) || data.length < 8 || data.length > MAX_VIP_RECEIPT_BYTES) return null;
  if (data.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    // The PDF must have an EOF marker near the end, not merely a renamed executable.
    const tail = data.subarray(Math.max(0, data.length - 2048)).toString("latin1");
    return tail.includes("%%EOF") ? { mime: "application/pdf", extension: "pdf" } : null;
  }
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return { mime: "image/png", extension: "png" };
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mime: "image/jpeg", extension: "jpg" };
  }
  return null;
}

export function normalizeReceiptName(raw: unknown): string {
  if (typeof raw !== "string") return "receipt";
  const normalized = raw
    .replace(/[\u0000-\u001f\u007f<>:"\\\/|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return normalized || "receipt";
}

export function amountToCents(raw: string): bigint | null {
  if (!/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, decimal=""] = raw.split(".");
  const cents = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0") || "0");
  return cents > 0n ? cents : null;
}

export function centsToAmount(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return sign + String(absolute / 100n) + "." + String(absolute % 100n).padStart(2,"0");
}
