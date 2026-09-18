# Kay mission scope remediation

## Current production evidence

The read-only audit found three active historical rows that the fixed operational
scope now excludes:

- Missions `109` and `225`: uncertain imported business-date provenance.
- Mission `4911`: employee assignment mismatch.

Mission `4911` is a Kay-generated `FINAL_RESCUE_WARNING` with idempotency key
`e2:warning:2039`. It references queue row `2039`. The queue expected employee
`24`, while the lead is currently assigned to employee `31`. The mission and
queue timestamps are contiguous, and no nearby Rescue execution exists, which
proves the warning-artifact creation path without exposing customer data.

No production row was changed during diagnosis or validation.

## Safe post-Apply remediation design

Cleanup must be a separate, explicitly approved operation after this code is
applied. It must:

1. Use `KAY_INTERNAL_DATABASE_URL` through the verified internal writer.
2. Recompute scope through the shared read-only scope service immediately before
   mutation.
3. Lock only the identified active `kay_missions` rows.
4. Change an invalid active row to `STALE`; never delete it.
5. Append a `kay_events` record with reason `scope_remediation`, the mission ID,
   and the non-PII scope outcome.
6. Use one transaction and roll back unless the locked row still matches the
   audited mission ID, employee ID, status, and idempotency key.
7. Print aggregate counts and non-PII IDs only.

Until that separate operation is approved and run, the records remain unchanged.
The application-level filter prevents them from being exposed, acted upon, or
notified as current operational work.