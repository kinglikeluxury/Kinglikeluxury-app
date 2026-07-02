---
name: Neon serverless pool concurrent connect() race
description: Adding another top-level concurrent pool.connect() chain at startup can trigger an uncaught "double release" crash from the Neon serverless driver.
---

# Neon serverless pool concurrent connect() race

At server startup, many `ensureXTables()` bootstrap functions are fired as
independent floating promise chains (`fn().then(...).catch(...)`), each
calling `pool.connect()` from `@neondatabase/serverless`. With enough
concurrent connections in flight, the driver intermittently throws
`Error: Release called on client which has already been released to the pool.`
This can surface as an **uncaught exception that bypasses `.catch()`** on the
chain that "caused" it (it comes from the driver's internal event handling,
not the awaited call path), which trips the process's global
`uncaughtException` handler and crashes the whole server — even though the
individual table-bootstrap logic itself has no bug.

**Why:** `@neondatabase/serverless`'s websocket-based `Pool` has a known race
under high concurrent `connect()`/`release()` traffic; it is timing-dependent
and reproduces more often as more concurrent chains are added at once.

**How to apply:** When adding a new `ensureXTables()` bootstrap call to
`server/index.ts`, prefer chaining it sequentially onto an existing
`.then()` chain (e.g. after `ensureKqsTables()`) rather than starting a new
independent top-level floating promise. This reduces the number of
concurrent `pool.connect()` calls in flight at boot and avoids tipping the
driver into the race. This issue is pre-existing and can still surface
sporadically from other unrelated chains (observed once from
`ensureAiMarketingRevenueTables` after being caught by its own `.catch()`,
so it didn't crash that time) — it's an existing flakiness in the stack, not
something to "fix" by touching unrelated table bootstraps.
