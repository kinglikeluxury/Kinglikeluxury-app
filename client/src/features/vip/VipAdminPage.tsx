import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { Building2, Crown, FileClock, Receipt, ShieldCheck, Users } from "lucide-react";
import { getVipCopy } from "./vipCopy";
import VipStatementRequestsAdmin from "./VipStatementRequestsAdmin";
import VipProjectsAdmin from "./VipProjectsAdmin";
import VipInviteAdmin from "./VipInviteAdmin";
import VipCardsAdmin from "./VipCardsAdmin";
import VipReferralsAdmin from "./VipReferralsAdmin";
import VipSellerAssignmentAdmin from "./VipSellerAssignmentAdmin";
import VipExperienceAdmin from "./VipExperienceAdmin";
import VipFinanceAdmin from "./VipFinanceAdmin";
import VipOperationsAdmin from "./VipOperationsAdmin";
import VipSupportAdmin from "./VipSupportAdmin";
import VipAdvancedFinanceAdmin from "./VipAdvancedFinanceAdmin";

type Overview = { projects: number; units: number; clients: number; pending_receipts: number; statement_requests: number };
export default function VipAdminPage() {
  const { user, isLoading } = useAuth();
  const { i18n } = useTranslation();
  const t = getVipCopy(i18n.language);
  const rtl = /^(ar|he)(-|$)/i.test(i18n.language);
  const result = useQuery<{overview: Overview}>({
    queryKey: ["vip", "admin", "overview"],
    queryFn: async () => {
      const response = await fetch("/api/admin/vip/overview", { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("vip-admin-unavailable");
      return response.json();
    },
    enabled: !!user?.isAdmin && !isLoading,
    retry: false,
  });
  const metrics = [
    { key: "projects", Icon: Building2, val: result.data?.overview.projects },
    { key: "units", Icon: Building2, val: result.data?.overview.units },
    { key: "clients", Icon: Users, val: result.data?.overview.clients },
    { key: "pending", Icon: Receipt, val: result.data?.overview.pending_receipts },
    { key: "requests", Icon: FileClock, val: result.data?.overview.statement_requests },
  ] as const;
  return (
    <div dir={rtl?"rtl":"ltr"} className="min-h-[80vh] bg-[#f4f8f8] text-[#083e56]">
      <header className="bg-[#005476] px-5 py-9 text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3"><Crown className="h-9 w-9 text-[#3BCAC4]"/><h1 className="text-2xl font-bold">{t.admin}</h1></div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-8">
        {isLoading ? <p>{t.loading}</p> : !user ? (
          <Link href="/login" className="rounded-lg bg-[#005476] px-5 py-3 text-white">{t.loginButton}</Link>
        ) : !user.isAdmin ? (
          <div className="rounded-2xl bg-white p-8"><ShieldCheck className="mb-3 h-7 w-7"/>{t.restricted}</div>
        ) : result.isError ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">{t.unavailable}</div>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3 rounded-xl bg-white p-4 text-sm text-[#557989]"><ShieldCheck className="h-5 w-5 text-[#20aaa9]"/>{t.privacy}</div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {metrics.map(({key,Icon,val}) => (
                <div key={key} className="rounded-2xl border border-[#d4e7e9] bg-white p-6 shadow-sm">
                  <Icon className="h-7 w-7 text-[#008c93]"/><p className="mt-3 text-xs text-[#537b89]">{t[key]}</p>
                  <p className="mt-2 text-3xl font-semibold">{val ?? "—"}</p>
                </div>
              ))}
            </div>
            <VipOperationsAdmin />
            <VipSupportAdmin />
            <VipProjectsAdmin />
            <VipInviteAdmin />
            <VipSellerAssignmentAdmin />
            <VipExperienceAdmin />
            <VipFinanceAdmin />
            <VipAdvancedFinanceAdmin />
            <VipStatementRequestsAdmin />
            <VipCardsAdmin />
            <VipReferralsAdmin />
            <p className="mt-7 text-sm text-[#557989]">{t.soon}</p>
          </>
        )}
      </div>
    </div>
  );
}
