import assert from "node:assert/strict";
import {test} from "node:test";
import {resolveQaLoginDestination} from "./qaLoginRedirect.mjs";

test("QA login preserves each role's intended VIP destination", () => {
  assert.equal(resolveQaLoginDestination("?redirect=%2Fvip", {role:"user"}), "/vip");
  assert.equal(
    resolveQaLoginDestination("?redirect=%2Fvip%2Fsales", {role:"sub_agent"}),
    "/vip/sales",
  );
  assert.equal(
    resolveQaLoginDestination("?redirect=%2Fadmin%2Fvip", {isAdmin:true,role:"admin"}),
    "/admin/vip",
  );
});

test("QA login uses role-specific defaults when no destination is supplied", () => {
  assert.equal(resolveQaLoginDestination("", {role:"user"}), "/vip");
  assert.equal(resolveQaLoginDestination("", {role:"sales_agent"}), "/vip/sales");
  assert.equal(resolveQaLoginDestination("", {isAdmin:true}), "/admin/vip");
});

test("QA login refuses destinations outside the role's VIP routes", () => {
  assert.equal(
    resolveQaLoginDestination("?redirect=%2Fadmin%2Fvip", {role:"user"}),
    "/vip",
  );
  assert.equal(
    resolveQaLoginDestination("?redirect=%2Fadmin%2Fvip", {role:"sub_agent"}),
    "/vip/sales",
  );
});

test("QA login rejects external, protocol-relative, traversal, and arbitrary redirects", () => {
  const unsafe = [
    "https://evil.example/",
    "//evil.example/",
    "/vip/../admin",
    "/admin",
    "/vip?next=https%3A%2F%2Fevil.example",
  ];
  for (const value of unsafe) {
    assert.equal(
      resolveQaLoginDestination(`?redirect=${encodeURIComponent(value)}`, {isAdmin:true}),
      "/admin/vip",
    );
  }
});
