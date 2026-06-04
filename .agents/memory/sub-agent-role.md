---
name: Sub-Agent Role
description: CRM-only user role — access model, bcrypt login compatibility, helper pattern
---

## Rule
Role `"sub_agent"` gives CRM-only access — user can only read/write leads assigned to them. They cannot delete leads, change lead status/assignedTo, create new leads, or access any admin page other than `/admin/crm`.

**Why:** Platform has a sales team that should see their pipeline but not manage the whole system.

## How to apply

### Authentication
Login (`/api/auth/login`) checks password with bcrypt if stored hash starts with `$2b$` or `$2a$`, otherwise falls back to plain-text equality. This is backward-compat for legacy accounts.

New sub-agent accounts are created via `POST /api/admin/crm/sub-agents` (admin only) — password is bcrypt-hashed at creation (cost 10).

`req.session.role` is set at login/register alongside `req.session.isAdmin`.
`/api/auth/me` returns `role` in its JSON response.

### Backend guards (routes.ts)
```typescript
const isCrmUser = (req) => req.session.isAdmin || req.session.role === "sub_agent";
const canAccessLead = async (req, leadId) => {
  if (req.session.isAdmin) return true;
  const lead = await storage.getCrmLead(leadId);
  return lead?.assignedTo === req.session.userId;
};
```
- All CRM routes use `isCrmUser(req)` as outer guard (403 if false)
- Lead-specific routes (GET detail, PATCH, POST notes, all task routes) also call `canAccessLead`
- PATCH lead: if `!req.session.isAdmin`, delete `status` and `assignedTo` from `req.body`
- GET leads list: if sub_agent, force `filters.assignedTo = req.session.userId` regardless of query param

### Frontend
- `user.role === "sub_agent"` — checked in Navbar and MobileDrawer to show "Kinglike CRM" link
- CRM leads page hides: New Lead button, Projects button, Assigned To filter
- CRM leads page forces `assignedTo = user.id` in query params (backend also enforces)
- CRM lead detail page hides the Delete button

### Sub-agent management
- `GET /api/admin/crm/sub-agents` — list (admin only)
- `POST /api/admin/crm/sub-agents` — create (admin only, bcrypt hash)
- Admin sees "Sub-Agents" button in CRM header → dialog to view list + create new
