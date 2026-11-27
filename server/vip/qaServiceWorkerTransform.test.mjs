import assert from "node:assert/strict";
import {test} from "node:test";
import {transformQaEntryWithoutServiceWorker} from "./qaServiceWorkerTransform.mjs";

const mainSource="/fixture/client/src/main.tsx";
const mainCode=[
  'import { createRoot } from "react-dom/client";',
  "createRoot(document.getElementById('root')).render(<App />);",
  "// Register service worker for push notifications and PWA caching.",
  "// Runs after the app mounts so it never blocks first render.",
  "// Any failure is logged and silently ignored — it does not affect the app.",
  'if ("serviceWorker" in navigator) {',
  '  window.addEventListener("load", () => {',
  '    navigator.serviceWorker',
  '      .register("/sw.js")',
  '      .then((reg) => { console.log("[SW] Registered — scope:", reg.scope); })',
  '      .catch((err) => { console.error("[SW] Registration failed:", err); });',
  "  });",
  "}",
].join("\n");

test("local VIP QA build removes only the service-worker registration block",()=>{
  const output=transformQaEntryWithoutServiceWorker(mainCode,mainSource,mainSource);
  assert.ok(output);
  assert.doesNotMatch(output.code,/serviceWorker\.register|register\("\/sw\.js"\)/);
  assert.match(output.code,/Service workers are intentionally disabled/);
  assert.match(output.code,/createRoot/);
});

test("service-worker transform does not touch other application modules",()=>{
  assert.equal(
    transformQaEntryWithoutServiceWorker(mainCode,"/fixture/client/src/App.tsx",mainSource),
    null,
  );
});

test("service-worker transform fails closed when source changes unexpectedly",()=>{
  assert.throws(
    ()=>transformQaEntryWithoutServiceWorker(mainCode.replace('register("/sw.js")','register("/other.js")'),mainSource,mainSource),
    /refusing an unverified service-worker transform/,
  );
});
