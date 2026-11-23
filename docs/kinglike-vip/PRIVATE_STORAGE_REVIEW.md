# KINGLIKE VIP — private file storage within the current Neon project

**Updated:** 2026-11-23  
**Status:** CODE IMPLEMENTED ON FEATURE BRANCH, TEST ONLY. Not connected to a real bucket; no production data or configuration changed.

## Confirmed infrastructure (read-only)

- The live Kinglike Luxury Railway web server logs its active database host as
  `ep-young-forest-aq74bptf-pooler.c-8.us-east-1.aws.neon.tech`.
  The existing Neon project's production compute ID is
  `ep-young-forest-aq74bptf`. This confirms the same active database lineage.
- Existing Neon project `Kinglike Luxury`, branch `production`
  (`br-withered-star-aqivljb3`) reports Object Storage enabled,
  `force_path_style=true`, region `us-east-1`.
- At the last read-only inventory, that branch contained **zero buckets**.
  No bucket was created and no storage credentials were generated.
- No additional VIP web server, Railway database, or standalone hosting service
  is required for the chosen in-app architecture. **Zero incremental usage
  charges cannot be guaranteed**; verify Neon project plan and storage quotas.

## Current implementation (in code, feature flags remain OFF)

- `server/vip/vipPrivateReceiptStorage.ts` supports the existing fail-closed
  private GCS provider or the explicitly opted-in `neon-s3` provider.
- `vipNeonS3Storage.ts` implements server-only S3 SigV4 PUT/HEAD/GET/DELETE
  with a strict Neon branch endpoint, unguessable VIP-only object keys,
  bounds on object length, no presigned/public download URLs and no added
  npm dependencies. Existing app's `kayRecordingStorage.ts` provided the
  SigV4 pattern; its file or production behavior was not modified.
- `vipNeonStorageConfig.ts` refuses to activate until all required values
  are present, the hostname is an official Neon branch endpoint, the HTTPS
  region matches, and the private-bucket verification flag is explicitly set.
- Every receipt/photo/statement route retains its separate app-session,
  per-unit, finance and admin authorization checks. A receipt upload still
  NEVER confirms a payment.
- CI exercises a **fake, in-memory S3 endpoint** using deliberately fake
  credentials: upload, length verification, read, delete, oversize and
  traversal denials, disabled gate and the three existing VIP file APIs.
  This does **not** prove live Neon S3 interoperability or privacy.

## Exact server-side configuration names (never commit secret values)

These variables must be defined only in the service's secret environment, after
the owner approves a real private bucket in the existing Neon project:

- `KINGLIKE_VIP_STORAGE_PROVIDER=neon-s3`
- `KINGLIKE_VIP_NEON_BUCKET_PRIVATE_APPROVED=true` — **only after** verifying
  the control-plane bucket `access_level` is `private`; the marker is a
  manual approval gate, not a substitute for technical verification
- `KINGLIKE_VIP_NEON_BUCKET_NAME` — private bucket name, not public Cloudinary
- `KINGLIKE_VIP_NEON_S3_ENDPOINT` — official HTTPS storage endpoint for the
  *same* Neon production branch as the database
- `KINGLIKE_VIP_NEON_S3_REGION` — must match the endpoint's region
- `KINGLIKE_VIP_NEON_S3_ACCESS_KEY_ID` — Neon branch-scoped credential ID
- `KINGLIKE_VIP_NEON_S3_SECRET_ACCESS_KEY` — Neon secret (never in chat,
  GitHub comments, logs or connector arguments)

Provider configuration is OFF unless explicitly selected. Keep
`KINGLIKE_VIP_ENABLED` and `VITE_KINGLIKE_VIP_ENABLED` OFF in production
until the entire integration is accepted.

## Before enabling uploads for real buyers

1. Confirm current Neon plan/storage quotas and expected receipts/photos
   retention costs. Do not assume "free" beyond allowance.
2. Review privacy classifications, required retention period, buyer rights,
   backup/restore policy, malware screening and operational review staffing.
3. Separately approve creation of **one private Neon bucket** in the existing
   project and creation of narrowly scoped `storage:read,storage:write`
   credentials. Existing Neon Object Storage roles are branch-scoped, **not**
   per-client roles.
4. With explicitly authorized synthetic files, test real S3 PUT (including the
   overwrite-prevention conditional header), HEAD size, GET, DELETE, timeout,
   limited reads and malformed file uploads on a non-production Neon branch.
   Verify anonymous object reads return an authorization denial.
5. Verify that the permission checks still deny a different buyer, unrelated
   seller, revoked employee or non-finance reviewer; check audit evidence and
   prove a receipt is pending until separately approved.
6. For the initial release use only one provider/bucket. Switching providers
   after real objects exist requires an explicit migration and verification
   of database object keys; a flag flip alone would strand files.
7. Complete deployment review and obtain the owner's *specific* authorization
   before any production bucket, schema migration or feature-flag enablement.

**Important:** The existing Replit Object Storage helper cannot be reused
unchanged on Railway: it requires a Replit sidecar and returns "unavailable"
outside Replit. Public Cloudinary uploads and ordinary local filesystem
paths are also unsuitable for buyer receipts.

## References

- Neon official Object Storage authentication:
  https://neon.com/docs/storage/authentication
- Neon Object Storage S3 compatibility:
  https://neon.com/docs/storage/s3-compatibility
