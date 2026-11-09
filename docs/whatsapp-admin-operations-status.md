# Kinglike Luxury — إدارة واتساب الموظفين (Staging, read only)

## What is implemented

- A **real admin menu entry** labelled **إدارة واتساب الموظفين** that
  navigates to `/admin/whatsapp-employee-operations`.
- New Arabic, mobile-friendly admin page clearly separate from the existing
  **mock conversation UI**, with a refresh action, safety labels, and links
  to GitHub PRs/CI and the separate Railway Staging project.
- New `GET /api/admin/staging/whatsapp-operations-status` server endpoint
  returns a **redacted** live summary:
  - dedicated proof database select-only counts of flows and proofs
  - Meta TEST WABA webhook configured or not
  - real staff enrollment disabled / awaiting separate review
  - employee monitoring disabled, no verified linked-number claim
  - timestamp generated on the server
- Only `APP_DEPLOYMENT_MODE=staging` and currently active admin session
  granted by the established application storage may access the endpoint.
  Outside staging the endpoint is 404, without admin it is 403.
- Never read the general CRM or Neon app DB for WhatsApp proof counts.
  No real phone/customer identifiers, message contents, secrets, or Meta
  requests are returned.
- The UI shows Samer, Fadi, Joanna as **planned pilot slots**, not actual
  Meta or CRM records, and explicitly labels that distinction.

## What this deliberately does not do

- Does not enable the Embed Signup / Connect button.
- Does not connect Samer's real phone, sync history, listen to real staff
  chats, grant anyone an archive permission or store any customer message.
- Does not merge into `main` or deploy production.
- No changes to underlying employee WhatsApp/CRM permissions.

## Verification

GitHub Actions runs the admin authorization tests, dedicated proof DB tests
and full application build. A separate owner-approved Railway Staging deploy
is required before this page appears on the Staging URL.

## Important deployment check

Navigate to the Staging URL with an **active admin login**, then
`/admin/whatsapp-employee-operations`. If the database is unavailable,
the status will say **unverified**, never success. Do not treat a
synthetic-success CI result as real Meta eligibility or a connected employee.
