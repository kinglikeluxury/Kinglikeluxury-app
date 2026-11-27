import path from "node:path";

const registrationBlock =
  /\/\/ Register service worker for push notifications and PWA caching\.\r?\n\/\/ Runs after the app mounts so it never blocks first render\.\r?\n\/\/ Any failure is logged and silently ignored — it does not affect the app\.\r?\nif \("serviceWorker" in navigator\) \{\r?\n[\s\S]*?\r?\n\}/g;

export function transformQaEntryWithoutServiceWorker(code, id, mainSource) {
  if (path.resolve(id.split("?")[0]) !== path.resolve(mainSource)) return null;
  const matches = [...code.matchAll(registrationBlock)];
  if (matches.length !== 1 ||
      !matches[0][0].includes('.register("/sw.js")') ||
      (matches[0][0].match(/\.register\(/g)||[]).length!==1) {
    throw new Error("VIP QA main entry changed; refusing an unverified service-worker transform");
  }
  return {
    code: code.replace(
      registrationBlock,
      "// Service workers are intentionally disabled in the local VIP QA build.",
    ),
    map: null,
  };
}
