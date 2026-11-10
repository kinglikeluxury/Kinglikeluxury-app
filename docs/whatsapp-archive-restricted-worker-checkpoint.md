# Employee WhatsApp archive — restricted worker + Staging rollback proof
Date: **10 November 2026**. Project: **Kinglike-Web-Staging** only.

## Owner attestation and scope

The owner has affirmed that employees have consented to company WhatsApp monitoring. This is treated as a **management attestation**, not a fabricated per-person consent record or a verified Meta Coexistence activation. The archive remains restricted to approved **company-managed work numbers**. No employee's personal WhatsApp number, messages or customers have been added. Customer notice/legal-basis review and actual Meta eligibility remain separate checks.

## Real isolated PostgreSQL operational proof

A one-time private Railway Function `wa-archive-rollback-e2e-once` ran against the standalone **Postgres-92tK / kinglike_whatsapp_archive** instance. Railway deployment `605d0c89-7fb6-4f90-ad39-13c3ac45e227` returned `SUCCESS` with the marker:

`WA_ARCHIVE_ROLLBACK_E2E_SUCCESS`

The deliberately **synthetic** PostgreSQL transaction:

1. Verified project/environment/internal host and that all archive, queue and identity tables were empty.
2. Added temporary fake actor/employee, fake company number, consent and explicit grant.
3. Switched to the **NOLOGIN least-privilege archive worker**, inserted an immutable original message and a linked signed-style revoke event.
4. Switched to the **read-only** archive role and verified the original text was still present while deletion status was derived from the linked revoke event.
5. Switched to the **INSERT-only** access audit writer and appended a synthetic read record.
6. Executed **ROLLBACK**, then rechecked every relevant table had **zero records**.

The single-use Railway Function was deleted afterward. **This proves database roles and SQL persistence, not real Meta webhook delivery, per-message synchrony, or a real signed event**.

## Code changes in this PR

- Extract the existing signed-queue event parser/persister into a dependency-injected core behind the existing local CI-only entry point.
- Add a **disabled-by-default Staging worker factory**. Its caller must use the independent archive worker role; it rechecks actual database identity and rejects superuser/owner privilege and UPDATE/DELETE on immutable events.
- Remove PostgreSQL `FOR UPDATE`/`FOR SHARE` SELECT locks from immutable-event read checks that would require broader UPDATE grants than allowed. Use idempotent unique Meta event keys and `ON CONFLICT` reconciliation instead. A future live consent-revocation writer must coordinate per-phone locks/leases and verify status prior to commit.
- Verify the signed inbox `employeeId` matches the current number registration, not only WABA and phone IDs.
- Reject `history`, `smb_app_state_sync`, unknown and mixed webhook fields from the **ordinary message queue**. Never respond successful ACK before the dedicated, one-time history importer is ready; Meta Coexistence history sync availability is time-limited.

## Still not activated

- All four archive PostgreSQL roles remain **NOLOGIN**. No runtime DB passwords or new feature flags were configured on Staging or in source.
- Worker factory is **not connected to an HTTP Meta webhook, scheduler or real archive database pool**.
- External Staging integration block remains intact. No employee numbers were linked, no messages/attachments imported, and no production or Neon changes occurred.
- A real pilot still requires individually traceable work-number consent, customer notice/legal basis, Meta Coexistence and history-sync eligibility, independent scoped role credentials, audited private media storage, and operational monitoring of queue retry/dead letters.

Do not interpret `SUCCESS` above as proof of real WhatsApp mirroring. A company employee's local handset-only deletion may never generate a Meta event.
