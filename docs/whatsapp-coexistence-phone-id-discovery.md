# Meta WhatsApp Business App Coexistence: omitted phone number ID

**Status: Draft only. No real staff number activation, no production changes.**

### Issue

With the Meta Embedded Signup Business App Onboarding (Coexistence) flow,
`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` may provide a WABA ID and business ID
without `phone_number_id`. Treating that optional identifier as mandatory
rejects an otherwise legitimate completion even when the `FB.login` one-time
code arrives successfully.

### Safe implementation

- The browser completion bridge may pass verified-looking (but **untrusted**)
  WABA and business ID strings without a phone ID.
- The server requires the configured one-person allowlist phone number and
  approved business portfolio; user-supplied numbers cannot override it.
- After one-time OAuth-code exchange and token permission check, the server
  confirms the approved portfolio's WABA relationship and enumerates that
  WABA's phone IDs through Meta Graph.
- It requires exactly **one** phone matching the allowlisted number. If
  `phone_number_id` was provided by Meta's browser event, it must match as
  well. Duplicate, missing, inconsistent or malformed records are rejected.
- The server fetches the discovered phone's own Graph record and independently
  verifies `display_phone_number`, `is_on_biz_app=true` and
  `platform_type=CLOUD_API`.
- Only then can the existing one-time flow write
  `verified_pending_activation` to the isolated proof repository.

### Hard gates that remain OFF

Real Staging signup, external Meta Graph verification, owner approval and
employee monitoring remain default-denied. The browser Connect button remains
disabled. The test fixtures are fully synthetic; code changes do not connect
Samer, import prior chats, subscribe live WABAs or send any message.

### Limitations and next review

- A verified Meta App Review/Advanced Access and supported Coexistence
  configuration must be confirmed through Meta, not inferred from mock tests.
- Production/real-employee access requires documented staff and customer
  privacy notice, consent, retention/erasure and audit/revocation controls.
- Server must verify real Graph response shape and asset sharing relationships
  in an approved read-only pilot before enabling a number.
- WABA phone-number pagination and server-side phone discovery currently fail
  closed on no or multiple matches; do not bypass for a real account.
- Current Meta TEST WABA webhook confirms only signed test events, not a real
  staff chat stream. Real inbound and `smb_message_echoes` receipt still need
  separately approved integration tests.
