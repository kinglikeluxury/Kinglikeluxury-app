import path from "node:path";

const sourceReplacements = [
  [
    'const [location, navigate] = useLocation();',
    'const [, navigate] = useLocation();',
  ],
  [
    'const redirectTo = new URLSearchParams(location.split("?")[1] || "").get("redirect") || "/";',
    "",
  ],
  [
    "await login(data.username, data.password);",
    "const authenticatedUser = await login(data.username, data.password);",
  ],
  [
    "navigate(redirectTo);",
    "navigate(resolveQaLoginDestination(window.location.search, authenticatedUser));",
  ],
];

export function transformQaLoginSource(code, id, loginSource) {
  const sourcePath = id.split("?")[0];
  if (path.resolve(sourcePath) !== path.resolve(loginSource)) return null;

  let transformed = code;
  for (const [before, after] of sourceReplacements) {
    const occurrences = transformed.split(before).length - 1;
    if (occurrences !== 1) {
      throw new Error("VIP QA login source changed; refusing an unverified redirect transform");
    }
    transformed = transformed.replace(before, after);
  }

  return {
    code:
      'import { resolveQaLoginDestination } from "../../../server/vip/qaLoginRedirect.mjs";\n' +
      transformed,
    map: null,
  };
}
