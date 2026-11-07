# Employee WhatsApp webhook MVP

This branch is a webhook-only backend MVP. It does not connect production WhatsApp,
send messages, call the Meta Graph API, or expose a conversation archive.

## Safety gates

- `WHATSAPP_EMPLOYEE_MONITORING_ENABLED` must be exactly `true`; otherwise both webhook routes return 404.
- `WHATSAPP_EMPLOYEE_WEBHOOK_VERIFY_TOKEN` and `WHATSAPP_EMPLOYEE_META_APP_SECRET`
  are read only while serving the corresponding request.
- Persistence is restricted to `NODE_ENV=test` and `WHATSAPP_EMPLOYEE_TEST_DATABASE_URL`
  pointing to a loopback host with a test-only database name.
- The SQL file under `docs/sql/` is not run automatically.
- A phone number must be explicitly active, marked business-authorized, and have
  non-revoked employee consent. Coexistence echo events additionally require the
  company registration, `coexistence_enabled`, and a recorded verification
  timestamp/reference; these fields remain fail-closed records, not Meta proof.
- No raw webhook body is persisted. Only normalized fields are stored.

## Supported webhook shapes

`messages` text/media captions and delivery/read status events are normalized.
`smb_message_echoes` uses Meta's `message_echoes` array; the business display
number is checked against `from`, and `to`/`to_user_id` is used for the customer.
The display number must also match the company registration for the exact WABA
and phone-number ID.
Documented `edit`/`revoke` notices are separate immutable event rows linked to an
existing outbound message; they never rewrite/delete that message. Unsupported
types or unresolved originals are rejected. The implementation does not contact
Meta to establish Coexistence eligibility; a trusted onboarding verification
process remains a pre-production requirement.

## Not included

No employee/admin read APIs, UI archive, consent capture/revocation workflow,
number onboarding, attachment download, media storage, retention controls, or
production/staging database migration is included. Those require a separate
reviewed phase before any real number can be linked.
