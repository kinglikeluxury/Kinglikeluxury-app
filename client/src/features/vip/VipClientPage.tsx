import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { Bell, Building2, CalendarCheck, Crown, FileText, Gift, LockKeyhole, Route, Wallet } from "lucide-react";
import { getVipCopy } from "./vipCopy";
import VipStatementRequest from "./VipStatementRequest";
import VipProjectProgress from "./VipProjectProgress";
import VipInstallmentsList from "./VipInstallmentsList";
import VipReceiptHistory from "./VipReceiptHistory";
import VipProjectCamera from "./VipProjectCamera";
import VipProjectPhotos from "./VipProjectPhotos";

type VipUnit = { unit_id: string; unit_number: string; floor_number: number | null; project_name: string; project_id: string; developer_name: string | null; progress_percent: number | null };
type VipMe = { units: VipUnit[] };
const features = [
  { key: "journey", Icon: Route },
  { key: "statement", Icon: Wallet },
  { key: "handover", Icon: CalendarCheck },
  { key: "card", Icon: Crown },
  { key: "alerts", Icon: Bell },
  { key: "rewards", Icon: Gift },
] as const;

export default function VipClientPage() {
  const { user, isLoading } = useAuth();
  const { i18n } = useTranslation();
  const t = getVipCopy(i18n.language);
  const rtl = /^(ar|he)(-|$)/i.test(i18n.language);
  const data = useQuery<VipMe>({
    queryKey: ["vip", "me"],
    queryFn: async () => {
      const response = await fetch("/api/vip/me", { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("vip-not-available");
      return response.json();
    },
    enabled: !!user && !isLoading,
    retry: false,
  });

  return (
    <div dir={rtl ? "rtl" : "ltr"} className="min-h-[75vh] bg-[#f4f8f8] text-[#083e56]">
      <section className="bg-gradient-to-br from-[#003c59] via-[#005476] to-[#027d88] px-5 py-12 text-white">
        <div className="mx-auto max-w-6xl">
          <div className="mb-4 flex items-center gap-3"><Crown className="h-8 w-8 text-[#3BCAC4]" /><span className="text-sm uppercase tracking-[0.24em]">{t.title}</span></div>
          <h1 className="text-3xl font-semibold md:text-4xl">{t.subtitle}</h1>
          <p className="mt-3 text-white/80">{t.intro}</p>
        </div>
      </section>
      <div className="mx-auto max-w-6xl px-4 py-8">
        {isLoading ? <p>{t.loading}</p> : !user ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
            <LockKeyhole className="mx-auto mb-3 h-9 w-9 text-[#008c93]"/>
            <p className="mb-5">{t.login}</p>
            <Link href="/login" className="inline-block rounded-xl bg-[#005476] px-6 py-3 font-semibold text-white">{t.loginButton}</Link>
          </div>
        ) : (
          <>
            <div className="mb-7 rounded-xl border border-[#cfe7e8] bg-white px-5 py-4 text-sm text-[#43677a]"><LockKeyhole className="me-2 inline h-4 w-4"/>{t.privacy}</div>
            <h2 className="mb-4 text-xl font-semibold">{t.projects}</h2>
            {data.isPending ? <div className="rounded-xl bg-white p-6">{t.loading}</div> : data.isError ? (
              <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-6">{t.unavailable}</div>
            ) : data.data.units.length === 0 ? (
              <div className="rounded-xl bg-white p-7 text-[#466a78]"><Building2 className="mb-3 h-6 w-6 text-[#21aea9]"/>{t.noUnits}</div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {data.data.units.map((unit) => (
                  <article key={unit.unit_id} className="rounded-2xl border border-[#d9e8ec] bg-white p-6 shadow-sm">
                    <h3 className="text-xl font-semibold">{unit.project_name}</h3>
                    <p className="mt-2 text-sm text-[#4e7181]">{t.unit}: {unit.unit_number}</p>
                    <div className="mt-5 flex justify-between text-sm"><span>{t.progress}</span><strong>{unit.progress_percent == null ? "—" : unit.progress_percent + "%"}</strong></div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#dcebed]">
                      <div className="h-full rounded-full bg-[#3BCAC4]" style={{ width: String(Math.max(0,Math.min(100, unit.progress_percent ?? 0)))+"%" }}/>
                    </div>
                    <VipProjectProgress projectId={unit.project_id} />
                    <VipProjectCamera projectId={unit.project_id} />
                    <VipProjectPhotos projectId={unit.project_id} />
                    <VipInstallmentsList unitId={unit.unit_id} />
                    <VipReceiptHistory unitId={unit.unit_id} />
                    <VipStatementRequest unitId={unit.unit_id} />
                  </article>
                ))}
              </div>
            )}
            <h2 className="mb-4 mt-10 text-xl font-semibold">{t.title}</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {features.map(({key,Icon}) => (
                <div key={key} className="rounded-2xl border border-[#d6e8eb] bg-white p-5 shadow-sm">
                  <Icon className="mb-3 h-7 w-7 text-[#008c93]" />
                  <div className="font-semibold">{t[key]}</div>
                  <div className="mt-2 text-xs text-[#658594]">{t.soon}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
