# KINGLIKE VIP — isolated implementation branch

This is the first **code-backed foundation** for VIP, not a production-ready portal.

## Isolation invariants
- Production **main**, WhatsApp staging branch, Railway deployments, Neon production, and credentials remain unchanged.
- `KINGLIKE_VIP_ENABLED` defaults OFF; `VITE_KINGLIKE_VIP_ENABLED` defaults OFF. Both must be explicitly enabled in a **dedicated isolated test environment** only after reviewing its database.
- No automatic migration, startup schema creation, outbound email, private file upload, or external WhatsApp call is included in this first slice.
- The UI never assumes mock ownership data. The API only returns units after verifying the authenticated user ID and matching active owner-unit assignments.
- Admin overview requires BOTH a valid active user session and a fresh database check that the user is an admin.
- Never use the public image upload endpoint for receipts, contracts, or statements.

## Included
- New client route `/vip` and admin route `/admin/vip`, hidden unless Vite flag is enabled.
- New server routes `/api/vip/me` and `/api/admin/vip/overview`, disabled unless server flag is enabled.
- Postgres foundation migration in `server/vip/migrations/001_vip_foundation.sql`. Not executed.
- Responsive React/Tailwind entry screens, five-language headings, real-session gating, no fake financial data.

## Second implementation slice (code added, not deployed)
- Client can request an official developer statement once per unit per month, subject to active owner-unit authorization.
- Duplicate requests are blocked by a database unique constraint.
- Admin queue lists requests; admin may mark a new request as 'following up with developer' without issuing an inaccurate statement or sending a message.
- POST/PATCH reject non-JSON and cross-origin requests. No developer outreach, file upload, or emails occur.
- These routes remain disabled until a separate staging environment, database migration and both feature flags are reviewed.

## Third implementation slice (code added, not deployed)
- The admin project control panel can create projects, units, assign units to existing verified active user accounts, and publish or draft construction progress updates.
- The API limits client progress history to projects where they own an actively assigned unit; drafts remain hidden.
- Mutations are transacted with audit records. Assignment is serialized and only one current owner is allowed per unit.
- No invitation emails or new user creation: the invite/activation service remains a separate future phase.
- No storage or media upload endpoints in this slice.
- This migration has NOT been applied in any database and the branch has NOT been deployed or built.

## Fourth implementation slice (code added, not deployed)
- Authorized administrators can create contractual installment schedules for each VIP unit, with an amount, currency, due date, and sequence number.
- Owners can view installment due dates prominently, with verified paid and outstanding balances backed by financial posting records.
- Existing public-site `payments` is NOT used as the property installment ledger.
- Creating an installment does not mark it paid; no receipt upload or approval bypass is available.
- All admin writes are validated and audited in the same DB transaction; no migration, storage writes, emails or deployment have run.

## Fifth implementation slice (code added; not deployed or integration-tested)
- Customers can upload PDF/JPEG/PNG transfer receipts against their own installments; admins can upload for clients and record the original source.
- Uploads are limited to 10 MB, checked by signature, and sent server-side to a dedicated **private GCS bucket** via the existing SDK. Access fails closed when a dedicated bucket or credentials are missing. Bucket settings must enforce uniform access and public access prevention.
- Private receipts are downloaded through a permission-checked endpoint, never public object URLs.
- Uploads remain pending and **never automatically mark installments paid**.
- Dedicated finance grants are separate from admin status, can be revoked by the administrator, and every grant/revocation is audited; reviewers cannot approve their own uploads. Amount verification and posting occur transactionally with a unique receipt constraint, locking and audit history.
- No migrations executed and no GCS credentials, deployments, or production variables changed.
- Production blockers: isolated staging tests; private storage IAM/CORS review, malware scanning, retention and backup, financial authority review, CSRF and session review, and safe integration with the active WhatsApp branch.

