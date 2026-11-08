# Kinglike Luxury: employee WhatsApp Coexistence — safe next milestone

**Status:** Draft, staging-only readiness. This is not a working real-number onboarding feature.

## Verified in the current testing session

- Meta TEST WABA webhook HMAC and challenge tests succeeded in Railway Staging.
- Meta delivered four webhook POSTs after a single authorized test message; Railway returned HTTP 200.
- Meta test phone's webhook override was removed afterward; the application's default Replit callback remained.
- None of this verifies any real employee's phone number, Meta Coexistence eligibility, access permissions, consent evidence, or a real-number webhook route.
- A staff member has WhatsApp Business and has verbally consented to a prospective work-account integration. Record formal notice/consent through the approved business process **before** activation.
- Do not synchronize previous chats by default. Meta history sharing is distinct from consent for future work messages.

## What this PR does

- Adds read-only GET `/api/admin/staging/whatsapp-coexistence-readiness`.
- Returns 404 outside `APP_DEPLOYMENT_MODE=staging`; 403 to non-admin sessions.
- Never returns secrets, customer message text, employee phone numbers, WABA or phone IDs.
- Clearly returns `safeToStartEmployeeSignup:false` even if all feature flags are set and the test WABA is ready.
- Adds synthetic tests and CI.
- Does not change `main`, production, Railway or Meta; no migrations, outbound network calls, message send, or data ingestion.

## Critical path before enabling Samer or any actual employee

1. **Backend:** implement real Embedded Signup v4 server-side one-time code exchange and token validation. Verify business portfolio / WABA / phone IDs and Meta's `is_on_biz_app` + `platform_type` for the exact number. Existing onboarding routes are test-only; the production verifier is not wired to them.
2. **Persistent proof:** design and test reviewed non-test migrations/repository, company-number allowlist and employee consent proof with revocation and least-privilege access. No auth codes or tokens in ordinary tables or logs.
3. **Delivery:** use a webhook receiver authenticated with app secret and narrow WABA/phone allowlist, with separate Coexistence `smb_message_echoes`/history/app-state checks; do not repoint the production/CRM callback.
4. **Privacy:** approve notice to employees and customers, purpose limitation, legal basis, retention/deletion and incident response before any personal data capture. `Share all chats` is not assumed; historical chats require a separate documented decision.
5. **Release:** pass synthetic and isolated Staging tests; stage but do not activate; independently approve pilot with one company-controlled number, rollback and monitoring.

## Scope and owner actions

No actions are currently required from the employee's phone. No one should press `Confirm` in WhatsApp Business Platform, scan a link or share previous chats until all gates have been reviewed.

The new endpoint is a *diagnostic*, not a claim that live Coexistence is approved. Deploy only after code review; do not merge or modify production as part of this draft.
