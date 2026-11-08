# WhatsApp employee monitoring: governance and technical readiness review

**Review date:** 7 November 2026
**Scope:** Draft PR #8 (`e04f8020`), whose combined code is based on production main
`8dcea013`. This is a readiness review, not a legal opinion or an approval to process
employee/customer data. PR #5, #6, #7 and #8 remain unchanged.

## Executive decision

**Not ready to merge or enable for real traffic.** Test-only gates and synthetic
PostgreSQL/HTTP tests are useful safeguards, but do not establish company ownership,
Meta Coexistence eligibility, a lawful processing basis, transparent notice, a
retention/deletion schedule, cross-border safeguards, or tamper-resistant audit.

## Ownership and Meta onboarding

### What the drafts do

The owner has explicitly declared that every WhatsApp number he chooses to link is
owned by Kinglike Luxury and under the company's responsibility. Record this
owner-level declaration in the operating policy; do not require a separate
document upload for every number in the application. This management declaration
does not establish Meta eligibility, successful onboarding, webhook delivery, or
legal approval to monitor each employee/customer conversation.

PR #7 also records an administrator-supplied authorization reference, a configured
employee-WABA allowlist, employee consent, and second-admin activation. Those
fields are operational records, not Meta proof. A free-text reference can be
fabricated or changed unless its audit path is protected.

### Required before any number can be activated

1. Use the owner's portfolio-wide declaration instead of per-number file uploads.
   Do not enroll a staff member's personal WhatsApp number.
2. Still require per-number technical matching: an authorized company portfolio
   administrator completes current Meta Embedded Signup (Meta docs describe v4),
   and the returned business portfolio, WABA, and phone-number IDs match the
   approved employee-business allowlist. Preserve the session-log
   event and returned business/WABA/phone-number IDs, then independently confirm
   their relationship to the approved company portfolio. Never store verification
   codes or Meta tokens in this evidence record.
3. Store evidence as a controlled record: evidence type/reference, reviewer,
   review time, source asset IDs, decision, expiry/recheck date, and immutable
   audit evidence. Keep initial state inactive and the employee WABA allowlist
   empty until the human review is signed off.
4. Treat Coexistence as a separate, per-number eligibility outcome. A Boolean
   registration flag or a WABA allowlist is not Meta proof. Do not enable
   `smb_message_echoes` until the business completes Meta's supported onboarding
   and the expected account/number state is verified through the documented flow.

Meta's current Coexistence documentation lists prerequisites including WhatsApp
Business app version 2.24.17+, Solution Partner/Tech Provider status, Cloud API
webhook readiness, and Embedded Signup session logging. The business owner must
complete phone/account verification and explicitly choose whether to share chat
history. Meta documents sync of recent 1:1 chat history (up to six months) when
permitted by the business; groups are not synchronized, and some app features
(including disappearing/view-once/live-location messages) change or are not
supported. Therefore Coexistence does not mean “work-only history.” Use a
company-controlled number dedicated to work, and do not import existing history
until the business owner and privacy review explicitly approve scope.

### Draft #8 implementation gap found

Meta's `smb_message_echoes` payload uses `value.message_echoes[]`; each echo's
`from` is the business display number and its `to`/`to_user_id` identifies the
customer. PR #8's parser mismatch is corrected in this branch. Synthetic tests
cover text/image/document echoes, `from` matching both the payload and registered
company display numbers, `to` and
BSUID matching, and duplicate identity rejection. Documented `edit` and `revoke`
events are retained as separate event rows linked by `original_message_id`; they
do not overwrite or delete the archived original. Such events are accepted only
when the referenced outbound message exists in the same employee/phone/customer
conversation. Unknown shapes and unresolved references are rejected fail-closed.
This does not establish global WhatsApp edit/delete semantics or Meta eligibility.

The Coexistence gate now requires a company registration plus a verification
timestamp/reference, exact registered WABA/phone IDs, and current employee
consent. The application still does not obtain or cryptographically validate
those evidence fields from Embedded Signup/Meta; they are not proof by themselves.
Keep real traffic disabled until a trusted onboarding verification path exists.

## Employee/customer privacy and lawful basis

The current consolidated Georgian Law on Personal Data Protection (Matsne,
publication 9, consolidated 10 June 2026) permits multiple lawful bases under
Article 5; consent is not the only basis. The controller must justify the basis.
Article 32 requires assessing voluntariness when consent is tied to a contract or
service, including whether the service is available without consent. Employment
power imbalance makes legal review of consent as the basis especially important.
No basis is selected or declared lawful by this review.