## Sixth implementation slice (code added, not deployed or tested)
- Admin may email a one-use 72-hour invitation for a specific unassigned unit. Invite token is stored as a SHA-256 digest only.
- Two independent email controls default OFF: `KINGLIKE_VIP_EMAIL_ENABLED` plus a recipient allowlist (`KINGLIKE_VIP_INVITE_ALLOWED_EMAILS`). General sending requires another explicit `KINGLIKE_VIP_EMAIL_LIVE_APPROVED` flag.
- `KINGLIKE_VIP_BASE_URL` must be an HTTPS URL to the isolated staging site while testing. Resend is used through the existing notification service. There is no email sending unless the flags are explicitly enabled.
- New buyers activate with a strong password. Existing accounts must sign in with the invited email first; invitation tokens never reset passwords. Activation creates the owner entitlement atomically and consumes the token.
- Owner assignment by email alone has been removed: `is_verified` can be set by phone verification and does not guarantee ownership of an email address.
- Invite links are removed from browser history on opening. No database migration or actual emails have been executed.
- Operational requirements: recovery and reissue UX, idempotency / delivery reconciliation, signed in-session account match, session flow integration, and dedicated staging security tests.

## Seventh implementation slice (code added, not deployed)
- Admin can save or disable one approved HTTPS camera link per VIP project. Every mutation is audited.
- Camera provider domains must be explicitly allowed in `KINGLIKE_VIP_CAMERA_ALLOWED_HOSTS` (comma-separated exact hosts, no wildcard or IP addresses).
- Clients can see the camera link only while they own an active unit in the relevant project, and only when the admin marks the camera active.
- The approved vendor stream opens in a separate tab; in-app embedding requires provider permission, a reviewed Content Security Policy, and security assessment.
- Streaming access restrictions enforced by the camera provider must be verified separately. Sharing a link may allow use outside the VIP portal unless the vendor supports per-client access tokens.

## Eighth implementation slice (code added, not deployed or tested)
- Kinglike management can upload JPEG/PNG project photos with dates and captions to private GCS; all photos start as unpublished drafts.
- Admin explicitly publishes/unpublishes each photo. All visibility and upload changes produce audit events.
- Only clients owning units in the corresponding project can list or view published photos. The image is served by a session-protected, no-store server endpoint; no public image URLs are used.
- Files are limited to 8 MB and inspected for image signatures. Storage remains disabled without configured private bucket credentials.
- Further hardening before production: image re-encoding / EXIF stripping, malware scanning, retention policy and full access-control regression tests.

## RTSP.RUN preferred camera playback (additional code; not launched)
- Prefer an RTSP.RUN-generated HTTPS browser player URL. Never paste raw RTSP/RTSPS camera URLs or camera credentials into VIP.
- RTSP.RUN and www.rtsp.run are accepted as exact providers; custom providers still require `KINGLIKE_VIP_CAMERA_ALLOWED_HOSTS`.
- The owner may opt into an iframe player inside VIP, with a new-tab fallback if the provider disallows embedding. It is not automatic autoplay and never verifies that a given player page contains a working stream.
- RTSP.RUN currently expects a **publicly reachable stream**, so a VIP login protects access to the link in Kinglike, not the underlying public stream. Do not use for private CCTV or sensitive areas.
- Before launch, confirm the generated RTSP.RUN embed URL format, actual playback on Android/iOS, provider terms, frame-src CSP, camera/network exposure and project-developer authorization. The provider may block iframing.
- No client camera credentials, IP camera addresses or raw RTSP strings are stored in the VIP project camera URL field.

## Handover Center — staged implementation (code added; no database migration run)
- Owner can request a preferred appointment only after management marks the unit ready; a request never schedules automatically.
- Kinglike admin may confirm/decline requests and updates only a unit's stage. All changes are auditable.
- Technical inspection checklist has six fields; all must pass and open snags must be zero before marking inspection complete.
- Buyer can report issues after a confirmed inspection appointment; staff can resolve each with a recorded note. A pending issue blocks completion.
- Client sees only the unit assigned to their active owner entitlement; the server enforces access independently of UI.
- **Legal acceptance and key handover are intentionally not activated:** the flow does not substitute for signed inspection/handover documents or authorized key delivery confirmation.
- Requires isolated database migration, workflow integration and cross-account tests prior to activation.

