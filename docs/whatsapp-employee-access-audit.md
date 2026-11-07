# Employee WhatsApp archive access audit groundwork

This PR adds a bounded audit writer and a manual SQL artifact. It does not add
archive routes: the current production `main` has no employee archive feature,
and PR #10 is not merged. When an archive route is introduced, it must write an
`allowed` or `denied` event before returning any archive/search/export response;
audit write failure must fail the protected request closed.

The ledger captures actor and employee scope, action, decision reason, time, and
an optional coarse result-count bucket. It must never capture message contents,
search terms, request/response bodies, media URLs, phone numbers, or access
tokens. Read/search/export authorization remains backend-enforced; UI hiding is
not an access control.

The SQL is a manual migration artifact. A separate NOLOGIN schema owner and a
dedicated INSERT-only runtime writer must be provisioned by an operator. The
application must not run DDL or replace triggers at startup. A trigger alone is
not tamper-proof against a table owner or database superuser, so production
deployment also requires independent ownership, privilege verification,
restricted administrative access, and external backup/monitoring controls.

No retention or purge is introduced here. The owner selected open-ended
retention with nullable expiry; that choice does not remove periodic necessity
reviews, employee notice, lawful-basis review, or applicable data-subject
rights.
