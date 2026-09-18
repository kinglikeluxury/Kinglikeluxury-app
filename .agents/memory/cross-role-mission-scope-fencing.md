---
name: Cross-role mission scope fencing
description: Atomic ownership validation when the read-only CRM role and Kay-only writer role cannot share table privileges.
---

Kay mission mutations that depend on current CRM ownership must call a narrowly granted `SECURITY DEFINER` predicate that locks the lead and employee policy rows for the full writer transaction.

**Why:** A read-only scope check on a separate connection can race with reassignment. Granting the Kay writer direct CRM reads would weaken privilege separation, while an advisory lock cannot protect normal CRM writes unless every CRM path adopts it.

**How to apply:** Keep the definer function read-only, fix its search path, revoke public access, grant only `EXECUTE` to the internal writer, acquire `FOR SHARE` row locks, and fail closed before any mission create, notification claim, or transition.