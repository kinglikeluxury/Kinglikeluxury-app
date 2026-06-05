---
name: package-lock.json Replit firewall URLs
description: package-lock.json may contain Replit-internal proxy URLs that block deployment on Railway or other external platforms.
---

## Rule
Check `package-lock.json` for `http://package-firewall.replit.local/npm/` URLs before deploying to Railway or any external platform. Replace them with `https://registry.npmjs.org/`.

**Why:** Replit routes npm installs through an internal caching proxy. This URL is baked into `resolved` fields in package-lock.json. External platforms (Railway, Heroku, etc.) cannot reach `package-firewall.replit.local`, causing `npm ci` to fail with ENOTFOUND.

**How to apply:**
```bash
grep -c "package-firewall.replit.local" package-lock.json  # count affected lines
sed -i 's|http://package-firewall.replit.local/npm/|https://registry.npmjs.org/|g' package-lock.json
grep -c "package-firewall.replit.local" package-lock.json  # verify 0 remaining
```

**Safety:** The `integrity` (sha512) hashes in package-lock.json are computed from package content (the tarball bytes), not the URL. Since Replit's proxy is a transparent mirror of the npm registry, integrity hashes remain valid after URL replacement.
