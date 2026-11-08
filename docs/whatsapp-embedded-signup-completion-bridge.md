# Meta Embedded Signup code/session bridge (draft, no live activation)

## Why

Meta sends two signals during WhatsApp Business App Onboarding:
1. A short-lived one-time authorization code via `FB.login` callback.
2. The WABA/business portfolio/phone identifiers via `WA_EMBEDDED_SIGNUP` FINISH postMessage.

These may arrive in either order. Previously, the review UI treated them as independent
diagnostics and discarded the code without a coordinated completion handoff.

## What changed

- `MetaSignupCompletionBridge` coordinates both signals in process memory only.
- Rejects malformed or incomplete values, conflicting IDs/codes, expired flows,
  duplicate consumption, unsolicited callbacks, and canceled attempts.
- Uses browser process memory only — no localStorage, no React state carrying
  one-time codes, no log lines, no URL parameters, no outbound Meta calls.
- The existing review UI keeps its hardcoded `LIVE_SIGNUP_ACTIVATION_APPROVED=false`.
  If an authorized browser session were completed in an approved isolated preview,
  the bridge would discard the combined payload and show a read-only diagnostic.
- No real employee number is registered, no Graph token exchange or DB write occurs.

## What remains before a real Samer pilot

- A reviewed, authenticated server FINISH route accepting one-time code + session IDs
  with CSRF/state binding and an explicit allowed company phone number.
- A real Meta Graph v4 verifier (the existing adapter is test-only / not wired for
  live Staging). It must independently match exact portfolio/WABA/phone and
  Coexistence eligibility before persisting proof.
- A reviewed proof repository and migration; least-privilege data access, employee
  and customer notices, and rollback.
- A reviewed real-number webhook receiver with HMAC, number allowlist,
  opt-in consent, and retention/audit policies.
- Separate owner approval to enable any flow. Do not import previous chats by default.

Do not deploy this draft to production or initiate an employee signup based only on
the browser bridge or a successful TEST WABA connection.
