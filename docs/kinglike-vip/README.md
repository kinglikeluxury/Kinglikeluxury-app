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

## Handover approval and key receipts (new code; not deployed)
- Admin approval of handover readiness is allowed only after an inspection is completed, all checklist items pass, no unresolved snags remain, and a developer document reference and explanatory note are provided.
- The active buyer must confirm actual physical key receipt including date, key count and explicit acknowledgment; this is operational evidence only, **not a substitute for a signed legal handover document**.
- Management may only mark keys delivered after the active buyer has acknowledged the keys and an additional developer delivery document reference and admin confirmation are recorded.
- One immutable receipt record per unit; state changes are audited and are not automatically reversible. Reassigning ownership invalidates the original buyer's ability to acknowledge or confirm delivery.
- Isolated schema tests cover rejection of an administrative delivered status before buyer acknowledgment.
- Still required before production: actual signed handover document upload, optional delegated representative workflow, legal review of acknowledgment language and end-to-end account isolation tests in Staging.

## Operations dashboard, audit trail and support desk (new code; not deployed)
- Owner or assigned verified staff can open the private `/vip/support` desk. Ticket reads, messages and follow-up replies require live per-unit buyer access or explicitly assigned verified staff access; arbitrary IDs cannot enumerate other clients.
- An owner opens a ticket for a unit they actively own, with throttling to three new tickets per 24 hours and 15 replies per ticket/user per day.
- Admin can monitor incoming tickets, assign a verified staff member by email, record an internal reason, set a follow-up deadline and change status under constrained transitions. All updates create an audit event.
- The executive report groups amounts **by currency** without synthetic conversions or auto-generated commission amounts; it displays support SLA backlog, project milestones behind schedule, overdue installments, pending finance review and statements.
- A paginated admin-only audit viewer can inspect recorded VIP events and metadata; this is not an immutable/WORM or tamper-proof ledger.
- Next: actual CRM sales reconciliation, time-window SLA escalation workflow, private attachment upload for support tickets, audit retention/export policy, runtime performance and cross-account staging tests.

## Advanced finance and internal commissions (new code; not deployed)
- Finance-sourced FX rate records include source, reference, effective date and currency pair, and are created as **drafts**. Only a different authorized finance reviewer may publish them; they are never auto-applied to an installment or contract.
- Internal commission estimates support percentage of a sale basis **or** a fixed incentive amount, not both. Record type distinguishes developer revenue from employee/manager/field expenses.
- Admin can inspect private commission estimates. Clients and selling staff do not have commission endpoints or access to their amounts.
- Finance must separately approve an estimate before a second, externally-referenced settlement attestation can be recorded. None of these actions transfer money or independently prove a bank payment.
- The isolated PostgreSQL test asserts no mixed calculation method, no unapproved FX publication and no commission settlement without prior finance approval.
- Missing real-world requirements: approved developer contracts, company VAT/tax policy per country, reconciliation against actual bank receipts and any accounting ledger used by the company.

## CRM association safety boundary (new code; not deployed)
- Management can associate a VIP unit with an existing `crm_leads.id` only after confirming the signed contract and buyer identity. A conflicting known lead email is rejected.
- CRM lookups connect with `KINGLIKE_VIP_CRM_READONLY_DATABASE_URL` through a **dedicated, explicitly configured, read-only transaction**; no fallback to the normal application/Neon/Kay credentials is permitted. Missing credentials fail closed.
- VIP's association metadata is stored in `vip_crm_sale_links`, not in CRM tables. The existing CRM leads, assignees, statuses, WhatsApp settings, contacts and workflow remain untouched.
- At most one active CRM association per VIP unit, with explicit management reason and audit trail upon replacement or revocation.
- No automatic marketing outreach, lead distribution, sale conversion, referral qualification, unit activation or commission payment may be triggered by this association.
- Integration is **not yet connected** to a configured SELECT-only database role, and it has not been exercised against staging CRM data. A contract document reference is only an administrative attestation; legal document verification remains human-controlled.

