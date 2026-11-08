import { createHmac } from "node:crypto";
import {
  isEligibleRegistration,
  normalizeWhatsappWebhook,
  verifyWhatsappSignature,
} from "./whatsappEmployeeWebhook";

/**
 * Staging-only, in-process parser smoke test.
 *
 * Deliberately does not call Meta, touch a database, register phone numbers,
 * process a real webhook, or expose message contents. This is NOT evidence
 * that an employee number is eligible for Coexistence or that live delivery works.
 */
export function evaluateSyntheticWhatsappStagingReadiness() {
  const secret = "synthetic-only-not-a-meta-secret";
  const raw = Buffer.from('{"object":"whatsapp_business_account","entry":[]}', "utf8");
  const signature = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

  const fixture = {
    object: "whatsapp_business_account",
    entry: [{
      id: "123456789",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "234567891" },
            contacts: [{ wa_id: "15550000002", user_id: "fixture-user-2" }],
            messages: [{
              id: "fixture-in",
              from: "15550000002",
              type: "text",
              text: { body: "Synthetic inbound" },
              timestamp: "1760000000",
            }],
            statuses: [{
              id: "fixture-out",
              recipient_id: "15550000002",
              status: "delivered",
              timestamp: "1760000001",
            }],
          },
        },
        {
          field: "smb_message_echoes",
          value: {
            metadata: {
              phone_number_id: "234567891",
              display_phone_number: "+15550000001",
            },
            contacts: [{ wa_id: "15550000002", user_id: "fixture-user-2" }],
            message_echoes: [{
              id: "fixture-echo",
              from: "15550000001",
              to: "15550000002",
              to_user_id: "fixture-user-2",
              type: "text",
              text: { body: "Synthetic outbound" },
              timestamp: "1760000002",
            }],
          },
        },
      ],
    }],
  };

  const events = normalizeWhatsappWebhook(fixture);
  const registration = {
    registration_kind: "company",
    is_active: true,
    consent_status: "consented",
    revoked_at: null,
    business_authorized_at: "synthetic-authorization",
    coexistence_enabled: true,
    coexistence_verified_at: "synthetic-verification",
    coexistence_verification_ref: "synthetic-only",
    display_phone_number: "+15550000001",
  };

  const checks = {
    validHmacAccepted: verifyWhatsappSignature(raw, signature, secret),
    changedBodyRejected: !verifyWhatsappSignature(Buffer.concat([raw, Buffer.from(" ")]), signature, secret),
    inboundParsed: events.some(event =>
      event.eventKey === "message:fixture-in" && event.direction === "inbound"),
    deliveryStatusParsed: events.some(event =>
      event.eventKey === "status:fixture-out" && event.direction === "status"),
    coexistenceEchoParsed: events.some(event =>
      event.eventKey === "echo:message:fixture-echo" && event.direction === "outbound"),
    untrustedObjectRejected: normalizeWhatsappWebhook({ ...fixture, object: "page" }).length === 0,
    revokedConsentBlocked: !isEligibleRegistration(
      { ...registration, consent_status: "revoked", revoked_at: "synthetic-revocation" },
      "messages",
    ),
    unverifiedCoexistenceBlocked: !isEligibleRegistration(
      { ...registration, coexistence_verified_at: null }, "smb_message_echoes", "+15550000001",
    ),
    mismatchedCompanyNumberBlocked: !isEligibleRegistration(
      registration, "smb_message_echoes", "+15559999999",
    ),
  };

  return {
    scope: "synthetic_parser_only" as const,
    liveMetaConnected: false as const,
    realEmployeeNumbersAuthorized: false as const,
    databaseAndWebhookDeliveryTested: false as const,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}
