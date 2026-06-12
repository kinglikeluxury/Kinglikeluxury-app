import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, Users, UserCheck, TrendingUp, Star, CheckCircle2,
  XCircle, MessageCircle, Mail, Megaphone, RefreshCw, PhoneOff,
  Flame, Crown, Clock, UserX, ThumbsUp,
} from "lucide-react";
import { useEffect, useState } from "react";

interface CrmHealthData {
  totals: {
    total: number; new: number; newToday: number;
    noAnswer1: number; noAnswer2: number; noAnswer3: number;
    followUp: number; interested: number; qualified: number;
    hotBuyers: number; vipBuyers: number; sold: number; lost: number;
  };
  agentsBreakdown: { agent: string; cnt: number }[];
  activityToday: { metaLeads: number; whatsappConvs: number; emailSends: number };
  generatedAt: string;
}

function n(v: number) { return v.toLocaleString(); }

function KpiCard({
  label, value, sub, icon: Icon, color, bg, border,
}: {
  label: string; value: number; sub?: string;
  icon: React.ElementType; color: string; bg: string; border: string;
}) {
  return (
    <Card className={`shadow-sm border ${border}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-3xl font-extrabold ${color}`}>{n(value)}</p>
            {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
          </div>
          <div className={`p-2.5 rounded-xl ${bg}`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TodayCard({
  label, value, icon: Icon, color, bg,
}: {
  label: string; value: number; icon: React.ElementType; color: string; bg: string;
}) {
  return (
    <Card className="shadow-sm border border-slate-100">
      <CardContent className="p-4 flex items-center gap-4">
        <div className={`p-3 rounded-xl ${bg} shrink-0`}>
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
        <div>
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{label}</p>
          <p className={`text-2xl font-extrabold ${color}`}>{n(value)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function pct(v: number, total: number) {
  if (!total) return 0;
  return Math.round((v / total) * 100);
}

export default function CrmHealthPage() {
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const { data, isLoading, refetch, isFetching } = useQuery<CrmHealthData>({
    queryKey: ["/api/admin/crm/health"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/admin/crm/health");
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  useEffect(() => {
    if (data) setLastRefresh(new Date());
  }, [data]);

  function handleRefresh() { refetch(); }

  const t = data?.totals;
  const today = data?.activityToday;
  const agents = data?.agentsBreakdown ?? [];

  return (
    <div className="min-h-screen bg-gray-50 pb-20">

      {/* ── Header ── */}
      <div className="bg-gradient-to-r from-[#005476] to-[#3bcac4] text-white px-6 py-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/20 rounded-xl">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">CRM Health Dashboard</h1>
              <p className="text-white/75 text-sm mt-0.5">
                Read-only · Admin only ·{" "}
                {data && (
                  <span>
                    Updated {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="bg-white/20 hover:bg-white/30 text-white border-white/30 gap-2"
            onClick={handleRefresh}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-7">

        {/* ── Loading skeleton ── */}
        {isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="shadow-sm">
                <CardContent className="p-5">
                  <div className="h-4 w-24 bg-slate-200 rounded animate-pulse mb-3" />
                  <div className="h-8 w-16 bg-slate-200 rounded animate-pulse" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {t && (
          <>
            {/* ── Row 1: Pipeline Overview ── */}
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Pipeline Overview</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard
                  label="Total Leads"
                  value={t.total}
                  sub={`+${n(t.newToday)} today`}
                  icon={Users}
                  color="text-[#005476]"
                  bg="bg-[#e0f0f8]"
                  border="border-[#b0d8ef]"
                />
                <KpiCard
                  label="New"
                  value={t.new}
                  sub={`${pct(t.new, t.total)}% of total`}
                  icon={UserCheck}
                  color="text-[#3bcac4]"
                  bg="bg-[#e8faf9]"
                  border="border-[#a7ece9]"
                />
                <KpiCard
                  label="Qualified"
                  value={t.qualified}
                  sub={`${pct(t.qualified, t.total)}% of total`}
                  icon={ThumbsUp}
                  color="text-purple-700"
                  bg="bg-purple-50"
                  border="border-purple-200"
                />
                <KpiCard
                  label="Sold"
                  value={t.sold}
                  sub="Converted / Kinglike sale"
                  icon={CheckCircle2}
                  color="text-emerald-700"
                  bg="bg-emerald-50"
                  border="border-emerald-200"
                />
              </div>
            </section>

            {/* ── Row 2: No-Answer Funnel ── */}
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">No Answer Funnel</h2>
              <div className="grid grid-cols-3 gap-4">
                <KpiCard
                  label="No Answer 1"
                  value={t.noAnswer1}
                  sub="First attempt"
                  icon={PhoneOff}
                  color="text-amber-700"
                  bg="bg-amber-50"
                  border="border-amber-200"
                />
                <KpiCard
                  label="No Answer 2"
                  value={t.noAnswer2}
                  sub="Second attempt"
                  icon={PhoneOff}
                  color="text-orange-700"
                  bg="bg-orange-50"
                  border="border-orange-200"
                />
                <KpiCard
                  label="No Answer 3"
                  value={t.noAnswer3}
                  sub="Third attempt"
                  icon={PhoneOff}
                  color="text-red-700"
                  bg="bg-red-50"
                  border="border-red-200"
                />
              </div>
            </section>

            {/* ── Row 3: Hot Buyers & Other ── */}
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Buyer Temperature</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard
                  label="Hot Buyers"
                  value={t.hotBuyers}
                  sub="HOT + VIP score"
                  icon={Flame}
                  color="text-orange-600"
                  bg="bg-orange-50"
                  border="border-orange-200"
                />
                <KpiCard
                  label="VIP Buyers"
                  value={t.vipBuyers}
                  sub="Top qualification score"
                  icon={Crown}
                  color="text-[#005476]"
                  bg="bg-[#e0f0f8]"
                  border="border-[#b0d8ef]"
                />
                <KpiCard
                  label="Follow Up"
                  value={t.followUp}
                  sub="Active engagement"
                  icon={Clock}
                  color="text-blue-700"
                  bg="bg-blue-50"
                  border="border-blue-200"
                />
                <KpiCard
                  label="Lost"
                  value={t.lost}
                  sub="Competition / Junk / Not interested"
                  icon={UserX}
                  color="text-slate-500"
                  bg="bg-slate-100"
                  border="border-slate-200"
                />
              </div>
            </section>

            {/* ── Row 4: Today's Activity ── */}
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Activity Today</h2>
              <div className="grid grid-cols-3 gap-4">
                <TodayCard
                  label="Meta Leads Today"
                  value={today?.metaLeads ?? 0}
                  icon={Megaphone}
                  color="text-[#005476]"
                  bg="bg-[#e0f0f8]"
                />
                <TodayCard
                  label="WhatsApp Conversations"
                  value={today?.whatsappConvs ?? 0}
                  icon={MessageCircle}
                  color="text-[#3bcac4]"
                  bg="bg-[#e8faf9]"
                />
                <TodayCard
                  label="Email Nurturing Sends"
                  value={today?.emailSends ?? 0}
                  icon={Mail}
                  color="text-purple-700"
                  bg="bg-purple-50"
                />
              </div>
            </section>

            {/* ── Pipeline bar ── */}
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Pipeline Breakdown</h2>
              <Card className="shadow-sm">
                <CardContent className="p-5 space-y-3">
                  {[
                    { label: "New",          value: t.new,        color: "bg-[#3bcac4]" },
                    { label: "No Answer 1",  value: t.noAnswer1,  color: "bg-amber-400" },
                    { label: "No Answer 2",  value: t.noAnswer2,  color: "bg-orange-400" },
                    { label: "No Answer 3",  value: t.noAnswer3,  color: "bg-red-400" },
                    { label: "Follow Up",    value: t.followUp,   color: "bg-blue-400" },
                    { label: "Interested",   value: t.interested, color: "bg-indigo-400" },
                    { label: "Qualified",    value: t.qualified,  color: "bg-purple-500" },
                    { label: "Hot Buyers",   value: t.hotBuyers,  color: "bg-orange-500" },
                    { label: "Sold",         value: t.sold,       color: "bg-emerald-500" },
                    { label: "Lost",         value: t.lost,       color: "bg-slate-300" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center gap-3">
                      <span className="text-xs text-slate-500 w-28 shrink-0">{label}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-2.5">
                        <div
                          className={`${color} h-2.5 rounded-full transition-all duration-500`}
                          style={{ width: `${Math.max(pct(value, t.total), value > 0 ? 2 : 0)}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-slate-600 w-10 text-right">{n(value)}</span>
                      <span className="text-xs text-slate-400 w-8 text-right">{pct(value, t.total)}%</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>

            {/* ── Agent Assignment Table ── */}
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Leads Assigned per Agent</h2>
              <Card className="shadow-sm">
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Agent</th>
                        <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Leads</th>
                        <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Share</th>
                        <th className="px-5 py-3 w-40 hidden sm:table-cell"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {agents.map((row, i) => (
                        <tr key={row.agent} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                          <td className="px-5 py-3.5 font-medium text-slate-700 flex items-center gap-2.5">
                            <div
                              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                              style={{ background: i === 0 ? "#3bcac4" : i === 1 ? "#005476" : "#94a3b8" }}
                            >
                              {row.agent[0]?.toUpperCase() ?? "?"}
                            </div>
                            {row.agent === "Unassigned" ? (
                              <span className="text-slate-400 italic">Unassigned</span>
                            ) : (
                              <span>{row.agent}</span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right font-bold text-[#005476]">{n(row.cnt)}</td>
                          <td className="px-5 py-3.5 text-right">
                            <Badge
                              className="text-xs font-medium"
                              style={{
                                background: "#e8faf9",
                                color: "#005476",
                                border: "1px solid #a7ece9",
                              }}
                            >
                              {pct(row.cnt, t.total)}%
                            </Badge>
                          </td>
                          <td className="px-5 py-3.5 hidden sm:table-cell">
                            <div className="w-full bg-slate-100 rounded-full h-1.5">
                              <div
                                className="h-1.5 rounded-full"
                                style={{
                                  width: `${pct(row.cnt, t.total)}%`,
                                  background: "linear-gradient(90deg, #3bcac4, #005476)",
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 border-t border-slate-200">
                        <td className="px-5 py-3 text-xs font-bold text-slate-500 uppercase">Total</td>
                        <td className="px-5 py-3 text-right font-extrabold text-[#005476]">{n(t.total)}</td>
                        <td className="px-5 py-3 text-right">
                          <Badge className="text-xs bg-[#3bcac4]/10 text-[#005476] border border-[#3bcac4]/30">100%</Badge>
                        </td>
                        <td className="hidden sm:table-cell" />
                      </tr>
                    </tfoot>
                  </table>
                </CardContent>
              </Card>
            </section>

            {/* ── Generated at ── */}
            <p className="text-center text-xs text-slate-400">
              Data snapshot · {new Date(data.generatedAt).toLocaleString()} · Auto-refreshes every 5 min
            </p>
          </>
        )}
      </div>
    </div>
  );
}
