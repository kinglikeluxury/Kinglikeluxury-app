---
name: Meta sync startup side effect
description: Existing Meta lead pull-sync behavior triggered by restarting the main application workflow.
---

Restarting the main application can immediately trigger the existing Meta lead pull-sync job and its periodic lookups, even if the lead queue processor is disabled. For tasks that prohibit Meta API access, account for this before restarting; do not disable or alter the production sync outside the approved scope. If a restart triggers it and the user asks to stop the app, stop the workflow and report what happened.

**Why:** Restarting the app during an isolated Meta review change started the existing page-account lookup and scheduled pull sync, despite no new review-demo Meta request being made.

**How to apply:** Check the existing sync side effects before workflow restarts on Meta-isolated tasks, and distinguish startup-triggered production sync from calls made by new feature code.
