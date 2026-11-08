# WhatsApp Embedded Signup proof boundary

This adds an HTTP start/finish route and an injectable Graph verifier, but
neither is active in the app. The only executable route mode requires
`NODE_ENV=test`, `APP_DEPLOYMENT_MODE=test`, an explicit opt-in, an isolated
loopback test database, and an injected verifier. The app's normal registration
supplies no verifier/repository and only uses its real Express-session-backed
admin lookup; requests remain unavailable. Staging stays closed until a
separate review approves its deployment mode and safe database.

Meta's current docs say Embedded Signup v2/v3 deprecation took effect on
October 15, 2026. The reviewed path is v4 with a newly created Facebook Login
for Business configuration. This change does not enable the existing SDK
configuration, guess a configuration/App ID, or launch a Meta popup.

The browser FINISH callback is untrusted. It uses the opaque ID created by
Express Session, never a client-supplied session ID; actor/admin status is
looked up against the app's user storage. The test route binds flows to the
server session hash and exact request origin, then atomically consumes hashed
state and CSRF values with expiry checks. The SQL update permits one winner
under concurrent consume attempts, and session rotation invalidates an open
flow.

The injectable Graph adapter follows the current Embedded Signup v4 docs:
server-side GET `/oauth/access_token` exchange, `/debug_token` scope/app check,
the Business Portfolio `client_whatsapp_business_accounts` edge, WABA
`phone_numbers`, and phone fields `is_on_biz_app` + `platform_type`. It requires
an explicit Graph API version and has no default; Meta's implementation guide
listed v27.0 as latest on Oct 27, 2026. Coexistence is accepted only when
`is_on_biz_app=true` and `platform_type=CLOUD_API` for the exact phone ID.
Unproven fields or API errors fail closed. The adapter is tested only against
mock Graph responses; no Meta request was made.

The database artifact stores verified identifiers, permission names, reviewer
actor, revocation metadata, and only hashes of flow/session/CSRF values. It has
no auth-code or access-token columns. Duplicate phone ownership is constrained
by a unique phone-number ID. Revoke must immediately make the number ineligible
for future processing. Verification does not activate message ingestion:
employee notice/consent and a separate explicit activation gate remain required.

No real Meta request or number was used. Company ownership remains the owner's
administrative declaration; it is not substituted for the independent Meta
relationship/permission checks required by the verifier.

Official sources reviewed (2026-11-07):
- [Embedded Signup v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4)
- [Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Onboard WhatsApp Business app users / Coexistence](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [Meta Embedded Signup Postman collection](https://www.postman.com/meta/whatsapp-business-platform/collection/du6gzjv/embedded-signup)
