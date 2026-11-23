# KINGLIKE VIP — private storage reuse assessment

**Date:** 2026-11-23  
**Status:** READ-ONLY DISCOVERY. No bucket created; no upload, object or
credential generated; no production change.

## What is available in the existing Kinglike Luxury stack

The **existing** Neon project `Kinglike Luxury` (`production` branch) reports
Object Storage **enabled**. A read-only storage inventory returned **zero
buckets** at inspection time. This means a private storage integration may be
possible within the current Neon project, without deploying a separate VIP
Railway service or provisioning a new database.

It does **not** mean uploads are usable today, and does **not** guarantee no
additional resource usage charge.

## Current code and why not to enable uploads yet

- `server/vip/vipPrivateReceiptStorage.ts` currently uses the
  `@google-cloud/storage` server SDK, requires a private GCS bucket with
  uniform bucket-level access plus enforced public-access prevention, and
  deliberately fails closed if not configured.
- The existing public Cloudinary image upload flow is **not** suitable as an
  unmodified replacement for payment transfer receipts or developer-issued
  financial statements.
- Neon Object Storage is S3-compatible, which needs a **separate, reviewed
  server-side adapter**. Do not copy the GCS credentials/config or invent a
  public signed URL as a shortcut.
- Do not migrate receipt blobs to PostgreSQL rows merely to avoid object
  storage; large binary rows increase database backup and operational risk.

## Proposed option — without another standalone application

1. Verify storage quotas and potential usage charges under the account's
   existing Neon subscription (no claim of guaranteed zero additional cost).
2. Review current Neon S3-compatible storage security and object retention,
   and decide a private bucket name and per-object server-side key policy.
3. Obtain separate owner approval before creating **one private bucket** in
   the existing Neon project. Never create a public-read bucket.
4. Implement a server-only storage adapter with the SAME private interface
   (`savePrivateReceipt`, `readPrivateReceipt`, `removePrivateReceipt`,
   `savePrivateProjectPhoto`, etc.), robust content/size validation,
   private ACLs, and no browser-visible object keys.
5. Test with fake PDFs/images and dedicated accounts, including 401/403/404
   cross-user access denial, duplicate/replay prevention, failures, auditing,
   backups, malware screening and deletion/retention policy.
6. Only switch the storage adapter after isolated tests pass and the owner
   authorizes the specific configuration. No real client uploads until then.

**Do not:** create a new Railway VIP service, expose receipt URLs, place
provider credentials in chat/GitHub, use production documents for tests, or
enable real receipt uploads before private bucket verification.
