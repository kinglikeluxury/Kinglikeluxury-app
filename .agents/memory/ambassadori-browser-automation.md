---
name: Ambassadori browser automation
description: Playwright headless form submission for the Ambassadori portal; session cookies stored in DB; startup false-success fix
---

## Why browser automation (not API)

The ITRIELT portal's `check-uniq/create_lead` endpoint requires active PHP session state in addition to the `Token:` header. The token-only API approach cannot satisfy this, so Playwright headless Chromium fills the form exactly as a human operator would.

## Session persistence

- Browser cookies + localStorage are persisted in `ambassadori_session_store` DB table after each run.
- On first run (no stored session), the `AMBASSADORI_SESSION_TOKEN` env var is injected as `localStorage.token` as a seed.
- Session is considered likely-expired after 20 hours.
- Admin can also manually save cookies via the API endpoint.

## System Chromium

Installed as a Nix system dependency. The service resolves the binary via `which chromium` at runtime; no Playwright bundled-browser download needed.

**Why:** Avoids a ~170 MB Chromium download on every container start. If Nix path changes after a Nix upgrade, the service will re-discover via `which chromium`.

## Form flow

Navigates to `deals/create`, fills Name / Surname / Phone / Property type (Apartments) / Project / Personal Expert, clicks Check Uniqueness, then submits. Detects duplicate / login-required / success outcomes from page state.

## Startup fix

`fixAmbassadoriUnverifiedSuccesses()` runs at server start (idempotent): converts any Ambassadori record marked `success` without a confirmed `deal_id` in its audit log → `needs_review`, clearing the next-registration date.

## Outcomes

`success` · `protected` (duplicate) · `login_required` (session expired) · `needs_review` (submitted, no confirmation) · `failed` (browser error)