Before processing, the controller should document a purpose-limited policy and
give clear notices to employees and affected customers, including the controller,
purposes/basis, data categories, recipients/processors, storage period/criteria,
rights, and any cross-border transfers. Keep the scope to company work
communications; do not use the archive as employee performance scoring or
disciplinary surveillance without a separate necessity/proportionality and legal
review. Messages can contain special-category data; counsel must assess Article 6
and safeguards for those cases.

If consent is chosen, Articles 20 and 32 address withdrawal: withdrawal is free,
simple, accessible, can be made in the same form, and the controller bears the
burden of proving consent. Processing must stop and data be erased/destroyed on
withdrawal except where the law's stated exception/another lawful ground applies;
Article 20 also sets a 10-working-day outer period for a requested termination/
erasure where no other ground exists. The current technical behavior is more
conservative for access/ingestion (revoked numbers are deactivated), but it does
not implement data-subject erase requests or legal exceptions.

## Retention, rights, holds, and transfers

- Georgian Law Article 4 requires purpose limitation, minimization, security, and
  storage only as long as needed; after purpose completion data should be erased,
  destroyed, or depersonalised unless a lawful, necessary and proportionate
  exception applies. Article 28 requires recording storage periods or their
  criteria. The owner rejects a fixed 90-day expiry and requests open-ended
  retention by default. In this separate review branch, `expires_at` is nullable,
  has no 90-day default, and no purge job is added. **Open-ended retention is not
  an exemption from data-protection law:** the controller still needs documented
  periodic necessity reviews, rights handling, a lawful basis, and access/audit
  controls. Do not add purge or deletion without a newly approved policy.
- Once an approved deletion schedule exists, it should separately cover message
  text, status events, media metadata, audit evidence, legal holds, and backups.
  Restore procedures must reapply approved deletion/hold decisions.
- Articles 13–17 provide information, access/copy, rectification, erasure, and
  blocking rights, with exceptions/claims handling. Legal hold should be
  case-specific, authorized, reasoned, time-limited, access-restricted and reviewed;
  Article 17 describes blocking while the reason exists, including evidence needs.
- Article 27(4) requires registration of electronic operations including access,
  disclosure/transfer and deletion. This branch adds database triggers rejecting
  UPDATE/DELETE on event and audit rows, but a database owner can alter or disable
  those triggers. Production still needs a non-owner runtime role and independently
  controlled audit storage. Archive reads/exports are not logged yet; add actor,
  scope, time, purpose, outcome and correlation ID without message content or
  customer identifiers.
- Article 31 calls for a prior impact assessment in specified high-risk cases and
  for the stated mandatory categories. The controller/DPO/legal advisor should
  determine applicability before launch; assess employee monitoring, volume,
  special-category content, access, and risks.
- Article 36 requires a written controller-processor arrangement; Article 37
  governs international transfers and safeguards. Hosting region, support access,
  processors/subprocessors, backups, and transfer mechanism are not established
  by this code review. Obtain a location/processor inventory and counsel review
  before storing data in any region.

## Logging and audit integrity

The current `server/index.ts` request logger serializes JSON API responses before
truncating the log line. A message preview can therefore enter logs even when the
line is truncated. This review branch adds a narrow response-body logging
suppression policy for employee WhatsApp routes and synthetic tests for it; it
does not change PR #8. Before merging that guard with PR #8, verify the combined
routes and make sure reverse proxies, error handlers, analytics, traces, and
exports do not capture request/response bodies or signed media URLs.

Consent rows are mutable (re-consent overwrites row fields), and a database owner
can alter or disable append-only triggers. A production design needs a separately
controlled append-only audit writer, restricted runtime grants, and periodic
integrity verification; the current audit table should not be called tamper-proof.

## Go/no-go checklist

Do not move PR #6/#7/#8 from Draft until all items have named human owners and
evidence:

1. Owner/legal approves a work-only-use policy, notices, lawful basis, customer
   notice, employee opt-in/revocation handling, and rights-request workflow.
2. Company proves portfolio/WABA/number control; authorized owner completes
   Embedded Signup v4 session and the asset IDs are independently verified.
3. Coexistence eligibility is verified per number through a trusted onboarding
   record; synthetic echo fixtures including `message_echoes`, edit, and revoke
   pass tests; no personal number/history is imported.
4. Retention, backup deletion, rights requests, legal holds, cross-border processor
   safeguards, audit access logging, and append-only privileges are approved and
   tested in isolated staging.
5. Feature flags remain off until the above gates are recorded and a separate
   deployment review is approved.

## Sources

- [Matsne: Law of Georgia on Personal Data Protection, publication 9](https://matsne.gov.ge/en/document/view/5827307?publication=9)
- [Meta: Onboard WhatsApp Business app users / Coexistence](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [Meta: Embedded Signup v4 default flow](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/default-flow)
- [Meta: `smb_message_echoes` webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes.md)
