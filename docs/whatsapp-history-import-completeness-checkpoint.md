# WhatsApp Coexistence history: completeness, duplicate integrity and crashed-leases

Checkpoint: 10 November 2026. Scope: Kinglike-Web-Staging only.

## What changed

The private history importer now verifies each history chunk's immutable phase, order, progress, thread count and message count *against the complete decoded encrypted payload*. If a chunk is truncated, missing messages or has inconsistent metadata, it is NOT marked imported. A sharing-declined notice can never carry hidden message threads. History ciphertext larger than the approved intake bound is refused.

When live/previous archive already contains a message with the same Meta ID, historical replay is idempotent **only if employee, registered work number, customer, direction, event kind and the present content/type/media metadata agree**. Conflicts are retained for retry/manual review; original immutable content is never overwritten.

The leasing worker now moves abandoned expired leases with exhausted attempts to `dead_letter`, while safely reclaiming interrupted jobs within the attempt limit. Encrypted source history is retained throughout; there is no automatic deletion or silent message skipping.

## Completeness is not proven by one progress flag

A Meta history webhook reporting `progress=100` for one chunk does **not** prove every preceding chunk and phase arrived. The Staging admin status explicitly reports `historyCompleteness: not_verified`. Historical import may only be declared complete after a separately reviewed reconciliation of expected phases/orders, import statuses, dead-letter/blocked rows, and Meta's actual one-time sync status.

## Boundaries

These changes do not start a worker, grant LOGIN, open a Meta webhook, enroll Samer's number, expose messages in the CRM, create a new CRM, download private media or alter the main/production Neon database. Per-person consent and customer notices must be grounded in operational evidence; the owner's employee-consent attestation is respected without fabricating Meta approval.

## Tests

Synthetic unit tests cover incomplete counts, wrong phase/order/progress, forged declined notices, oversize ciphertext, conflicting Meta message content, abandoned lease dead-lettering and safe lease recovery. CI must also pass the existing disposable PostgreSQL grant/migration tests and build.
