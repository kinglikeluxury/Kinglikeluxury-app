# Employee WhatsApp archive access audit groundwork

The combined review candidate adds a bounded audit writer and connects it to
both existing employee-archive GET routes. Each authenticated allowed or
scope-denied read is written before a response; read transactions roll back
before denied events are written. Audit failure returns a generic 503 without
returning archive content. There are no search/export routes yet; any future
route must record those actions before returning a response.

The ledger captures actor and employee scope, action, decision reason, time, and
an optional coarse result-count bucket. It must never capture message contents,
search terms, request/response bodies, media URLs, phone numbers, or access
tokens. Read/search/export authorization remains backend-enforced; UI hiding is
not an access control.

The canonical table DDL is in the unified manual schema artifact. A separate NOLOGIN schema owner and a
dedicated INSERT-only runtime writer must be provisioned by an operator. The
application must not run DDL or replace triggers at startup. A trigger alone is
not tamper-proof against a table owner or database superuser, so production
deployment also requires independent ownership, privilege verification,
restricted administrative access, and external backup/monitoring controls.

No retention or purge is introduced here. The owner selected open-ended
retention with nullable expiry; that choice does not remove periodic necessity
reviews, employee notice, lawful-basis review, or applicable data-subject
rights.
