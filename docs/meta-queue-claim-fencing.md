# Meta queue claim fencing

The Meta lead queue uses a short PostgreSQL transaction to claim work with
`FOR UPDATE SKIP LOCKED`.  A claim changes the row to `processing` and assigns
`updated_at` with a database-generated millisecond timestamp:

`GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond')`

The exact returned value is exposed as canonical text
(`YYYY-MM-DDTHH24:MI:SS.MS`) and retained by the worker as string
`claimUpdatedAt`; it is never round-tripped through a JavaScript `Date`.
Every post-network terminal transition (completed, retry, and needs_review)
requires both `status = 'processing'` and the matching `updated_at` token.
An update affecting zero rows means the worker lost its claim and must not
overwrite the newer worker.

Pending rows and due retry rows are the only ordinary claim candidates.
Processing rows older than 15 minutes are recovered with row locking and
consume exactly one existing retry attempt.  Exhausted rows become
`needs_review`; healthy processing rows, completed rows, and future retries are
not reclaimed.  Pull-sync rows acquire the same fenced claim before their
terminal update.

The Meta processor has one startup gate:
`ENABLE_META_LEADS_PROCESSOR === "true"`.  It does not depend on
`ENABLE_BACKGROUND_SCHEDULERS`, and its startup function is idempotent.

This provides at-least-once processing, not exactly-once external delivery. If
a worker performs an email/WhatsApp or other external side effect and crashes
before recording completion, stale recovery can retry the row. Existing
Task 30 duplicate, canonical-lead, notification-claim, and round-robin
protections remain in place; services without an idempotency guarantee retain
that limitation.