# Kay Phase C priority formula

Kay Phase C is an internal, **shadow-mode** employee workflow layer. Missions
do not update CRM leads, assignments, statuses, tasks, notes, or customer
communications.

Formula version: `phase_c_v1`. Scores are deterministic and capped at 100.

| Observed factor | Points |
| --- | ---: |
| Protected lead | 25 |
| Closing-stage lead | 25 |
| Hot or interested CRM status | 20 |
| Incomplete CRM task past its due time | 25 |
| Current active Rescue-eligible decision | 30 |
| Current no-answer Rescue warning window | 20 |
| Current active unprotected-opportunity decision | 15 |
| Due within 60 minutes | 15 |

Priority bands are CRITICAL (70+), HIGH (45–69), NORMAL (20–44), and LOW
(below 20). Each mission stores the formula version, numeric score, and
factor breakdown so the employee can see “Why this is priority.”

Because CRM task records have no dependable task-type field, an overdue
incomplete task creates `FOLLOW_UP_DUE` only with `NEEDS_REVIEW` detail; Kay
does not claim it proves customer handling. Rescue-risk timing uses the
persisted B.1 status-entry instant and existing rescue warning data.

The next-60-minutes list is ordered by persisted priority and bounded by the
admin-only `max_next_60_minutes_items` setting (1–8; default 6). The
`phase_c_workflow` setting also fixes the formula literal to `phase_c_v1` and
has a boolean `mission_notifications_enabled` flag. In-app mission counts are
the Phase C notification mechanism; no external provider is introduced.