## Stage-2 HTTP role isolation testing (new check; no live deployment)
- CI now starts a real Express HTTP test server with **fixture-only** session authentication and connects it to a disposable `127.0.0.1/vipdb` PostgreSQL service.
- Production VIP route modules are loaded with a **test-only** database import alias; production database credentials, Replit, Railway and Neon are not consulted.
- Test cases cover client ticket creation, denial to unrelated client/unassigned employee, correct assigned-staff reply, admin-only audit and insight endpoints, fail-closed CRM access when read-only credentials are absent, and immediate loss of staff access when owner access is revoked.
- The local database adapter hard-rejects all database hosts other than `127.0.0.1` or `localhost`, and all database names except `vipdb`.
- This is more comprehensive than schema-only tests, but is **not** a substitute for real session-cookie, storage, RTSP.RUN or device-level Staging tests.

## Stage-2 extended access matrix (new test-only checks; not deployed)
- The HTTP suite now exercises real Express handlers for read-only seller files, management assignment, owner financial summaries, unpublished fee isolation, construction milestone visibility, private notifications and read-state isolation, opt-out settings, anonymous referral links and rejection of premature key delivery.
- The tests include authorization revocation after owner access ends: former owner and seller must lose private unit files and unit-linked notifications.
- The disposable PostgreSQL user table now mirrors real, read-only-verified Neon account columns, including **username NOT NULL** and exact employee-role and verification flags. No production records are copied.
- All tests run against localhost-only `vipdb`, with a test-only DB module mapping. Live CRM, Railway, Replit, email and WhatsApp are never contacted.
- Still missing before launch: real auth cookies, private GCS IAM, actual RTSP.RUN device testing and an isolated preview host with dedicated credentials.

## Stage-2 genuine-session HTTP authorization QA (new, test-only)
- CI bundles the actual VIP route registry and exercises it through Express with real signed `express-session` cookies and a fixture-only local sign-in handler.
- A separate disposable PostgreSQL database is used; all DB references are resolved by a test-only local adapter. No Neon, Railway, Replit, public host, CRM, email or external storage credentials are available to the test.
- Coverage: feature flag kill switch; unauthenticated and forged-cookie rejection; active administrator access; strict buyer-to-unit isolation; scoped financial reads; same-origin CSRF protection; preference isolation between two buyers; immediate administrator deactivation; owner revocation without session renewal.
- The `/__qa/login` handler exists **only inside the CI test file** and is never registered in the deployed application.
- This closes a test gap in fixture-only header authentication but is not equivalent to exercising the app's actual production login form, third-party OAuth, or session persistence across live infrastructure.
- Staging still requires its own isolated secrets, storage IAM, actual login/activation, RTSP.RUN live camera test, PWA test, and independent security review.

## Dedicated VIP QA runtime architecture (preview code; NOT DEPLOYED)
- Railway project `Kinglike-VIP-Isolated-QA` was created, with its own environment `vip-qa`. A PostgreSQL template is **staged only**, not provisioned or billed by execution yet.
- The preview has a dedicated server entrypoint `server/vip/qaPreviewServer.ts` and build script `npm run vip:qa:build`. It does **not** import or start `server/index.ts`, CRM assignment, Kay jobs, Meta/WhatsApp handlers, or the production scheduler.
- It uses the genuine existing React VIP pages and server VIP routes, but requires separate per-preview Basic Auth in addition to the normal VIP account's signed session.
- Requires `KINGLIKE_VIP_QA_PREVIEW=true`, `KINGLIKE_VIP_ENABLED=true`, and explicit `KINGLIKE_VIP_QA_DATABASE_URL` (a Railway **private-network** PostgreSQL hostname only, not Neon or a public database).
- Requires strong `KINGLIKE_VIP_QA_GATE_USER` (4+ chars), `KINGLIKE_VIP_QA_GATE_PASSWORD` (20+ chars) and `KINGLIKE_VIP_QA_SESSION_SECRET` (48+ chars), set **by owner through their secret manager**, not stored in GitHub or conversation.
- Startup refuses a production Neon URL, CRM read-only credentials, or outbound mail credentials, and refuses to run until the isolated database has the reviewed VIP schema and accounts.
- Users log in using verified accounts created in the isolated database. Open registration is disabled, sessions are volatile/single-instance, and preview routes expose no real customer information.
- `npm run vip:qa:start` is intended only for the new **separate** Railway service, never the real Kinglike application. No existing Railway service build or start command has been changed.
- CI builds both normal application and this isolated preview variant. No preview host or domain is running yet.
- Before making preview live: review staged resources and possible charges, provision a clean database with synthetic test users, configure credentials and secure gateway, choose correct Railway QA build/start commands, run smoke tests including real Browser, GCS and camera. No real customer data should be imported.

