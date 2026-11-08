# Meta TEST WABA read-only preflight — local operator tool

**Status: draft / not activated / no real Meta test performed.**

This operator-only script verifies one narrow fact: given an explicitly
designated Meta TEST WABA, can an authorized temporary token list the
designated test phone ID under that WABA?

It does **not**:
- Determine whether the WABA is a test business (that must be confirmed by
  the owner from Meta's API Setup page).
- Verify that any employee number is supported for Coexistence.
- Subscribe or configure a webhook, download messages, fetch contacts,
  send messages, change phone registrations, exchange OAuth codes, or touch DB.
- Read production messages, account profile names, or personal phone numbers.

## Environment prerequisites (local operator workstation only)

1. In **Meta Developers > Use cases > Connect on WhatsApp > API Setup**,
   confirm that you are selecting the **Meta test phone number**, not any
   company or employee production number.
2. Confirm test WABA ID and test Phone number ID shown there. These IDs
   are identifiers, not secrets. Do not use a production WABA/number.
3. Generate a temporary test access token in Meta **only when ready**. Do
   not paste any token into ChatGPT, GitHub, screenshots, chat, or a command
   line that is recorded in shell history. Prefer your local secrets manager
   or a secure environment injection tool.
4. Explicitly supply these environment variables to the local process:
   - APP_DEPLOYMENT_MODE = local-meta-test
   - WHATSAPP_META_TEST_READ_ONLY = YES_READ_ONLY
   - WHATSAPP_META_TEST_GRAPH_VERSION = v27.0 (or an exact supported version)
   - WHATSAPP_META_TEST_WABA_ID = *test WABA ID only*
   - WHATSAPP_META_TEST_PHONE_NUMBER_ID = *test phone number ID only*
   - WHATSAPP_META_TEST_ACCESS_TOKEN = *temporary test token from secure store*
5. Run: node scripts/meta-test-waba-readiness.mjs

**Never set these variables in the Kinglike-Web-Staging or production
Railway project.** The script cannot run under APP_DEPLOYMENT_MODE=staging
or production and is not registered as a server API endpoint. It does not
use existing application secrets or any production DB connection.

## Result meanings

- disabled: no network call attempted. Mode/opt-in not satisfied.
- invalid_configuration: no network call attempted. Reject misconfigured IDs.
- lookup_failed: HTTP/auth/timeout issue, details suppressed.
- unexpected_response: non-conforming response, suppressed.
- phone_not_listed: the specified number was not found in the first response.
- incomplete_page: the requested number was not in the first page; do not
  treat this as a definitive failure (no pagination or further call attempted).
- phone_association_found: a successful read-only GET listed the exact
  configured phone ID under the configured WABA.

All results **always** state:
- testedLiveMessageDelivery=false
- testedWebhookDelivery=false
- verifiedAsTestAccountByMeta=false
- noMessageSendsPerformed=true

No ID, phone number, token, Graph response or error message is logged.
If a request fails, check the Meta UI locally, never share the token.

## Scope and next gate

This tests Graph account access only. Next, separately evaluate an isolated
test-WABA webhook delivery plan that cannot change the existing Replit
webhook subscription, and obtain the owner's explicit approval before any
real token, callback, or message-send change.

## Synthetic unit tests

Run with no credentials:

    node --test scripts/meta-test-waba-readiness.test.mjs

Tests use an injected fake fetch. They do not contact Meta.
