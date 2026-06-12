---
name: Ambassadori browser automation
description: Playwright headless form submission for broker.islandambassadori.com; session cookies stored in DB; startup false-success fix
---

## Architecture

- `server/ambassadoriSessionStore.ts` — CRUD for `ambassadori_session_store` table; `buildEnvTokenSeed()` seeds localStorage from `AMBASSADORI_SESSION_TOKEN` env when no stored session exists
- `server/ambassadoriBrowserService.ts` — Playwright headless Chromium; `submitLeadViaBrowser(recordId, adminId)` main entry point; `fixAmbassadoriUnverifiedSuccesses()` startup fix

## Chromium setup

- Installed via Nix: `chromium` system dependency (not Playwright bundled browser)
- `resolveChromiumPath()` uses `which chromium` → hard-coded Nix store path fallback
- Hard-coded fallback: `/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium`
- If Nix path changes after a Nix update, update `NIX_CHROMIUM_FALLBACK` constant in the browser service

## Session lifecycle

1. On first run: no session in DB → `buildEnvTokenSeed()` injects `AMBASSADORI_SESSION_TOKEN` as `localStorage.token`
2. After each browser run: fresh cookies + localStorage snapshot saved back to DB
3. Session considered expired if >20 hours old (`isLikelyExpired`)
4. Admin can manually save cookies via `POST /api/admin/developer-registration/ambassadori/save-session`

## Form selectors (broker.islandambassadori.com/deals/create — ITRIELT Vue SPA)

Russian-language labels. Selectors tried in order:
- Name/Surname: `input[placeholder*="Имя"]` / `input[placeholder*="Фамилия"]`
- Phone: `input[placeholder*="Телефон"]` / `input[type="tel"]`
- Property type: `select[name="property_type"]` → `selectOption(page, "Квартиры", "Apartments", [...])`
- Project/Expert: `input[placeholder*="Проект"]` / `input[placeholder*="Эксперт"]` — type + click first dropdown option
- Check uniqueness: `button:has-text("Проверить уникальность")`
- Submit: `button:has-text("Создать сделку")` / `button[type="submit"]`

**Why:** Portal uses PHP session state that API token-only approach cannot satisfy; full browser automation bypasses this limitation.

## Routes added

- `POST /:recordId/submit-to-ambassadori-browser` — triggers browser automation
- `POST /:recordId/mark-manually-confirmed` — admin confirm (sets status=success, logs audit)
- `GET /ambassadori/session-status` — returns `{hasSession, isLikelyExpired, ageHours, cookieCount}`
- `POST /ambassadori/save-session` — body: `{cookies: [...], localStorage?: {...}, userAgent?: "..."}`

## False-success fix

`fixAmbassadoriUnverifiedSuccesses()` — converts Ambassadori `status=success` records where NO audit attempt has a non-empty `deal_id` in `payload_json` → `needs_review` + `next_registration_at=NULL`. Idempotent; runs at startup automatically on every server start.

## Outcomes

- `success` — deal created (with or without deal ID)
- `protected` — portal confirmed duplicate → maps to `success` status in DB
- `login_required` — session expired, redirected to login page
- `needs_review` — submitted but no success confirmation detected
- `failed` — browser error or Chromium not found
