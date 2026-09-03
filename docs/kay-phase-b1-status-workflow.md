# Kay Phase B.1 CRM status workflow audit

This is a read-only audit of the current application. Kay remains Shadow-only:
it does not update CRM leads, ownership, tasks, or customer communications.

## Status transition findings

The Admin CRM status selector and generic lead PATCH path can manually produce
status changes. There is no enforced automatic `no_answer_1 → no_answer_2 →
no_answer_4` pipeline in the current production code.

`no_answer_2` PATCH has a real WhatsApp follow-up side-effect in the existing
CRM workflow. `no_answer_3` is retained for legacy UI/import/manual PATCH
compatibility and invokes the stored recovery-draft hook only; it sends no
customer message and is absent from the current production status model.
`no_answer_4` is a later manual/import attempt stage with no dedicated
transition or Kay threshold. `after_3_no_answer_whatsapp_contacted`,
`new_fresh_after_3_no_answer`, and `no_answer_converted` are likewise
manual/import values; no automatic transitions to them were found.

Consequently the requested arrows (`no_answer_1 → no_answer_2`,
`no_answer_2 → no_answer_4`, `no_answer_4 →
after_3_no_answer_whatsapp_contacted`, and
`after_3_no_answer_whatsapp_contacted → new_fresh_after_3_no_answer`) are
possible manual status transitions and are captured by the additive
database-local status-entry trigger, but are not enforced workflows.

## Kay interpretation

Only `no_answer_1` and `no_answer_2` are Rescue-evaluated. `no_answer_3` and
unknown statuses are `UNKNOWN_REVIEW` and cannot be rescued or orphaned.
`no_answer_4` is intentionally not Rescue-evaluated. `no_answer_converted` is
terminal loss for the current-owner rescue workflow, not a sale-success or
employee-performance conclusion. `not_interested_maybe_later` remains a
nonterminal follow-up state because it is not in the application's actual
closed/lost stop sets.