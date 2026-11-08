# WhatsApp monitoring: Railway Staging isolation plan

Status: code guard implemented; Railway execution remains planning only.
Nothing in Railway, Meta, Neon, or any deployed database was inspected or
changed for this plan.

## Target identity to confirm later

Before any staging work, the owner must confirm in Railway's UI that the project
is the separate **Kinglike-Web-Staging** project and the service is
**reliable-art**. Railway's internal environment label may say `production`;
that label does not prove this is the production project. Confirm the project
identity independently and set `APP_DEPLOYMENT_MODE=staging` only after that
check. Do not infer mode from the internal environment name.

## Required gates before a staging preview

1. **Database isolation:** provision or designate a staging-only PostgreSQL
   database. In Staging, `server/db.ts` selects only `APP_STAGING_DATABASE_URL`
   and uses the standard PostgreSQL driver; it never falls back to
   `NEON_DATABASE_URL`. Before route registration, bootstrap SQL, or workers,
   the app requires `APP_STAGING_DATABASE_EXPECTED_HOST` and
   `APP_STAGING_DATABASE_EXPECTED_NAME` to match that URL, non-empty
   `APP_STAGING_DATABASE_CONFIRMATION` and `APP_STAGING_STORAGE_CONFIRMATION`,
   plus distinct `PRODUCTION_DATABASE_HOST` and `PRODUCTION_DATABASE_NAME`.
   A matching stale `NEON_DATABASE_URL` is rejected. The app then runs a
   `SELECT current_database()` preflight and requires that name to match the
   approved Staging identity. Missing identity, URL mismatch, unreadable DB,
   or returned database mismatch aborts startup with a generic error; identity
   values and credentials are not logged. Do not use a production clone
   containing personal data. Only synthetic employees, conversations, and
   consent may be used for a later review.
2. **No Meta connection:** leave the Meta prototype disabled; do not inject a
   Graph verifier or Meta credentials. Embedded Signup, token exchange,
   Graph calls, and number activation must stay unavailable.
3. **No webhook or sends:** `APP_DEPLOYMENT_MODE=staging` blocks WhatsApp
   webhook requests, Embedded Signup/admin activation routes, Meta Graph HTTP
   routes, Twilio OTP routes, and the app's Meta WhatsApp/interactive send
   helpers. It also prevents the configured schedulers, queue workers, and
   broadcast resume path from starting. Email and push notification sender
   entry points are also guarded. Railway flags being accidentally true do not
   override these code checks. Still keep external credentials absent and
   webhook delivery disabled at the provider; the code guard is defense in
   depth, not authorization to configure a live integration.
4. **Review-only UI:** the local API/archive preview in this PR requires
   `NODE_ENV=test`, `APP_DEPLOYMENT_MODE=test`, and a loopback test database.
   Do not weaken that gate for Staging. The page remains Mock by default and
   its Live signup button is hard-disabled. A separate reviewed change is
   required before adding any staging-only synthetic fixture provider.
5. **Authorization and audit:** staging fixture reads must require a current
   active admin, an active per-phone synthetic consent, and append-only audit
   persistence before returning data. Audit failure must return 503 with no
   archive content. Logs must omit message bodies, numbers, tokens, and codes.
6. **Data/rights:** retain the owner's declaration that company numbers belong
   to the company, but do not treat it as Meta verification or employee
   consent. Keep employee notice/consent and review of applicable rights
   mandatory. Do not add automatic archive expiry or purge.

## Safe sequence for a later owner-led review

1. Confirm project/service identity, database host/name isolation, and the
   runtime `APP_DEPLOYMENT_MODE=staging` value in Railway's UI.
2. Obtain owner approval for the exact synthetic fixture database. Confirm
   `APP_STAGING_DATABASE_URL`, its expected host/name, the production host/name
   used only for collision rejection, and both existing confirmation values
   in the separate service configuration. Do not copy production database
   values into the staging URL. Keep Meta, webhook, and outbound-send settings
   off. No Railway variables were read or changed for this code update.
3. Implement and review that staging-only fixture provider in a separate PR
   update. It must reject production mode, reject any database not explicitly
   identified as staging, return synthetic records only, and preserve the
   current local `NODE_ENV=test` gate.
4. Only after owner approval, publish/restart the separate staging service
   through Railway and verify the admin-only screen, consent-denied
   conversation exclusion, audit-before-response, and audit-outage 503 using
   synthetic fixtures. Confirm no webhook delivery or outbound request.
5. Keep real-number onboarding and any live activation NO-GO until the
   independently reviewed Meta v4 configuration, server verifier, employee
   notice/consent, rights review, and a separate activation approval exist.

No staging deployment, restart, migration, secret change, Meta action, or live
activation is authorized by this document. The separate Staging-only synthetic
archive provider is still absent; the existing archive preview remains local
test-only.
