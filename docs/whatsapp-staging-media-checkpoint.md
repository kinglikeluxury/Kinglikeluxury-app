# Employee WhatsApp archive — media metadata checkpoint (Staging development)

This checkpoint extends the **existing Kinglike application**, not a separate mock UI.

## Implemented in this branch
- The signed WhatsApp webhook's existing normalization supports `audio` and `sticker`
  events in addition to text/image/video/document, for inbound messages and
  eligible Coexistence echoes.
- Extract only allowlisted metadata: MIME type, nonnegative safe-integer media
  byte count (when present), and normalized SHA-256 digest (hex or canonical
  32-byte base64). Never return or persist untrusted media IDs, media URLs,
  filenames, access tokens, or raw webhook payload through these new fields.
- Persist only this metadata in the existing optional media columns of the
  **manual, unapplied** employee archive schema; expose only those safe columns
  via the existing consent/scope/audit-gated archive read route.
- Synthetic test coverage for voice, sticker, tampered metadata, unsafe URL
  exclusion, malformed signatures and Coexistence identity checks. CI sets all
  live Meta / monitoring flags to false.

## Explicitly NOT implemented or enabled
- No bytes, media downloads, private storage, audio playback, image/video files
  or media streaming; this is **metadata-only**.
- No history-sync parser, contact sync, 24-hour one-time sync scheduling,
  retention/disclosure review, employee consent completion, audited media reads,
  Meta real-number verification, message sending or live archive.
- The existing runtime for the employee archive remains test-only and closed to
  normal Staging/Production processes. The Staging proof database is **not**
  equivalent to a deployed conversation/media archive schema.
- No schema migration has been run. No Railway configuration or Meta settings
  have been modified. No Samer/Fadi/Joanna numbers have been connected.

## Next dependencies before a real one-number pilot
1. Review employee notice/consent, customer notice/lawful basis and privacy
   retention/deletion policy, including export auditing and supervisory scope.
2. Design a separate least-privilege encrypted object store for media and a
   gated server-side retrieval pipeline (verify Meta identity, authorize before
   download, strict max size/type, verify digest, scan, short-lived authorized
   access). Never proxy provider URLs directly to browser clients.
3. Implement and test Coexistence history webhook import and one-time sync
   readiness **before** connecting a real number; confirm availability and
   timing in official Meta materials at pilot time.
4. Integrate the archive with explicitly scoped Staging DB roles, audited
   RBAC and the UI; run synthetic end-to-end proof with no live Meta access.
5. Obtain separate written approval for Samer's real number pilot after
   verifying per-number Coexistence eligibility. Keep all real flags disabled
   until an audited readiness check succeeds.

This branch is an incremental, non-deployable building block; it does not claim
that historical audio/video assets or current messages can already be read.
