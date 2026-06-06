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
Then check if the package (or one of its transitive deps) has
`hasInstallScript: true` in the lockfile. Fix with an `overrides` pin to a
safe version, or remove the package if unused.

## Known blocks (in order encountered)

### 1. fast-xml-parser@4.5.3
- **Reason:** Socket Security flags this version
- **Fix:** Added `overrides: { "fast-xml-parser": "4.4.1" }` in package.json

### 2. es5-ext@0.10.64
- **Reason:** Has `hasInstallScript: true`; `_postinstall.js` checks timezone
  for Russian locales and displays political protest messaging
- **Chain:** memoizee → es5-ext (all versions >= 0.10.63 have the script)
- **Fix:** Removed `memoizee` from dependencies entirely (it was unused in code)
- **Note:** No clean es5-ext version exists beyond 0.10.64 on npm as of 2026-06

## Diagnostic approach

1. Check `/home/runner/.npm/_logs/` for the npm debug log from the failed build
2. Search for "E403", "blocked", "Socket Security" in those logs
3. Run: `node -e "const lock=require('./package-lock.json'); const pkgs=lock.packages||{}; for(const [n,i] of Object.entries(pkgs)){if(!n||i.dev||i.optional)continue; if(i.hasInstallScript)console.log(n,i.version);}"`
4. The non-optional, non-dev packages with hasInstallScript are the candidates
