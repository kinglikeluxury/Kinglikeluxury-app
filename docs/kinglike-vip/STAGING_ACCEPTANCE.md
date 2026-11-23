# KINGLIKE VIP — Isolated staging acceptance plan
Status: **NOT EXECUTED**. This is the required test plan before any client or employee access.

## Safety gates
- Use a dedicated staging database, a separate private object-storage bucket, and test accounts only.
- Never run VIP migrations against Neon production or send staging email/WhatsApp to real contacts.
- Verify the staging service's identity, branch SHA, environment variables **names only**, and rollback before starting.
- No customer production records, developer documents, phone numbers or payment credentials in fixtures.
- Enable VIP only via feature flag in the isolated staging deployment, not via a production toggle.
- Test all five supported languages (Arabic, English, Turkish, Hebrew, Azerbaijani), including RTL on mobile.
- A passing code build is **not** an acceptable substitute for the tests below.

## Accounts / data setup
Create: admin A, buyer B with units U1 and U2, buyer C with unrelated unit U3, seller D assigned to U1, seller E assigned to U3, finance verifier F with only finance approval permission, and buyer G with no property.
Use synthetic developer, project, document and phone data.

## Acceptance matrix
| ID | User journey | Required observable result |
|---|---|---|
| A01 | Admin invitation -> activation -> fresh browser login | Buyer B sees only U1/U2; password reset doesn't grant arbitrary unit access |
| A02 | Buyer C/G guesses U1 URL / API IDs / receipt downloads / statement link | 403/404, no identifying data, no file bytes |
| A03 | Seller D reads U1 then guesses U2/U3 | Only U1 visible; seller cannot approve payments or update account |
| A04 | Admin reassigns U1 to E then revokes ownership | D loses access immediately; E loses access when owner is revoked |
| A05 | B and admin upload receipts to a specific installment | Correct uploader/source/time; receipt pending; verified balance unchanged |
| A06 | F verifies receipt; test double-post/race | At most one approved posting per receipt; amount/currency validated; audited |
| A07 | Request official monthly statement twice / download another buyer's file | One per unit/month; private PDF available only after admin attaches developer original; cross-user access denied |
| A08 | Multi-currency account with USD/GEL/AZN installments and documented adjustments | Totals segregated by currency; draft or internal-only adjustments hidden; no invented exchange conversion |
| A09 | Admin updates construction photos, camera URL, and an investment milestone | Only published content appears; RTSP.RUN camera works via authorized streaming gateway on real device |
| A10 | Client books handover, reports snags, admin marks resolved | Stage transition rejects incomplete inspection or unresolved issues |
| A11 | Admin approves keys; client acknowledges physical receipt; admin confirms | Keys never become delivered without both confirmations and developer references; replays rejected |
| A12 | B issues a VIP card; admin revokes it; unrelated user scans QR | QR reports only validity/tier, never owner identity; revoked code fails |
| A13 | B shares referral URL; visitor gives explicit consent; admin reviews conversion/reward | Referrer cannot see visitor phone; no automatic benefit; duplicates and abuse limits tested |
| A14 | B requests furnishing/fit-out and receives admin response | Request only reaches B/U1, not C; no implied financial guarantee |
| A15 | In-app due reminder runs twice with paid, partial, unpaid and opt-out cases | Exactly one notification per unpaid due installment when opted in; none for fully paid/opt-out |
| A16 | Actual mobile Android/iOS browser, home-screen/PWA installation (if offered) | Same account and server data, correct RTL, no session leakage; re-auth if needed |
| A17 | Link a staging CRM sale and test webhook retry | No duplicate account/unit or sale; no real Meta/Zoho messages from staging |
| A18 | Fail storage, email, stream and database independently | No false 'paid', 'delivered', or 'available' state; errors shown without leaking secrets |
| A19 | Review audit logs, secret handling and migration rollback | All sensitive actions audited; restore tested; no production connection |
| A20 | Explicit owner go/no-go after demo | No publish or main branch merge without final permission |

## Release blocker list
- Approved staging infrastructure and a verified isolated database/bucket.
- Secure object-storage credentials supplied directly to staging, never in chat or GitHub.
- Real authorization tests using signed-in roles (a database-only smoke test is insufficient).
- RTSP gateway and at least one authorized physical camera test.
- Paid/partial payment reconciliation with official developer data and correct effective dates.
- Invitation mail service in staging, phone/push/WhatsApp consent, localization and delivery conditions.
- Replit/Railway/Neon/CRM compatibility audit and merge reconciliation.
- Written sign-off from the product owner after actual device tests.

## Current verified automation
GitHub Actions on the feature branch runs TypeScript regression, pure-rule tests, isolated PostgreSQL migration tests, and an app build. **It does not deploy, run browser E2E, test live RTSP, or verify real S3/GCS permissions.**

**PRODUCTION CHANGE POLICY:** Main, WhatsApp staging, Neon production, and customer data must remain untouched unless the product owner explicitly approves the exact action.