## Digital VIP card, anonymous QR verification and referral review (new slice; code not deployed)
- A buyer with at least one active unit assignment can issue a revocable KINGLIKE VIP card, with a cryptographically random 96-bit code. No fake cards or personally identifiable data in QR.
- Local MIT-licensed qrcode-generator code generates QR artwork inside the app. No external QR API receives customer card codes. Its source and license are included in the feature directory.
- A public verifier returns only active/inactive and tier; never names, email, personal identifiers or properties.
- Admin may review membership tiers and revoke a card. Tiers alone do not convey benefits or discounts; revoked codes must not silently reactivate.
- Owners may submit up to three referral contacts per 24h, only after explicit contact consent, using E.164 phone format. Duplicate contact submissions by the same owner are blocked.
- Admin manages referral transitions: new -> contacted -> qualified -> converted, with a sale reference required to record conversion. Rewards are separate: proposed -> approved -> fulfilled, or declined. Nothing auto-awards discounts.
- Referral phone/name are not exposed to other customers. Only the referrer and admin see them. Referral audit logs never contain lead phone numbers.
- Future work: verified CRM sale reconciliation and referral consent proof, private marketing retention policy, actual approved benefit catalog, card reissue procedure and user notification integration.
- Requires isolated DB migration and actual end-to-end authorization and QR scanning tests before launch.

## Private in-app notifications (code added; not deployed)
- Management can send a per-unit in-app message to the currently assigned owner. No outbound email, SMS, push, or WhatsApp call.
- The owner can view and mark only their notifications read; server additionally checks current unit entitlement, preventing access after owner revocation.
- The client UI also computes unpaid installments due within two days when the account is opened. This is an in-app view, **not a scheduled delivery/push notification**.
- Per-unit limit of five manual admin notices in 24h, with audit logging, to reduce accidental repeats.
- Future work: approved scheduled dispatch jobs for two-day due reminders, deduplication, client communication preferences and time-zone policy.

## Seller permissions and read-only client file (new implementation; not deployed)
- Admin can assign exactly one **active verified staff account** as the unit's selling agent, after a buyer has accepted the ownership invitation.
- Only allowed staff roles can be assigned (`sub_agent`, `crm_employee`, `sales_agent`, `employee`, `agent`); ordinary buyers cannot be assigned as agents.
- Reassignment automatically revokes the previous agent. Explicit revocation and any transfer both require a reason and write an audit record.
- Seller's private dashboard `/vip/sales` reads only units with an active seller entitlement. Every read additionally requires an active buyer owner on that unit; canceling an owner's access also stops seller file and receipt downloads. Installments, receipt metadata, statement request states and handover status are visible in **read-only** mode. Seller downloads of receipts use the existing server-checked entitlement gate.
- Database enforces **at most one active seller per unit**, and isolated Postgres tests validate uniqueness, seller isolation and access revocation.
- No seller permission to upload, validate payments, edit a buyer, issue membership rewards, schedule delivery or manage security settings.
- Privacy prerequisite for launch: employee offboarding must revoke all seller grants, audit and session invalidation must be tested with actual accounts, and a concrete HR-role mapping must be reviewed before any employee invitation.

## Journey, approved benefits and after-sales service requests (new code, not deployed)
- Six dated milestones from reservation and contract through down payment, construction, inspection and handover; only management-published stages appear to the owner.
- Timeline dates are explicitly recorded by admin. Stage completion cannot be marked without an actual date. Stage display does not claim a legal handover, confirmed payment or developer sign-off.
- Admin-written benefits for second purchases, fit-out, furnishing and after-sales services default to drafts; only explicitly published written terms appear to owners. No automatic discount promises.
- Owners may request fit-out, furnishing, utilities or rental-management assistance on their own units; admin moves requests through a reviewed state machine with written replies. Submission itself never commits a quoted price or service completion.
- Owner access enforced per-unit at API level. Service requests are rate-limited to four submissions per owner per 24 hours.
- Requires actual staging role tests, translated benefit content supplied by management, legal review of offers and developer milestone reconciliation before launch.

