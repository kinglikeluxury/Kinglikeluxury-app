# WhatsApp Embedded Signup proof boundary

This is an inert server-side contract, not a production Embedded Signup
integration. No route, Graph client, token exchange, startup hook, or feature
flag is registered by this PR. The acceptance function requires an explicit
enabled value; callers must keep it false outside isolated tests.

The browser FINISH callback is untrusted. Server acceptance consumes a
single-use server-side flow bound to the authenticated actor, exact HTTPS
origin, and CSRF token, then passes only the short-lived code and asserted
identifiers to a future verifier adapter. That adapter must exchange the code
server-side, query Meta for the Business Portfolio, WABA, phone-number ID,
display number, granted permissions, ownership relationship, and per-number
Coexistence eligibility. It must return verified facts, never a credential.
The current repository contains no such live adapter, and tests use fixtures.

The database artifact stores verified identifiers, permission names, reviewer
actor, and revocation metadata only; it contains no auth-code or access-token
columns. Atomic one-time flow consumption and duplicate ownership enforcement
are repository obligations and must be implemented transactionally before a
route is connected. Revoke must immediately make the number ineligible for
future processing. Verification does not activate message ingestion: employee
notice/consent and a separate explicit activation gate remain required.

No real Meta request or number was used. Company ownership remains the owner's
administrative declaration; it is not substituted for the independent Meta
relationship/permission checks required by the verifier.
