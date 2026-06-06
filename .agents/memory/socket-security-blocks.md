---
name: Replit Socket Security blocked packages
description: Packages blocked by Replit's package-firewall (Socket Security Policy) and their fixes
---

# Replit Socket Security — blocked packages history

Replit's publishing build container runs npm install through a Socket Security
Policy proxy (`package-firewall.replit.local`). Blocked packages return E403
"Access denied: blocked by Socket Security Policy" during `npm install`.

**Why:** Replit uses socket.dev risk scoring to block high-risk packages
(postinstall network access, protestware, supply chain concerns) in the
production build container. The dev environment may be less strict.

**How to apply:** When a deployment fails with E403 during npm install,
check the build container's npm debug log for the blocked package name.
Then check if it has `hasInstallScript: true` in the lockfile, or is on
a known blocked-version list. Fix with an `overrides` pin to a safe
version, or remove the package if unused.

## Known blocks (in order encountered)

### 1. es5-ext@0.10.64
- **Reason:** Has `hasInstallScript: true`; `_postinstall.js` checks timezone
  for Russian locales and displays political protest messaging ("protestware")
- **Chain:** memoizee → es5-ext (all versions >= 0.10.63 have the script;
  no newer safe version exists on npm as of 2026-06)
- **Fix:** Removed `memoizee` from dependencies entirely (it was unused in code)

### 2. fast-xml-parser (multiple 4.x versions blocked)
- **Reason:** Unknown; no install script; likely blanket flag on specific 4.x versions
- **Chain:** @google-cloud/storage → fast-xml-parser
- **Block history:**
  - 4.5.3: blocked (first discovered)
  - 4.4.1: blocked (second discovered — was previous override target)
  - 4.3.6: current pin (may need updating if this is also blocked)
- **Fix:** Use npm `overrides` to pin to a non-blocked version:
  `"overrides": { "fast-xml-parser": "4.3.6" }` in package.json
- **Note:** 4.3.6 is API-compatible with 4.4.x for @google-cloud/storage usage
  (4.4.0 was a security hardening of attribute injection, not an API change)
- **Fallback if 4.3.x also blocked:** Remove @google-cloud/storage from deps
  and rewrite server/objectStorage.ts and server/objectAcl.ts to avoid the
  package (the /objects/* route is legacy; all uploads use Cloudinary)

## Diagnostic approach

1. Check the npm debug log from the failed build for the exact blocked package
2. Run: `node -e "const l=require('./package-lock.json'); for(const [n,i] of Object.entries(l.packages||{})){if(!n||i.dev||i.optional)continue; if(i.hasInstallScript)console.log(n,i.version);}"`
3. Check non-script packages with: find which package is cited in the E403 error
4. Use `npm view <pkg>@<ver> dist.integrity` to get correct lockfile hash after pinning
