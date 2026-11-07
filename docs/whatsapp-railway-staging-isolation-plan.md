# WhatsApp monitoring: Railway Staging isolation plan

Status: planning only. Nothing in Railway, Meta, Neon, or any deployed database
was inspected or changed for this plan.

## Target identity to confirm later

Before any staging work, the owner must confirm in Railway's UI that the project
is the separate **Kinglike-Web-Staging** project and the service is
**reliable-art**. Railway's internal environment label may say `production`;
that label does not prove this is the production project. Confirm the project
identity independently and set `APP_DEPLOYMENT_MODE=staging` only after that
check. Do not infer mode from the internal environment name.

## Required gates before a staging preview

1. **Database isolation:** provision or designate a staging-only database.
   Verify its host and database name against the production values by an
   authorized owner; fail closed if either is missing, ambiguous, or matches
   production. Do not use Neon, a production clone containing personal data,
   automatic schema creation, or automatic migrations. Seed only synthetic
   employees, synthetic conversations, and synthetic consent records.
2. **No Meta connection:** leave the Meta prototype disabled; do not inject a
   Graph verifier or Meta credentials. Embedded Signup, token exchange,
   Graph calls, and number activation must stay unavailable.
3. **No webhook or sends:** disable/unregister the WhatsApp Cloud API webhook,
   all message send paths, background workers, schedulers, and retry queues.
   Verify the staging build has no outbound WhatsApp destination or credential
   before starting it.
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
2. Obtain approval for the exact synthetic fixture database and the narrow
   staging-only read path; keep Meta, webhook, and outbound-send settings off.
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
activation is authorized by this document.
