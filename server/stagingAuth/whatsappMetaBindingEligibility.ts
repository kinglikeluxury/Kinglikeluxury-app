import type { NumberPreapproval } from "./whatsappPreapproval";

export function matchesCurrentVerifiedMetaPreapproval(
  request: Readonly<Record<string, unknown>>,
  preapprovals: readonly NumberPreapproval[],
  now = Date.now(),
): boolean {
  const employeeRef = request.employeeRef;
  const businessId = request.businessId;
  const wabaId = request.wabaId;
  const phoneNumberId = request.phoneNumberId;
  if (typeof employeeRef !== "string" || typeof businessId !== "string" ||
      typeof wabaId !== "string" || typeof phoneNumberId !== "string") return false;
  const employeeId = Number(employeeRef);
  if (!Number.isSafeInteger(employeeId) || employeeId < 1 ||
      !/^[0-9]{1,40}$/.test(businessId) ||
      !/^[0-9]{1,40}$/.test(wabaId) ||
      !/^[0-9]{1,40}$/.test(phoneNumberId)) return false;
  return preapprovals.some((item) =>
    item.employeeId === employeeId &&
    item.status === "meta_verified_pending_binding" &&
    item.expiresAt instanceof Date &&
    item.expiresAt.getTime() > now &&
    item.metaBusinessId === businessId &&
    item.metaWabaId === wabaId &&
    item.metaPhoneNumberId === phoneNumberId);
}
