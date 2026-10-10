---
name: Employee WhatsApp boundary
description: Architectural boundary between the Employee WhatsApp workspace and the existing Admin mock monitoring page.
---

The Employee WhatsApp workspace must use its own shared presentation layer and the employee-only GET endpoints; it must not import the Admin page or the Admin Local Mock Repository transitively.

**Why:** An initial wrapper around the Admin page made the Employee route depend on Admin data code even when its runtime source was the employee API, weakening the RBAC/data-source boundary.

**How to apply:** Keep `workspaceMode` explicit, pass Employee data into presentation components, and treat Admin’s Local Mock Repository as an Admin-only source until a separate migration is approved.