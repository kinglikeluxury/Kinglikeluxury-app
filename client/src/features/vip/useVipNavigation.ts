import { useQuery } from "@tanstack/react-query";
import type { User } from "@/lib/auth";

// Navigation is presentation only. Every VIP API still independently checks
// the active signed-in user and the current per-unit access grant.
export const VIP_NAV_ENABLED = import.meta.env.VITE_KINGLIKE_VIP_ENABLED === "true";
const SELLER_ROLES = new Set(["sub_agent", "crm_employee", "sales_agent", "employee", "agent"]);

type VipUnitList = { units: Array<unknown> };

async function loadVisibleUnits(path: string): Promise<VipUnitList> {
  const response = await fetch(path, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("VIP navigation not available");
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null ||
      !("units" in value) || !Array.isArray(value.units)) {
    throw new Error("Invalid VIP navigation data");
  }
  return { units: value.units };
}

/**
 * Only display links for verified owners/sellers the server currently knows.
 * When VIP flags are OFF, queries are never sent and menus remain unchanged.
 * An admin shortcut is shown only for the current application's admin user.
 */
export function useVipNavigation(user: User | null) {
  const currentId = user?.id ?? null;
  const owner = useQuery({
    queryKey: ["vip", "nav", "owner", currentId],
    queryFn: () => loadVisibleUnits("/api/vip/me"),
    enabled: VIP_NAV_ENABLED && currentId !== null && !user?.isAdmin,
    staleTime: 30_000,
    retry: false,
  });
  const seller = useQuery({
    queryKey: ["vip", "nav", "seller", currentId],
    queryFn: () => loadVisibleUnits("/api/vip/seller/units"),
    enabled: VIP_NAV_ENABLED && currentId !== null && SELLER_ROLES.has(user?.role ?? ""),
    staleTime: 30_000,
    retry: false,
  });
  const admin = useQuery({
    queryKey: ["vip", "nav", "admin", currentId],
    queryFn: async () => {
      const response = await fetch("/api/admin/vip/overview", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("VIP admin authorization unavailable");
      const value: unknown = await response.json();
      return typeof value === "object" && value !== null &&
        "overview" in value && typeof value.overview === "object" &&
        value.overview !== null;
    },
    enabled: VIP_NAV_ENABLED && currentId !== null && user?.isAdmin === true,
    staleTime: 30_000,
    retry: false,
  });
  const financeReview = useQuery({
    queryKey: ["vip", "finance-review", "me", currentId],
    queryFn: async () => {
      const response = await fetch("/api/admin/vip/finance/me", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("VIP finance permission unavailable");
      const value: unknown = await response.json();
      return typeof value === "object" && value !== null &&
        "canApprove" in value && value.canApprove === true;
    },
    enabled: VIP_NAV_ENABLED && currentId !== null,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: false,
  });

  return {
    showOwner: VIP_NAV_ENABLED && !!user && (owner.data?.units.length ?? 0) > 0,
    showSeller: VIP_NAV_ENABLED && !!user && (seller.data?.units.length ?? 0) > 0,
    showAdmin: VIP_NAV_ENABLED && admin.data === true,
    showFinanceReview: VIP_NAV_ENABLED && !!user && financeReview.data === true && !financeReview.isFetching,
  };
}
