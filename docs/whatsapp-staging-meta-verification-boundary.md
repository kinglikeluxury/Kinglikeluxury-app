# Staff WhatsApp Coexistence – real Meta verification boundary

**Status:** Draft / not enabled. Does not connect Samer or any other real number.

This branch connects the existing server-side Meta Graph verifier to the
isolated Staging enrollment API, but only behind several independent release
gates. The server has no credential values in code. If settings are missing,
the provider is not constructed and the enrollment routes return 404.

## Independent gates (do not set before approval)

- The isolated Staging app database and storage identities must be verified.
- The previous `WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED` and proof-schema
  review, employee notice review, exact employee-number allowlist apply.
- `WHATSAPP_STAGING_GRAPH_PILOT_OWNER_APPROVED=true` requires a separate
  explicit business-owner approval after Meta and privacy readiness review.
- `WHATSAPP_STAGING_META_GRAPH_VERIFIER_ENABLED=true` is a separate deployment
  control. Neither flag is enabled by this draft.
- `WHATSAPP_STAGING_META_APP_ID` and approved business portfolio must match
  the company-owned, reviewed Meta app and portfolio IDs.
- `WHATSAPP_STAGING_META_APP_SECRET` is provided only through encrypted
  environment configuration and must never be shared in chat.
- `WHATSAPP_STAGING_META_API_VERSION=v27.0` is explicit and must be
  reviewed against current Meta docs before launch.

Only the opt-in verified-signup endpoint receives an injected Graph verifier.
All other Staging Meta/Twilio/WhatsApp egress protections remain in place.

## Verification sequence

Given a one-time code and Meta FINISH identifiers, the server (not browser):
1. Checks the exact company portfolio and employee work phone allowlist.
2. Atomically consumes a short-lived server-session-bound CSRF/state flow.
3. Exchanges the code for a temporary access token, uses `debug_token` to
   verify it belongs to the correct Meta app and grants both WhatsApp scopes.
4. Reads the portfolio-to-WABA relationship, WABA-to-phone membership,
   exact display number, and the `is_on_biz_app`/`platform_type` fields.
5. Saves ONLY a verification proof in the reviewed Staging repository,
   with status `verified_pending_activation` — no chat ingestion.

No Meta call has been made from this code in the current change; CI uses
a synthetic injected Graph fetch. Nothing in this branch stores credentials,
changes Meta webhooks, synchronizes history, sends a message, registers a phone
in production, or enables the UI Connect button.

## Blockers before a real employee can be asked to confirm

- Official Meta app/provider eligibility and the current Coexistence flow
  need independent verification.
- Review legal basis and notices for both employee and customers; retain
  proof of consent, permitted scope, retention/erasure, and revocation.
- Review/manual migration of the Staging proof schema with narrow DB
  permissions and audit controls (not applied by this PR).
- Confirm HTTPS origin, server-side session storage, CSRF and token handling
  end to end in isolated Staging.
- Complete and test real employee webhook/HMAC, ownership allowlist and
  staff work-only conversation archive.
- Business owner gives explicit approval *after* reviewing these items.

Do not press Confirm on the employee phone, grant history sharing, or
activate any real number merely because synthetic CI succeeds.
