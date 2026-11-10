# WhatsApp employee archive — consent withdrawal and safe identity-sync runtime

Checkpoint: 10 November 2026. Applies ONLY to `Kinglike-Web-Staging`.
No employee/Meta numbers are connected, and the isolated archive login roles are still **NOLOGIN**.

## Corrected security behavior

When a real employee withdraws consent but remains an active `sub_agent` in the Kinglike app, the identity synchronization process must **mark the existing archive principal inactive**, with an immutable `deactivate` record in the same database transaction. Refusing the sync in this case would leave stale active identity rows and is prohibited.

- The app account itself is unchanged.
- A person not already mirrored (including ordinary customers) is never inserted or logged just to revoke access.
- If consent switches from true to false between the initial and pre-commit checks, the attempted activation is rolled back.
- A per-employee transaction-scoped PostgreSQL advisory lock prevents concurrent worker updates to the same identity from racing.
- An audit insert failure rolls back the identity update. Historical messages and immutable access audit entries remain untouched.

The archive read gateway separately continues to require current, verified employee consent and a current `sub_agent` app account before each response. Revocation is effective on the read path as soon as that authoritative consent status is updated in the dedicated archive registry.

## Scoped execution capability (deliberately NOT activated)

`server/whatsappEmployeeIdentitySyncRuntime.ts` now provides an **internal** lazy runner; it has no public route, no scheduler, no startup side effect and no API to link Meta. A runner can be created only after all these independent gates exist:

- Staging app database isolation has passed.
- `WHATSAPP_EMPLOYEE_IDENTITY_SYNC_ENABLED=true` approved by operator.
- Employee and customer notices, retention policy, and separate verified consent-source approvals.
- Exact private Railway archive host and database; dedicated `kinglike_wa_archive_identitysync` login credentials.
- Archive host and DB differ from Kinglike's Staging app DB, Neon, and Meta onboarding-proof DB.

The role remains `NOLOGIN` and none of these variables/credentials are configured on Staging. This PR does not connect to the archive, create users, or read or send employee messages. A future caller must supply independently verified current app administrator, current employee and employee-consent lookup functions.

## Quality gates

Run synthetic unit tests for consent withdrawal, mid-flight revocation and wrong database identities; run disposable PostgreSQL role/ledger tests; compile the existing Kinglike app. Do not enable live jobs or Meta until employee notices and specific consent evidence have been reviewed.

**No production, main branch, Neon database or actual employee data changes in this step.**
