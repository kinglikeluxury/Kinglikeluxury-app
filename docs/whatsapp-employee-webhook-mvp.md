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
  number's `coexistence_enabled` registration.
- No raw webhook body is persisted. Only normalized fields are stored.

## Supported webhook shapes

`messages` text/media metadata and delivery/read status events are normalized.
`smb_message_echoes` are treated as outbound echoes only for an explicitly
Coexistence-enabled number. The implementation does not contact Meta to determine
Coexistence eligibility; that must be established and recorded by a separate,
reviewed onboarding process.

## Not included

No employee/admin read APIs, UI archive, consent capture/revocation workflow,
number onboarding, attachment download, media storage, retention controls, or
production/staging database migration is included. Those require a separate
reviewed phase before any real number can be linked.
