# WhatsApp staging synthetic readiness smoke test

Status: Draft review only — not a Meta connection or employee archive.

This patch is based on the deployed WhatsApp review candidate and proposes one
read-only, server-side staging endpoint:

GET /api/admin/staging/whatsapp-synthetic-readiness

## Safety contract

- The endpoint responds with 404 unless APP_DEPLOYMENT_MODE=staging.
- It responds with 403 unless the existing server session has isAdmin=true.
- It adds Cache-Control: no-store and returns fixed check booleans only.
- No Meta SDK, Graph API, webhook subscription, live phone number, customer
  conversation, access token, external HTTP request, DB read/write, schema
  migration, employee assignment, or outbound message is involved.
- No real numbers or user-provided identifiers are embedded in the fixture.
- The global staging guard continues blocking actual WhatsApp/Meta webhooks,
  onboarding and outbound send routes. This narrowly scoped read-only endpoint
  lives at a distinct URL and does not weaken that block.
- The frontend remains mock-only. All normal live enablement flags stay off.

## Synthetic checks

- Correct raw-body HMAC accepted; changed body rejected.
- Inbound messages payload parsed.
- Delivery statuses payload parsed.
- WhatsApp Business app smb_message_echoes payload parsed.
- Untrusted webhook object rejected.
- Employee consent revocation, missing Coexistence verification, and mismatched
  business numbers reject intake.

These are in-process parser checks, not real webhook delivery, Meta
eligibility or DB persistence tests. The endpoint reports
liveMetaConnected=false, realEmployeeNumbersAuthorized=false, and
databaseAndWebhookDeliveryTested=false, regardless of synthetic results.

## Verification

Run in a local checkout with dependencies installed:

    node --import tsx --test server/whatsappStagingReadiness.test.ts

The test covers synthetic parser results and local HTTP status 404/403/200.
Actual deployment, independent tests, and human review remain pending.

## Production and onboarding remain blocked

Do not merge this isolated patch into main, point Meta Webhooks at Staging,
change a real number's API registration, toggle employee monitoring flags,
add a real verifier, or use any customer/employee data.

The staging-only smoke test does not complete the work needed for actual
Coexistence onboarding. That still requires verified per-number Meta v4
onboarding, explicit employee notices and consent, trusted WABA/phone ownership
checks, signed inbound delivery, tested session/admin controls, audit-before-read,
retention and deletion policy, and a separate documented go/no-go decision.
