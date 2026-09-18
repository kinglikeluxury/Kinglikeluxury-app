---
name: Kay WebRTC endpoint binding
description: Durable routing and cleanup rule for Kay browser-to-browser calls with multiple tabs or same-user calls.
---

Bind the initiating and answering endpoints of each Kay WebRTC call to exact authenticated WebSocket connections. Authorize, route, and end the call using those connection identities rather than user IDs alone.

**Why:** One user may have multiple tabs, and the admin may call a second session of the same account. User-level routing can echo offers or answers to the wrong tab, while user-level disconnect cleanup can leave a call active after the actual WebRTC endpoint closes.

**How to apply:** Revalidate the session and role for every signal and outgoing delivery. Route target responses only to the bound initiator, exclude the initiator from same-user target delivery, bind the answering socket, and atomically end the call when either bound endpoint disconnects.