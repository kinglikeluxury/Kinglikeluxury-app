# Kinglike WhatsApp: signed one-number cutover checklist — 10 November 2026

This branch implements a **strict signed Meta HTTP callback adapter**, but deliberately does not mount it into the live app or connect a real number. No webhook data is being archived.

## Current completed checks
- The separate Staging archive PostgreSQL is Online; existing schema 00–06, history intake and immutable event/message importer have passed synthetic CI.
- Meta **test** WABA callback is a distinct diagnostic receiver that currently discards content; it does not prove employee chat archival.
- The pilot callback adapter validates Meta HMAC against the exact raw bytes, one allowlisted company employee/phone/WABA, and rejects unexpected/mixed history, live, or contact fields. The response is 200 **only after the relevant durable queue has committed**. If the database/consent/worker is unavailable, it returns 503 to request retry.
- GET verification uses a constant-time token comparison. No secret is returned by an admin endpoint, embedded in client code, or written to the app log.

## Still missing before authorizing real Meta cutover
1. Meta Business Manager permissions and validated Coexistence Embedded Signup **for the actual authorized company-managed employee number**. Must capture WABA ID, phone-number ID, account/Coexistence eligibility, verification and field subscriptions for `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`. Never paste a system-user token or Meta App Secret into chat or GitHub; configure directly in Railway secrets.
2. Create separate database LOGIN roles/secrets for restricted archive worker, reader, access audit writer, identity sync, and history importer. Existing roles are NOLOGIN on purpose. No one should use the database owner or the app/Neon connection URL.
3. Wire private durable inbox and history importer with queue retries/dead-letter monitoring and verified per-number consent/customer disclosure; configure the private Railway media bucket with encrypted media fetch and contacts import. The signed adapter refuses unknown/mixed events until their handler is ready.
4. Test one **real** Meta delivery: first signed message -> committed private inbox -> immutable message -> admin-only audit -> UI; then a Meta-reported revoke retains the original and shows a deletion marker. Verify photos, voice messages and videos with an actually retrievable Meta media ID.
5. Only then opt into the one-time history request, as the Coexistence history request may be time-limited after onboarding. This adapter does not call Meta or initiate history sync.

## Caution
Employees' consent has been affirmed by the owner; this is not a substitute for verifying company-number ownership or for customer disclosures. Meta may not report handset-only deletion events, so those cannot be guaranteed as a UI marker.

**No automatic production, Neon, main-branch or active WhatsApp change.**
