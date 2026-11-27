const destinations = {
  buyer: new Set(["/vip"]),
  seller: new Set(["/vip", "/vip/sales"]),
  admin: new Set(["/vip", "/vip/sales", "/admin/vip"]),
};

function roleKind(user) {
  if (user?.isAdmin === true || user?.role === "admin") return "admin";
  if (["seller", "sales", "sales_agent", "sub_agent"].includes(user?.role)) {
    return "seller";
  }
  return "buyer";
}

const defaultDestination = {
  buyer: "/vip",
  seller: "/vip/sales",
  admin: "/admin/vip",
};

/**
 * QA-build-only post-login routing. Exact path allowlisting prevents protocol,
 * host, path traversal, and arbitrary-route redirects.
 */
export function resolveQaLoginDestination(search, user) {
  const kind = roleKind(user);
  if (typeof search === "string") {
    try {
      const requested = new URLSearchParams(search).get("redirect");
      if (destinations[kind].has(requested)) return requested;
    } catch {
      // Invalid query input falls back to the role's private VIP landing page.
    }
  }
  return defaultDestination[kind];
}
