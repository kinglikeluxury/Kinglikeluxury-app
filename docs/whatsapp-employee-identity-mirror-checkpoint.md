# Kinglike employee WhatsApp — minimal identity sync & immediate access revocation

Checkpoint: 10 November 2026, separate Kinglike-Web-Staging project.

## Implemented in source; not activated

- \`whatsappEmployeeIdentityMirror.ts\` validates the actual, recently verified
  Kinglike app account object and independently checks the dedicated **NOLOGIN**
  \`kinglike_wa_archive_identitysync\` PostgreSQL role before writing.
- An active \`sub_agent\` employee may be represented by **numeric ID + security
  flags + verification timestamp** only. A currently active admin may be
  represented by the same minimal fields.
- Ordinary app users/visitors and removed employees **are never inserted into
  the archive**. If an old mirror row exists, a separate UPDATE marks it
  inactive; no credentials, CRM records, names, phone numbers or email are
  copied. The immutable archive access log and historical message records
  are not deleted or altered by this process.
- \`whatsappEmployeeArchiveReadService.ts\` now requires a current-app
  \`verifyCurrentSubject\` authority for **every employee** listed or read.
  It checks the user's current role in the Kinglike app DB, not solely the
  previously mirrored user ID, consent flag or supervisor grant. An inactive
  or reassigned employee cannot be viewed even with stale archive grants.
  The check repeats immediately before returning message content, narrowing
  the time window for revocation races.
- \`server/index.ts\` binds this verification to the real \`storage.getUser\`
  source-of-truth with \`isActive=true\`, \`isAdmin=false\`,
  \`role="sub_agent"\`.
- Separate read-only reader and insert-only audit writer are still required.
  Audit failure is a **hard 503**; no fallback to the app DB or to a mock feed.

## Preconditions for actual use

1. Security/privacy owner approves the employee notice, customer disclosures
   and retention policy. Verify Meta Coexistence eligibility for an actual
   company-controlled employee number.
2. Provision distinct **non-owner** credentials for archive reader, audit
   writer and identity synchronizer using Railway secret management. Do not
   put credentials in chat, GitHub or a browser. The roles remain NOLOGIN
   until reviewed and approved; production, Neon and application DB are
   excluded by code.
3. Build a narrowly scoped, authenticated **internal** identity refresh worker
   to fetch only approved/current employee and admin IDs from the app. It
   must use the identitysync-only credential and never copy full accounts.
   No public self-enrollment endpoint or unbounded bulk synchronization.
4. Independently test role isolation, immediate deactivation, consent
   revocation, explicit supervisor grants and audit outage on disposable DB.
5. Only after the remaining history importer, private media capture, dead
   letter alerting and Meta signed webhook gates are complete, consider the
   explicit single-number Samer pilot.

**This PR does not provision role logins, write archive users or customer
messages, change Railway variables, enable webhook ingestion, merge into main
or deploy to real Kinglike production.** It is a pre-activation safety step.
