# Employee WhatsApp archive: phase 3 backend

This draft provides backend-only number assignment, explicit employee consent and
revocation, second-admin activation, explicit supervisor grants, and scope-checked
conversation/message reads. The implementation is feature-flagged and restricted
to a dedicated loopback test database. It does not enable real WhatsApp traffic.

## Consent and authorization model

- An admin records a business-number authorization reference and assigns it to an
  active `sub_agent`; the number remains inactive.
- The WABA ID must be in the explicit `WHATSAPP_EMPLOYEE_APPROVED_WABA_IDS`
  allowlist; no account is approved by default. Do not add Meta Test WABA IDs there.
- The assigned employee must explicitly consent. Revoke is immediate, writes an
  audit event, and deactivates the number. Re-consent alone does not reactivate it.
- A different active admin must activate the number after consent. This is an
  attestation workflow, not independent proof of company ownership; evidence review
  remains an operational requirement before any real number is enabled.
- Employees can read only their own archive while current consent and active number
  registration exist. Other readers need a live, per-employee supervisor grant.
  Admin status alone grants no archive access.
- Conversation endpoints omit raw webhook payload and media URLs/IDs. Media is not
  downloaded or served; only allowlisted type, byte count, and digest metadata are
  represented in the proposed schema.

## Compatibility and isolation

The manual SQL schema retains PR #6 identifiers for number registration, consent,
conversations, event dedupe keys, and audit records, with actor/grant fields added.
It must be reconciled with PR #6 before the two drafts are ever combined. No startup
migration is registered. Both archive and webhook flags default off.

The archive reads only its dedicated employee tables. It has no routes or joins to
Meta Test WABA, WhatsApp AI, CRM, or the general WhatsApp API history tables.
Coexistence is false by default and this PR does not provide an enablement path;
eligibility must be reviewed separately before any echo is admitted.

## Retention

The schema proposes a 90-day `expires_at` value and an index for review. It does
not automatically delete or purge records. Legal/product owners must approve the
retention duration and deletion process before activation; no deletion job is
included in this draft.

## Not verified

No local PostgreSQL server was available during development. SQL concurrency,
foreign-key behavior, webhook/revocation races, and DB-level duplicate handling
therefore remain unverified. No Meta requests, real accounts, secrets, production
database, or personal conversations were used.
