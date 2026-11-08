# Verified employee Embedded Signup: Staging server boundary

**Draft only.** This code adds a real HTTP backend boundary and SQL persistence
adapter for a future reviewed Embedded Signup v4 pilot. It is deliberately not
an active real-employee integration.

## APIs

- `GET /api/admin/staging/whatsapp-verified-signup/csrf`: session-bound CSRF.
- `POST /api/admin/staging/whatsapp-verified-signup/start`: one-time 5-minute
  flow with hashed state, session binding and nonce.
- `POST /api/admin/staging/whatsapp-verified-signup/finish`: verifies exact
  approved phone and business portfolio BEFORE calling the verifier; uses the
  existing server-only Meta proof validator and atomic SQL flow consumption.
  Saves only verification metadata, never one-time codes or access tokens.
  The result is `verified_pending_activation`, not a connected employee.

## Hard release gates

All routes return 404 in the actual app today, because a real Meta verifier is
**intentionally not injected**, irrespective of environment variables.

Even after an authorized release wires a trusted verifier, the following
settings must all pass in an isolated Staging environment:

- `APP_DEPLOYMENT_MODE=staging` and independently verified Staging database.
- `WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED=true`.
- `WHATSAPP_STAGING_APPROVED_BUSINESS_PORTFOLIO_ID` exactly matches the
  approved company portfolio.
- `WHATSAPP_STAGING_APPROVED_EMPLOYEE_PHONE` is the one approved E.164 work number.
- `WHATSAPP_STAGING_EMPLOYEE_NOTICE_REVIEWED=true` and
  `WHATSAPP_STAGING_PROOF_SCHEMA_REVIEWED=true` are release attestations,
  **not substitutes for actual legal basis, informed employee consent, customer
  notice or the completed schema review**.

The app has no separate real Graph verifier injection and no browser connect
button activation. Nothing in this PR should be deployed solely by setting
flags: the Meta onboarding itself can modify a real WhatsApp Business account.

## Security measures

- Admin identity is revalidated against the server session and active user.
- Exact HTTPS origin + Host checks on every request.
- CSRF on START and FINISH, random state + 300-second TTL, session-hash binding.
- Atomic database consume and duplicate phone proof constraint from the
  manual `2026-11-08-whatsapp-onboarding-proof.sql.txt` schema.
- API response logging is disabled for the signup endpoints.
- No Graph calls, Meta webhook changes, staff chat retrieval, data import,
  message sending, feature-flag changes or schema migration.
- Synthetic tests exercise disabled production, bad DB identity, missing
  employee notice review, CSRF, number mismatch, and duplicate flow replays.

## Unresolved before piloting Samer

1. Complete staff/customer privacy notices, consent evidence, audit and deletion
   policy. Company phone ownership must be checked in Meta, not assumed.
2. Review and apply the manual proof schema to an **isolated Staging DB only**,
   with a separate migration owner and restricted runtime grants.
3. Explicitly review real Meta Graph v4 exchange/verifier wiring and
   outbound-access exception for this one endpoint. The generic Staging
   external-egress block must remain enforced for all other routes.
4. Validate existing Meta app/portfolio assets and Coexistence partner status.
5. Review the real Webhook receiver, `smb_message_echoes` support and
   minimal retention policy; keep history synchronization off by default.
6. Only after these are complete, decide whether to launch a single-number
   time-bounded test, with rollback and business-owner approval.
