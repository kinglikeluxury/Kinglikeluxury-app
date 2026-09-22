---
name: Visual QA splash timing
description: Timing constraint for trustworthy Playwright screenshots of this app
---

Visual QA screenshots must wait until the application splash has completed; route content can already be mounted in the DOM while the full-screen splash still hides it.

**Why:** The splash intentionally calls its completion callback after 3.4 seconds, so early screenshots show only the centered logo even though selectors and body text indicate the target route is ready.

**How to apply:** In temporary browser QA harnesses, wait at least 3.4 seconds or explicitly wait for the splash wrapper to disappear before capturing or judging visual states. Do not bypass the splash in application code.