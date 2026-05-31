---
name: AI Backup Versioning Rule
description: Golden backup lock and versioning convention for the AI Advisor configuration
---

# AI Backup Versioning Rule

**Rule:** `docs/ai-backup/AI-CONFIG-BACKUP.md` is permanently locked. Never modify, overwrite, or regenerate it.

**Why:** The user designated this file as the "golden backup" of the AI Advisor as it existed on 2026-05-31. It is the restoration baseline if `server/aiAdvisor.ts` is ever broken or changed in error.

**How to apply:**
- When the user asks to update, improve, or change AI instructions → create a new versioned file: `docs/ai-backup/AI-CONFIG-v2.md`, then `AI-CONFIG-v3.md`, etc.
- Never touch `AI-CONFIG-BACKUP.md` for any reason, including "re-syncing" it with a newer prompt.
- If asked to "update the backup", clarify that a new version file must be created instead.
