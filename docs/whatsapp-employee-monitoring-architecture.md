# WhatsApp Employee Monitoring — Phase 1 Architecture Proposal

## Scope

Phase 1 is an admin-only, mock-data monitoring experience. Employees continue using
WhatsApp Business on company-owned phones. This phase does not send messages, connect
phone numbers, create a Meta webhook, or call any WhatsApp, Meta, BSP, R2, or database
service.

The UI is intentionally isolated so the mock data can be removed when the approved
production integration is designed.

## Meta review harness is separate

The employee archive remains mock-only. It does not read employee WhatsApp accounts,
production conversations, production phone numbers, WhatsApp AI data, or Neon tables.
Its fixtures and internal notes are in memory and are cleared when the process restarts.

The Meta review panel is a separate, opt-in test harness. Embedded Signup is loaded only
when its explicit prototype flag and app/config IDs are configured. Cloud API test sends
and management reads require the dedicated `META_REVIEW_WA_TEST_*` settings and are
restricted to a fixed test template and test recipient. Signed test webhook events are
buffered in memory; they are not merged with employee archive fixtures.

Reviewer login is also disabled unless an explicit reviewer flag, email, and bcrypt
password hash are configured. The account identity comes from those deployment settings,
not a database row, so it remains stable across restarts without changing production
users or requiring a Neon migration. The reviewer session is limited to the review
workspace, its prototype configuration, and the isolated test-WABA endpoints. The
reviewer cannot call employee conversation APIs.

Required reviewer setting names (values belong only in the deployment secret manager):

- `META_REVIEW_WA_REVIEWER_ENABLED`
- `META_REVIEW_WA_REVIEWER_EMAIL`
- `META_REVIEW_WA_REVIEWER_PASSWORD_HASH`

Do not enable reviewer access until the supplied account has been verified and its
password hash is provisioned securely. Do not place a password, token, recipient, or
account ID in source code or this document.

## Future integration direction

The future integration should use the **direct Meta WhatsApp Cloud API with
Coexistence**. It should not use a BSP, Twilio, 360dialog, or another intermediary.
The monitoring page remains admin-only. Employees continue using WhatsApp Business
on their phones while authorized company numbers and conversation events are
archived for administration.

The future service boundary should include:

- A backend-owned Meta webhook and signature verification.
- Backend RBAC and audit authorization for every conversation and media read.
- Server-side employee-to-company-number ownership mapping.
- Immutable message and deletion event history.
- Short-lived signed media URLs.
- No secrets or message content in the frontend bundle or application logs.

The current frontend guard is sufficient for this mock-only preview, but **frontend
protection must not be used as the only authorization layer in the real integration**.
The real version requires backend RBAC that returns 403 for unauthorized users and
enforces employee conversation scope server-side.

## Storage proposal (not activated)

PostgreSQL should store structured data and audit metadata only:

- Company WhatsApp numbers and employee assignments.
- Contacts and conversations.
- Messages and message status events.
- Deletion events, preserving the archived copy.
- Media metadata and retention state.
- Admin internal notes.
- Append-only audit events for views, downloads, and future administrative actions.

Cloudinary remains the existing store for property, project, and blog media. Existing
Cloudinary assets must not be moved as part of WhatsApp monitoring.

Cloudflare R2 can be evaluated later for WhatsApp-only archived images, videos, voice
messages, and documents. No R2 bucket, account, credential, secret, or migration is
created in Phase 1.

## Explicitly excluded

- Future Messages.
- Sending real WhatsApp messages.
- AI replies.
- WhatsApp call recording.
- Personal phone numbers.
- Client-facing monitoring pages.
- Customer access to internal notes.
- Deleting archived evidence from the monitoring store.
- Production database migrations.

## Administrative and legal requirements

Only company-owned numbers may be connected. Employees must be informed in writing
that work conversations are archived and subject to administrative monitoring. Personal
numbers must not be connected. WhatsApp calls are not recorded.

Any future retention or deletion operation requires a separate permission and a
documented policy. The Phase 1 mock has no deletion operation.

## Feature flag proposal

The direct integration should be protected behind a feature flag that defaults to
`OFF`. Enabling it should require an explicit administrative rollout decision, a
backend RBAC review, signed webhook verification, retention policy approval, and
separate media-storage provisioning.