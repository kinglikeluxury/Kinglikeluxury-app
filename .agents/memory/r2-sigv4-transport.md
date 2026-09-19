---
name: R2 SigV4 transport
description: Cloudflare R2 signing and Node transport constraints for private object operations.
---

Cloudflare R2 SigV4 Authorization must use `AWS4-HMAC-SHA256 Credential=...` with no comma after the algorithm name. Object requests also need a zero content length for empty HEAD/DELETE calls; the built-in Node fetch transport is reliable here.

**Why:** A visually plausible Authorization header and an `https.request` call produced misleading 400 responses, while the corrected header and fetch transport passed real PUT, HEAD, and DELETE checks.

**How to apply:** Keep canonical object paths slash-preserving, use the exact signed headers, use fetch for S3-compatible storage requests, and validate with one disposable synthetic object when changing the signer.