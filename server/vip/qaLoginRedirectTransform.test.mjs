import assert from "node:assert/strict";
import {test} from "node:test";
import {transformQaLoginSource} from "./qaLoginRedirectTransform.mjs";

const loginSource="/fixture/client/src/pages/login.tsx";
const source=[
  'import { useLocation } from "wouter";',
  "const Login = () => {",
  "  const { login } = useAuth();",
  "  const [location, navigate] = useLocation();",
  '  const redirectTo = new URLSearchParams(location.split("?")[1] || "").get("redirect") || "/";',
  "  const onSubmit = async (data) => {",
  "    await login(data.username, data.password);",
  "    navigate(redirectTo);",
  "  };",
  "};",
].join("\n");

test("QA build transform reads the actual query and authenticated role",()=>{
  const transformed=transformQaLoginSource(source,loginSource,loginSource);
  assert.ok(transformed);
  assert.match(transformed.code,/resolveQaLoginDestination\(window\.location\.search, authenticatedUser\)/);
  assert.match(transformed.code,/const authenticatedUser = await login/);
  assert.doesNotMatch(transformed.code,/location\.split\("\?"\)/);
  assert.match(transformed.code,/server\/vip\/qaLoginRedirect\.mjs/);
});

test("QA build transform never touches other login or application files",()=>{
  assert.equal(transformQaLoginSource(source,"/fixture/client/src/pages/register.tsx",loginSource),null);
  assert.equal(transformQaLoginSource(source,loginSource+"?v=1",loginSource).code.includes(
    "resolveQaLoginDestination(window.location.search, authenticatedUser)",
  ),true);
});

test("QA build transform fails closed if the expected login source drifts",()=>{
  assert.throws(
    ()=>transformQaLoginSource(source.replace("navigate(redirectTo);","navigate('/');"),loginSource,loginSource),
    /refusing an unverified redirect transform/,
  );
});
