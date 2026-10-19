---
name: Neon production permission changes
description: Safe target verification when a production app database URL is not usable for administrative SQL.
---

When an application database connection is healthy but its configured administrative or owner credentials fail, do not broaden application-role privileges or guess the target through another connection. Verify the runtime database and Neon project/primary branch first, then use the Neon integration only for the explicitly authorized, narrowly scoped SQL. Recheck effective privileges through the application’s dedicated runtime role afterward.

**Why:** Application connection URLs and owner credentials can be stale or independently misconfigured; a correct credential is not proof that a guessed project or branch is the live target.

**How to apply:** For a production permission change, match the running application’s database identity and Neon host/region to the exact project, branch, and database before issuing any SQL. Confirm the resulting grants through the intended runtime connection without testing writes against customer data.
