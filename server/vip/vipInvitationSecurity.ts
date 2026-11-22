import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const VIP_INVITATION_TTL_HOURS = 72;
export const VIP_INVITATION_COOLDOWN_MINUTES = 15;

export function normalizedVipEmail(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 254) return null;
  const e = raw.trim().toLowerCase();
  if (e.length < 6 || e.length > 254 || /\s/.test(e)) return null;
  if (!/^[^@<>]+@[^@<>]+\.[^@<>]+$/.test(e)) return null;
  return e;
}

export function validInvitationToken(raw: unknown): raw is string {
  return typeof raw === "string" && /^[a-f0-9]{64}$/.test(raw);
}

export function newInvitationToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sameEmail(expected: string, candidate: string): boolean {
  const a = Buffer.from(expected.trim().toLowerCase());
  const b = Buffer.from(candidate.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validNewVipPassword(input: unknown): input is string {
  return typeof input === "string" &&
    input.length >= 12 && input.length <= 72 &&
    /[a-z]/.test(input) && /[A-Z]/.test(input) && /\d/.test(input);
}

export function allowedVipInviteRecipient(email: string): boolean {
  if (process.env.KINGLIKE_VIP_EMAIL_ENABLED !== "true") return false;
  const allow = (process.env.KINGLIKE_VIP_INVITE_ALLOWED_EMAILS || "")
    .split(",").map(x => normalizedVipEmail(x)).filter((x): x is string=>!!x);
  if (allow.includes(email)) return true;
  return process.env.KINGLIKE_VIP_EMAIL_LIVE_APPROVED === "true";
}

export function vipActivationLink(token: string): string {
  if (!validInvitationToken(token)) throw new Error("Invalid invitation token");
  const raw = process.env.KINGLIKE_VIP_BASE_URL;
  if (!raw) throw new Error("VIP base URL not configured");
  const base = new URL(raw);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("VIP activation requires a clean HTTPS base URL");
  }
  const url = new URL("/vip/activate", base);
  url.searchParams.set("token", token);
  return url.toString();
}

export function safeEmailMarkup(value: string): string {
  return value.replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c] || c));
}
