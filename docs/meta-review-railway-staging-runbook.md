# Meta review — Railway staging runbook

This is a gated plan, not a deployment record. No Railway staging service, database,
public domain, reviewer account, or Meta setting was configured or verified while
writing this document.

## 1. Establish an isolated staging target

1. Select the existing Railway **staging** project/service, not the production service.
   Deploy this feature branch only after the staging owner approves it.
2. Attach a dedicated staging database with no production data and no shared production
   credentials. The server expects `NEON_DATABASE_URL` outside tests; set it only in the
   Railway staging environment to the staging database. Do not copy production Neon
   variables into the service.
3. Keep background schedulers, outbound messaging, Meta/WhatsApp integrations, and any
   unrelated production-connected workers disabled. Confirm the staging startup path
   cannot run production migrations or jobs before its first boot.
4. The repository's `railway.toml` builds with `npm run build` and starts with
   `npm run start`; it does not identify a staging service, database, or domain.

## 2. Configure reviewer access without exposing credentials

1. Keep `META_REVIEW_WA_REVIEWER_ENABLED` unset or `false` while preparing the service.
2. In Railway's staging-only Variables/Secrets interface, add the approved reviewer
   email and a bcrypt password hash under the documented reviewer setting names.
   Generate the hash using an approved secure workstation or password-management flow;
   never paste the password/hash into chat, source, PR text, build logs, or GitHub.
3. Check the secret values are attached to the staging service only. Do not alter the
   previously supplied reviewer account, its password, or the existing Meta review link.
4. Enable the reviewer flag only after the staging DB, public domain, route isolation,
   and reviewer identity are confirmed. If any required value is absent or invalid,
   authentication must remain unavailable.

## 3. Choose and verify a stable public staging address

1. Assign a Railway staging service domain or a dedicated staging custom domain. Do not
   use a Replit Preview / `replit.dev` URL as the review URL.
2. Record the actual HTTPS domain only after it is assigned to the staging service.
   Do not assume that a domain from another environment or an earlier review is valid.
3. From a browser outside Replit, in a fresh private session with no Replit account
   session, request:
   - `/login?redirect=/admin/whatsapp-monitoring`
   - `/admin/whatsapp-monitoring`
4. Confirm TLS and the expected host, that the login page is available, and that the
   monitoring page redirects to login or shows only the unauthenticated gate. A bare
   HTTP 200 from an SPA fallback is not sufficient proof that the route exists.
5. Use a staging-only reviewer session only after the identity owner approves secure
   credential handoff. Confirm the reviewer cannot access employee conversation APIs,
   CRM/admin APIs, or WhatsApp AI APIs. Do not record or share the password.

## 4. Keep Meta test traffic separate and opt-in

- Leave `META_REVIEW_WA_TEST_ENABLED` disabled for login, route, and mock-isolation
  checks. These checks do not require a Meta token or a real WABA.
- Do not configure production WhatsApp credentials in staging. Configure a dedicated
  Meta Test WABA only after an explicit test approval and verified test recipient.
- No send is part of this runbook. Any later send requires a separately approved test
  window and must use the fixed test template/recipient path only.
- The employee archive stays mock-only and separate from Test-WABA webhook events and
  WhatsApp AI. Reviewer authorization does not grant access to employee conversation
  APIs.

## 5. Evidence required before sharing the review link

- Staging service, staging DB, and stable HTTPS domain are confirmed by their owners.
- Automated build and isolated reviewer/route tests pass.
- External unauthenticated browser checks confirm the real routes, not only an SPA
  fallback.
- Reviewer account works in staging and is limited to review/test endpoints.
- No production database, production number, customer conversation, real Meta send, or
  production setting was used.

Until these checks are completed, the reviewer link/account must be reported as
**unverified** and the review feature must remain disabled outside isolated staging.
