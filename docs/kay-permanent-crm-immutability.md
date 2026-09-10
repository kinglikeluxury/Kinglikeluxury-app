# Kay permanent CRM immutability

Business-owner directive adopted 2026-09-10.

## Final verification of this change
- Focused offline backend suite: 70 passed, 0 failed.
- Frontend recommendation-only static suite: 4 passed, 0 failed.
- Production bundle build: PASS; git diff --check: PASS.
- Final targeted architecture review: PASS, no remaining P0/P1.
- Workspace application restarted successfully and served port 5000.
- Screenshot reached the application loading screen, not an authenticated Kay
  dashboard; no claim of full authenticated UI verification.
- No new live database permission or mutation test was performed. Previous
  permission-test results remain historical evidence only.
- Known legacy inventory: 9 guarded paths, 3 CRM SQL sites behind guards,
  0 known unguarded paths. Static inventory is not a whole-program proof.
- Missing dedicated credentials and frozen/unmigrated read routes remain
  availability limitations. Blocked-write audit is best effort; synchronous
  mutation denial does not depend on successful audit persistence.

## Supersedes previous rescue execution plans
Kay may read, analyze, prioritize, explain, warn, and recommend. It may never
mutate CRM business data, directly or indirectly. This includes INSERT, UPDATE,
DELETE, TRUNCATE, ALTER, ownership, tasks, all existing fields, and future fields.
Unknown fields are protected by default, not an exception to a field blocklist.

This is a permanent architectural boundary, independent of runtime settings,
admin approval, mode, kill switch, canary, permissions, scheduler, or endpoint.
Changing a setting cannot reactivate legacy reassignment code.

## Human workflow
Assisted rescue means assisted recommendation. Automatic rescue means detection
and recommendation, not transfer. A human must open the normal CRM and perform
any permitted action under their existing permissions. Kay must not call a CRM
mutation endpoint on the human's behalf. Normal human CRM capabilities remain
unchanged. Preserve execution history and evidence; do not relabel historical
executions as newly performed recommendations.

## Internal data and freeze
Kay-owned missions, decisions, commitments, promises, briefings, recommendations,
and audit may be written only where separately permitted, without CRM triggers,
cascades, or indirect mutations. Permission in this architecture is not runtime
activation. Current internal writers and schedulers remain frozen.
Automatic customer WhatsApp, SMS, email, calls, and communication-state updates
are not authorized.

## Connections and defense in depth
CRM reads use only KAY_ANALYSIS_DATABASE_URL and a SELECT-only role.
No DATABASE_URL or NEON_DATABASE_URL fallback is permitted.
Audit uses a separate INSERT-only writer and independently owned append-only
ledger. Missing credentials or invalid privileges must fail closed.
Tests capable of mutations require the explicitly isolated test database;
never test denied mutations with an owner connection against production.

## Operational baseline
Mode SHADOW; kill switch ON; Auto Rescue OFF; Canary OFF; allowlist empty;
E.2.4 FROZEN_NO_EXECUTION. The real automatic reassignment Canary is cancelled.
Do not delete the incident decisions or notifications.

External roles and the isolated Neon test project were previously provisioned
and permission-tested. The three dedicated Kay connection secrets were not
installed at that verification, and the two production role passwords were
revoked afterward. That historical evidence is not proof of current application
connectivity; offline code verification must not be reported as a live DB test.

## Offline static audit

`scripts/kay-crm-static-audit.ts` is the repeatable source-only audit. It makes
no database calls, migrations, secret reads, scheduler calls, or production
data changes.

- Known legacy mutation paths without a source-text gateway guard: **0**
- Known legacy paths with a source-text gateway guard: **9**
- Legacy CRM mutation SQL sites: **3**, all unreachable behind the permanent
  synchronous gateway: `executeRescueTransaction`,
  `undoAssistedRescue`, and assignment-history observation. The latter is
  retained for historical compatibility.
- Generic write-pool fallbacks in the analysis connection: **0**

The nine legacy paths are retained for history/compatibility and permanently
guarded: rescue transfer, rescue undo, assignment observation, automatic
rescue worker, mission generation, Phase-D evaluation, legacy baseline
initialization, operational-scope setting, and E.2.4 canary activation.

This static inventory is deliberately honest about its boundary: it is a
source-text inventory, not an AST/control-flow dominance proof. The nine
legacy entries are an explicit finite inventory and newly added exports must
be added to it; SQL token counts include unreachable/frozen code and do not
establish runtime reachability. The report is therefore evidence for the
named paths, not a claim that every future Kay module is automatically covered.
The module inventory currently reports generic-pool imports in
`kayAuth.ts`, `kayAutoRescueService.ts`, `kayLeadScopeService.ts`,
`kayLegacyBaselineService.ts`, `kayMissionService.ts`, `kayPhaseDService.ts`,
`kayPhaseE24Service.ts`, `kayRescueService.ts`, and `kayService.ts`.
Those imports are retained for human authentication, Kay-owned settings, or
frozen write-capable legacy code; CRM recommendation/preview/history reads
covered by this change use the dedicated analysis wrapper. E.2.2
readiness/owner/capacity/status diagnostics and the E.2.3 capacity snapshot
also have no caller-supplied executor and use that wrapper. This is an
explicit review boundary, not a claim that a generic import alone is safe.

Live role SELECT/INSERT/UPDATE/DELETE checks are **unavailable**: the three
dedicated Kay secrets are absent and the previously provisioned passwords were
revoked. Offline test results must not be presented as live checks.

CRM mutation attempts use the safe audit vocabulary
`action=CRM_MUTATION_BLOCKED` and
`reason=KAY_CRM_READ_ONLY_POLICY`; every blocked gateway guard is persisted
with bounded server-owned action/target/field values. Audit snapshots contain
no secrets or unnecessary customer PII. Human CRM routes remain outside the
Kay namespace and retain their existing authorization behavior.