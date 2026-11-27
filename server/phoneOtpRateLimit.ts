import type { IStorage } from "./storage";

export type OtpRateLimitConsumer = Pick<IStorage, "consumeOtpRateLimit">["consumeOtpRateLimit"];
export type PhoneOtpIssueRateLimitResult =
  | "allowed"
  | "phone_rate_limited"
  | "ip_rate_limited"
  | "ip_blocked";

export type PhoneOtpIssueRateLimitPolicy = {
  maxPerPhone: number;
  phoneWindowMs: number;
  maxPerIp: number;
  ipWindowMs: number;
  maxPerIpPerHour: number;
  hourlyWindowMs: number;
};

export type OtpIpRateLimitStatus = "ok" | "rate_limited" | "blocked";

export const DEFAULT_PHONE_OTP_ISSUE_POLICY: PhoneOtpIssueRateLimitPolicy = {
  maxPerPhone: 3,
  phoneWindowMs: 15 * 60 * 1000,
  maxPerIp: 5,
  ipWindowMs: 10 * 60 * 1000,
  // The existing policy blocked the tenth request in an hour.
  maxPerIpPerHour: 9,
  hourlyWindowMs: 60 * 60 * 1000,
};

export async function checkSharedOtpIpRateLimit(
  consume: OtpRateLimitConsumer,
  ipAddress: string,
  policy: Pick<
    PhoneOtpIssueRateLimitPolicy,
    "maxPerIp" | "ipWindowMs" | "maxPerIpPerHour" | "hourlyWindowMs"
  > = DEFAULT_PHONE_OTP_ISSUE_POLICY,
): Promise<OtpIpRateLimitStatus> {
  if (!ipAddress) return "blocked";
  const hourly = await consume(
    "otp-send-ip-hour",
    ipAddress,
    policy.maxPerIpPerHour,
    policy.hourlyWindowMs,
  );
  if (!hourly.allowed) return "blocked";

  const recent = await consume(
    "otp-send-ip",
    ipAddress,
    policy.maxPerIp,
    policy.ipWindowMs,
  );
  return recent.allowed ? "ok" : "rate_limited";
}

export async function checkPhoneOtpIssueRateLimit(
  consume: OtpRateLimitConsumer,
  phoneNumber: string,
  ipAddress: string,
  policy: PhoneOtpIssueRateLimitPolicy = DEFAULT_PHONE_OTP_ISSUE_POLICY,
): Promise<PhoneOtpIssueRateLimitResult> {
  if (!phoneNumber || !ipAddress) return "ip_blocked";

  const ipResult = await checkSharedOtpIpRateLimit(consume, ipAddress, policy);
  if (ipResult === "blocked") return "ip_blocked";
  if (ipResult === "rate_limited") return "ip_rate_limited";

  const phone = await consume(
    "phone-otp-send-phone",
    phoneNumber,
    policy.maxPerPhone,
    policy.phoneWindowMs,
  );
  if (!phone.allowed) return "phone_rate_limited";
  return "allowed";
}

export function createSharedPhoneOtpAttemptLimiter(
  consume: OtpRateLimitConsumer,
  options: { maxPerPhone?: number; maxPerIp?: number; windowMs?: number } = {},
): (phoneNumber: string, ipAddress: string) => Promise<boolean> {
  const maxPerPhone = options.maxPerPhone ?? 5;
  const maxPerIp = options.maxPerIp ?? 20;
  const windowMs = options.windowMs ?? 15 * 60 * 1000;

  return async (phoneNumber, ipAddress) => {
    if (!phoneNumber || !ipAddress) return false;
    const byPhone = await consume("phone-otp-attempt-phone", phoneNumber, maxPerPhone, windowMs);
    if (!byPhone.allowed) return false;
    const byIp = await consume("phone-otp-attempt-ip", ipAddress, maxPerIp, windowMs);
    return byIp.allowed;
  };
}
