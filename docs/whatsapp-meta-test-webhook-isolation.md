# Meta TEST WABA isolated webhook — draft go/no-go plan

## Scope

This draft adds a **disabled-by-default** dedicated callback for the
**Meta-generated test phone** and its associated test WhatsApp Business Account,
plus a *read-only admin aggregate counter* in Staging.

It does **not** alter the app-level webhook URL (which currently points to
Replit), add/change any WABA or phone-number webhook override, subscribe any
number, register any phone, send any messages, import contacts, read any
employee conversations, or write to a database.

Callback (only when explicitly configured):
- GET/POST /api/webhooks/meta-test-waba
- Authenticated admin read-only status: GET /api/admin/staging/meta-test-webhook-status

Both routes are inert unless configured as below. The admin status route
requires an existing administrative session, and always returns aggregates
only. All received message bodies are discarded immediately.

## Strict activation gate

Do NOT set these variables or activate the callback until the owner has
approved this specific test *after* checking current account subscriptions.

The receiver needs ALL of these Railway Staging variables:

- APP_DEPLOYMENT_MODE=staging (already exists in Staging)
- WHATSAPP_META_TEST_WEBHOOK_ENABLED=true
- WHATSAPP_META_TEST_WABA_ID=<Meta test WABA ID ONLY>
- WHATSAPP_META_TEST_PHONE_NUMBER_ID=<Meta test phone ID ONLY>
- WHATSAPP_META_TEST_WEBHOOK_VERIFY_TOKEN=<new random 24+ character value>
- WHATSAPP_META_TEST_META_APP_SECRET=<Meta developer App Secret>

Never paste a Verify Token, App Secret or access token into a PR, chat,
screenshot, logs or GitHub Actions configuration. Keep the Meta app secret
in a restricted Railway secret variable only if this activation is approved.
The Graph API test access token is NOT used by this callback and should
never be put in the Railway environment.

Application-wide WhatsApp employee monitoring, onboarding and message
sends must remain disabled. The separate staging egress fence remains.

## Before any Meta webhook change

1. Read the test WABA's current subscribed apps with Meta's official
   GET /{test-waba-id}/subscribed_apps. Read only; redact token/identifiers.
2. Read the TEST phone's current callback configuration with
   GET /{test-phone-id}?fields=webhook_configuration.
3. Verify that both refer exclusively to the Meta-generated TEST account,
   and that there is no existing override or other subscriber requiring the
   app's default Replit callback.
4. Confirm the default app-level Replit callback must NOT change.
5. Approve and privately configure the receiving endpoint with a new
   verification token and Meta app secret; do not involve employees.
6. Verify the callback responds to the GET challenge and locally signed
   synthetic POST, then optionally use a test-number-specific callback
   override. If not safe, stop; do not modify any webhook configuration.
7. For an override, read back the effective config for the test number
   without touching the production WABAs or employee phones.
8. Send/receive a TEST message only after a separate authorization. A
   test message is not required to validate the current disabled endpoint.

Meta's documentation supports alternate callback URLs at WABA and phone
level. Overrides REPLACE the selected callback for that scope; they do not
create an independent second copy. Avoid writing subscribed_apps or any
phone-number settings until current state is read and the owner approves
the exact change.

## Privacy / security behavior

- Inert in production or when any required value is invalid/missing.
- Raw request HMAC-SHA256 verified using Meta App Secret and constant-time
  comparison; 64 KiB JSON payload cap.
- Exact allowlist of WABA ID and phone ID before incrementing aggregate
  counters; messages and send statuses use the same Meta field.
- No message text, phone number, WABA ID, customer ID, contact details,
  headers, access token, signature, or raw payload is persisted or logged.
- No forwarding, history sync, staff monitoring, outbound message sends,
  DB writes or Graph API calls.
- A restart resets the volatile counters.
- A successful HMAC + ID match confirms signed callback receipt for
  the test account only, NOT broader Coexistence support.

## Local synthetic tests (no external calls)

    node --import tsx --test server/metaTestWebhook.test.ts

GitHub Actions also runs the synthetic suite. Unit tests must succeed
before staging any source changes. Do not activate flags as part of a
code-only deploy.

## Rollback

Since the receiver defaults to off, leaving its variables unset makes it
return 404 and does not affect the existing Replit callback. If an override
is later created, document the original configuration and verify it before
reverting just that test WABA/phone override. Do NOT delete subscriptions
or reset the app-wide webhook to handle an isolated test issue.
