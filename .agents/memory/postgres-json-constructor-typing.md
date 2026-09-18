---
name: PostgreSQL JSON constructor typing
description: Prevent ambiguous parameter failures when bound values are passed to polymorphic JSON construction functions.
---

Bound values passed to polymorphic PostgreSQL functions such as `jsonb_build_object` must carry explicit SQL casts matching the persisted schema.

**Why:** PostgreSQL cannot always infer an untyped placeholder used only as a variadic JSON-builder argument, producing `42P18` even though the JavaScript value is a string. Timestamp-like lease values also need deterministic `timestamptz` typing.

**How to apply:** Cast tokens and identifiers to `text`, cast lease timestamps to `timestamptz`, and validate stored timestamp text before casting malformed historical JSON.