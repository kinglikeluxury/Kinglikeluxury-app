# WhatsApp Embedded Signup proof boundary

This adds an HTTP start/finish route and a PostgreSQL one-time flow repository
for isolated tests, not a production Embedded Signup integration. The route
requires an explicit flag and injected verifier and refuses to run unless
`NODE_ENV=test`; the app's normal registration supplies no verifier, so it stays
unavailable. There is no Graph client or real code/token exchange.

The browser FINISH callback is untrusted. The route checks the authenticated
actor against the test database's admin role, binds the flow to the server
session hash and exact request origin, and atomically consumes hashed state and
CSRF values with expiry checks before invoking the injected fixture verifier.
The SQL update permits one winner under concurrent consume attempts. The
future production verifier must exchange the code server-side and independently
confirm Business Portfolio, WABA, phone-number ID, display number, permissions,
ownership, and per-number Coexistence eligibility. It must return verified
facts, never a credential.

The database artifact stores verified identifiers, permission names, reviewer
actor, revocation metadata, and only hashes of flow/session/CSRF values. It has
no auth-code or access-token columns. Duplicate phone ownership is constrained
by a unique phone-number ID. Revoke must immediately make the number ineligible
for future processing. Verification does not activate message ingestion:
employee notice/consent and a separate explicit activation gate remain required.

No real Meta request or number was used. Company ownership remains the owner's
administrative declaration; it is not substituted for the independent Meta
relationship/permission checks required by the verifier.