## Financial summary, documented adjustments and official developer statements (new code, not deployed)
- Customer account summary totals are grouped by each installment currency. Scheduled, finance-verified and outstanding installment amounts are derived from independent verified payment postings; never mix currency totals or auto-apply exchange rates.
- Documented tax, penalty, maintenance, discount or service fee entries are **separate records**; they do not silently modify installment balances. Unverified internal notes cannot be published to clients.
- Admin can record and publish external-source financial adjustments and void an entry without deleting audit history.
- Client requests an official developer statement at most once monthly per unit. Admin now can attach an actually received developer PDF (source attested), stored in the private VIP bucket; only the requesting active unit owner may download it.
- Uploaded receipts are not official statements, and the locally generated financial summary must never be labeled as one.
- Private document storage requires dedicated isolated GCS credentials and enforced bucket privacy. No secret has been transferred, and no real PDF upload has yet been tested.
- Still needed: approved currency conversion/exchange-rate source and effective date, internal-only commission reporting, official payment penalty policy per developer, full accrual/credit accounting and real Staging owner-versus-stranger tests.

## Private referral share link and opt-in landing (new code, not deployed)
- Each active VIP owner can generate a 128-bit cryptographically random and anonymous referral URL.
- The visitor may submit their name and international phone **only after giving their own contact consent**. The URL and page reveal no VIP owner identity, property or email.
- The referrer may track linked referral status and approved rewards; name and phone from the public visitor form are withheld from the referrer. Admin alone sees contact details.
- The direct referral form remains supported; invitee-submitted referrals share the same three-per-owner-per-day cap and deduplication.
- The link does not create any sale or reward automatically. Conversion remains an administrative action with sale reference.
- Still needed before real customer launch: spam mitigation beyond per-owner limit, legal retention/consent copy review, CRM synchronization and real public-link anti-abuse testing.

## Idempotent 2-day in-app due reminder job (added; NOT automatically scheduled)
- A standalone generator creates a reminder exactly two calendar days before an unpaid installment date, respecting active ownership, active accounts and opt-out preferences.
- A unique event source key prevents duplicate reminders even if the generator runs multiple times or workers race.
- A user's `in_app_due_reminders` preference controls future generated reminders. No external messages are sent and there is no background run on application startup.
- The generator remains **inert until the operator explicitly configures a scheduler and tests staging**. No Railway/Replit scheduled job, WhatsApp message, email or push notification has been activated.
- Isolated Postgres tests cover initial due alert, duplicate suppression, opt-out and fully paid installment suppression.
- Future work: explicit opt-in for outbound channels, scheduled job idempotency in staging and localized push/WhatsApp/email templates after approvals.

## Owner-only in-app status events (new code; not deployed)
- Admin publication of an investment milestone creates a unique owner-only `journey_update` event with no buyer payment authorization implied.
- Management replies that change an after-sales request state create a unique `service_update` event, visible to the current owner who submitted that request.
- Attaching an actual developer statement creates a `statement_ready` event in the same database transaction, avoiding a notification before the official PDF is recorded.
- A composite per-owner event key deduplicates retries and prevents a customer from receiving repeat alerts for the same event.
- Notification text is localized in the client's five supported languages. These are account-internal alerts only; no email, WhatsApp, push notification or SMS has been activated.
- Safety requirements before launch: verify correct entitlement changes after transfer, in-app notification suppression for revoked owners, and end-to-end tests of stored document access in staging.

## Next implementation slices (not yet completed)
1. Validate schema against the exact staging database and create migration review/tests.
2. Verify secure buyer invitations and activation flows in isolated staging (first code slice now added).
3. Run isolated staging tests of private receipt uploads, downloads and finance verification; implementation exists but is not validated.
4. Developer statement requests once per unit/calendar month, admin request queue.
5. Management photo uploads and camera settings with signed/approved URLs (progress updates are drafted).
6. Handover, digital VIP card, notifications and referral flows.
7. Automated tests of cross-account authorization, audit records and email idempotency, then controlled staging launch.

**Important:** Main and the WhatsApp staging branch did not share a common ancestor in the observed GitHub comparison. Do not merge by force or overwrite either branch. Reconcile changed files explicitly after WhatsApp work settles.