## Isolated preview HTTP acceptance (additional QA, no live deployment)
- A localhost-only test now launches the **same standalone QA entrypoint** that would run on a dedicated Railway service. It exercises the gateway password, actual bcrypt-backed QA login, signed application sessions, owner/admin unit isolation, cross-site write refusal, disabled public registration and real React HTML served from the dedicated QA build.
- The test config is ephemeral and synthetic. CI does not provision or deploy any Railway service, import real customer records or configure real credentials.
- This test must pass before the separate QA project's staged PostgreSQL resources can be reviewed for activation.

## Private QA schema provisioning and synthetic accounts (code only; NOT executed)
- `server/vip/migrations/000_qa_users_only.sql` creates a minimal production-compatible users schema. It refuses any database that already contains real users or CRM tables.
- `server/vip/qaMigrate.ts` requires `KINGLIKE_VIP_QA_MIGRATE_APPROVED=true`, a private Railway database URL, and **zero existing public tables**; it applies the reviewed `000` and `001` schema files only to that dedicated new database.
- `server/vip/qaBootstrapAccount.ts` creates a single initial admin, and test-only buyer or seller accounts, using bcrypt password hashes. The operator must explicitly set `KINGLIKE_VIP_QA_BOOTSTRAP_ONLY=true`, `KINGLIKE_VIP_QA_BOOTSTRAP_ROLE=admin|buyer|seller`, `KINGLIKE_VIP_QA_BOOTSTRAP_USERNAME=qa_...`, `KINGLIKE_VIP_QA_BOOTSTRAP_EMAIL=qa_...@....test`, and `KINGLIKE_VIP_QA_BOOTSTRAP_PASSWORD` privately.
- No passwords or connection strings are printed or stored in the repository, application logs or ChatGPT. The bootstrap is a CLI-only command, never an HTTP endpoint or startup hook.
- Startup commands for the new isolated Railway service are `npm run vip:qa:build` and `npm run vip:qa:start`. Do not reuse them on production or existing WhatsApp staging.
- Both database provisioning and account creation are held pending manual secret entry, review of potential Railway usage charges, and approval of the staged infrastructure patch.

## Stage-2 private receipt and independent financial approval HTTP QA (test-only)
- A disposable, **in-memory storage shim** is substituted at CI bundle time for private GCS functions. The actual production and standalone QA preview continue to use their fail-closed private storage implementation.
- The HTTP suite posts a valid synthetic PDF receipt through Multer, verifies the buyer's own receipt list and private download, denies another owner's access, and confirms the receipt remains `pending` before independent review.
- A verified finance staff member must receive a separate administrative permission grant. Buyer and ungranted reviewer cannot approve, and repeated approval cannot create duplicate payment postings.
- Finance-approved amounts change only the authorized buyer's grouped financial summary; unrelated owners remain denied, and the finance grant can be revoked.
- This exercises actual Express + SQL + transaction logic with local PostgreSQL, but does NOT test GCS access policies, malware scanning, real financial evidence, or real physical developer statements. Those remain Staging acceptance gates.

## Next implementation slices (not yet completed)
1. Validate schema against the exact staging database and create migration review/tests.
2. Verify secure buyer invitations and activation flows in isolated staging (first code slice now added).
3. Run isolated staging tests of private receipt uploads, downloads and finance verification; implementation exists but is not validated.
4. Developer statement requests once per unit/calendar month, admin request queue.
5. Management photo uploads and camera settings with signed/approved URLs (progress updates are drafted).
6. Handover, digital VIP card, notifications and referral flows.
7. Automated tests of cross-account authorization, audit records and email idempotency, then controlled staging launch.

**Important:** Main and the WhatsApp staging branch did not share a common ancestor in the observed GitHub comparison. Do not merge by force or overwrite either branch. Reconcile changed files explicitly after WhatsApp work settles.
