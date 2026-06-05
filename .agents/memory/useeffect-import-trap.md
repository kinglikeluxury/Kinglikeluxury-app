---
name: useEffect import white-screen trap
description: Adding useEffect calls to a file that only imported useState causes ReferenceError → white screen with no useful console message.
---

When a React component file only imports `useState` from "react" and a new `useEffect` auth guard is added, the missing import produces an immediate `ReferenceError: useEffect is not defined`. This crashes the component before any render or API call — the result is a completely blank page, no loading spinner, no error boundary message, and no network requests in the server logs (which is what makes it hard to diagnose).

**Why:** Vite's JSX transform does not auto-inject hook names — only the JSX pragma is auto-handled. Any hook must still be explicitly imported.

**How to apply:** Whenever adding a `useEffect` (or any new hook) to a file, always check the React import line first and add the hook name if it's missing. This is especially easy to miss when the fix is applied across multiple files where some already have the import and others don't.
