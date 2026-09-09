---
name: Kay settings test isolation
description: Integration tests that exercise Rescue settings must restore the complete prior JSON value.
---

Any integration test that replaces Kay `mode` or `rescue_rules` must restore the complete prior value byte-for-byte in its final cleanup, not merely force selected safety flags back to disabled.

**Why:** A test fixture once restored kill-switch and enablement flags but left its synthetic `50/50` limits behind, silently overriding the approved production `5/3` safety limits after a successful audited correction.

**How to apply:** Capture the full setting before tests, restore it in `finally`, and verify the relevant values after the suite. Run production setting corrections only after all setting-mutating integration tests have completed.