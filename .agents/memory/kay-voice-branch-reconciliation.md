---
name: Kay voice branch reconciliation
description: Safe procedure when the remote Kay voice branch advances beyond the local V2 commit.
---

When the remote voice branch has advanced, integrate the local V2 commit on top of the fetched remote head in a temporary isolated worktree, then push that new head as a fast-forward only.

**Why:** a direct push can be rejected as non-fast-forward, and force-pushing could remove remote private-reference support or other committed voice-worker behavior.

**How to apply:** keep `main` checked out and untouched; fetch only the voice branch; resolve conflicts only within the voice-service scope; run only targeted voice tests; use temporary Basic HTTPS askpass credentials; verify the remote SHA and Action run before removing the temporary worktree.