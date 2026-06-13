import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  MessageSquare, Zap, CheckCircle2, Clock, XCircle, BarChart3,
  MapPin, Target, TrendingUp, ArrowLeft, RefreshCw, AlertTriangle,
  User, Phone, Crown, Flame, Thermometer, Snowflake,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConciergStats {
  sessions: {
    todayTotal: number;
    weekTotal: number;
    todayActive: number;
    weekActive: number;
    allCompleted: number;
    allTimedOut: number;
    allOptOut: number;
    allTotal: number;
    avgTurnCount: number;
    avgTurnCompleted: number;
  };
  escalations: {
    total: number;
    breakdown: { type: string; count: number }[];
    recent: {
      createdAt: string;
      escalationType: string;
      leadId: number | null;
      leadName: string | null;
      leadPhone: string | null;
    }[];
  };
  topCities: { city: string; count: number }[];
  topGoals: { goal: string; count: number }[];
  scoreDistribution: { score: string; count: number }[];
  generatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SCORE_COLOR: Record<string, string> = {
  VIP:  "#005476",
  HOT:  "#3bcac4",
  WARM: "#22c55e",
  COLD: "#94a3b8",
};

const SCORE_ICON: Record<string, React.ElementType> = {
  VIP:  Crown,
  HOT:  Flame,
  WARM: Thermometer,
  COLD: Snowflake,
};

const ESCALATION_LABELS: Record<string, string> = {
  site_visit:        "Site Visit",
  reservation:       "Reservation",
  payment_plan:      "Payment Plan",
  unit_availability: "Unit Availability",
  contract_question: "Contract Question",
  purchase_intent:   "Purchase Intent",
};

const ESCALATION_COLORS = ["#3bcac4", "#005476", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444"];
const GOAL_LABELS: Record<string, string> = {
  goal_invest: "Investment",
  goal_reside: "Residence",
  goal_both:   "Both",
};

function fmt(d: string) {
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, accent,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent: string;
}) {
  return (
    <Card className="shadow-sm border border-slate-100">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</p>
            <p className="text-3xl font-extrabold" style={{ color: accent }}>{value}</p>
            {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
          </div>
          <div className="rounded-xl p-3" style={{ background: `${accent}18` }}>
            <Icon className="h-5 w-5" style={{ color: accent }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WhatsappConciergeDashboard() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<ConciergStats>({
    queryKey: ["/api/admin/wa-concierge-stats"],
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-4">
        <Skeleton className="h-8 w-72" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6 max-w-7xl mx-auto text-center py-20">
        <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto mb-4" />
        <p className="text-slate-600">Failed to load dashboard data.</p>
        <Button className="mt-4" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const { sessions, escalations, topCities, topGoals, scoreDistribution } = data;

  const completionRate = sessions.allTotal > 0
    ? Math.round((sessions.allCompleted / sessions.allTotal) * 100)
    : 0;

  const escalationChartData = escalations.breakdown.map((b, i) => ({
    name: ESCALATION_LABELS[b.type] ?? b.type,
    value: b.count,
    color: ESCALATION_COLORS[i % ESCALATION_COLORS.length],
  }));

  const cityChartData = topCities.slice(0, 6).map(c => ({
    name: c.city,
    value: c.count,
  }));

  const goalChartData = topGoals.map(g => ({
    name: GOAL_LABELS[g.goal] ?? g.goal,
    value: g.count,
  }));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/dashboard">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Dashboard
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <MessageSquare className="h-6 w-6" style={{ color: "#3bcac4" }} />
              WhatsApp AI Concierge
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">Live performance dashboard · auto-refreshes every 60s</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* KPI cards — row 1: activity */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Active Today"
          value={sessions.todayActive}
          sub={`${sessions.todayTotal} sessions started`}
          icon={Zap}
          accent="#3bcac4"
        />
        <KpiCard
          label="Active This Week"
          value={sessions.weekActive}
          sub={`${sessions.weekTotal} sessions started`}
          icon={TrendingUp}
          accent="#005476"
        />
        <KpiCard
          label="Completed"
          value={sessions.allCompleted}
          sub={`${completionRate}% completion rate`}
          icon={CheckCircle2}
          accent="#22c55e"
        />
        <KpiCard
          label="Timed Out"
          value={sessions.allTimedOut}
          sub={`${sessions.allOptOut} opt-outs`}
          icon={XCircle}
          accent="#94a3b8"
        />
      </div>

      {/* KPI cards — row 2: quality */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Avg Turns / Session"
          value={sessions.avgTurnCount}
          sub="all sessions"
          icon={BarChart3}
          accent="#8b5cf6"
        />
        <KpiCard
          label="Avg Turns (Completed)"
          value={sessions.avgTurnCompleted}
          sub="completed sessions only"
          icon={BarChart3}
          accent="#005476"
        />
        <KpiCard
          label="Hot-Lead Escalations"
          value={escalations.total}
          sub="all time"
          icon={Flame}
          accent="#ef4444"
        />
        <KpiCard
          label="Total Sessions"
          value={sessions.allTotal}
          sub="all time"
          icon={MessageSquare}
          accent="#3bcac4"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Score distribution */}
        <Card className="shadow-sm border border-slate-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Crown className="h-4 w-4" style={{ color: "#005476" }} />
              Lead Score Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scoreDistribution.length === 0 ? (
              <p className="text-center text-slate-400 py-8 text-sm">No scored sessions yet</p>
            ) : (
              <>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={scoreDistribution.map(s => ({
                          name: s.score,
                          value: s.count,
                          color: SCORE_COLOR[s.score] ?? "#94a3b8",
                        }))}
                        cx="50%" cy="50%"
                        innerRadius={45} outerRadius={75}
                        paddingAngle={3}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`}
                        labelLine={false}
                      >
                        {scoreDistribution.map((s, i) => (
                          <Cell key={i} fill={SCORE_COLOR[s.score] ?? "#94a3b8"} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {scoreDistribution.map((s) => {
                    const Icon = SCORE_ICON[s.score] ?? MessageSquare;
                    return (
                      <div key={s.score} className="flex items-center gap-2 rounded-lg p-2 bg-slate-50">
                        <Icon className="h-4 w-4 flex-shrink-0" style={{ color: SCORE_COLOR[s.score] ?? "#94a3b8" }} />
                        <div>
                          <p className="text-xs font-bold" style={{ color: SCORE_COLOR[s.score] ?? "#94a3b8" }}>{s.score}</p>
                          <p className="text-xs text-slate-500">{s.count} leads</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Escalation type breakdown */}
        <Card className="shadow-sm border border-slate-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Zap className="h-4 w-4" style={{ color: "#ef4444" }} />
              Hot-Lead Escalation Types
              <Badge variant="secondary" className="ml-auto text-xs">{escalations.total} total</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {escalationChartData.length === 0 ? (
              <p className="text-center text-slate-400 py-8 text-sm">No escalations recorded yet</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={escalationChartData} layout="vertical" margin={{ left: 8, right: 20 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="value" name="Count" radius={[0, 4, 4, 0]}>
                      {escalationChartData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cities + Goals row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top cities */}
        <Card className="shadow-sm border border-slate-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <MapPin className="h-4 w-4" style={{ color: "#3bcac4" }} />
              Top Cities Mentioned
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cityChartData.length === 0 ? (
              <p className="text-center text-slate-400 py-8 text-sm">No city data extracted yet</p>
            ) : (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cityChartData} margin={{ left: 0, right: 20, bottom: 20 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="value" name="Mentions" fill="#3bcac4" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top goals */}
        <Card className="shadow-sm border border-slate-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Target className="h-4 w-4" style={{ color: "#005476" }} />
              Investment Goals
            </CardTitle>
          </CardHeader>
          <CardContent>
            {goalChartData.length === 0 ? (
              <p className="text-center text-slate-400 py-8 text-sm">No goal data extracted yet</p>
            ) : (
              <>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={goalChartData}
                        cx="50%" cy="50%"
                        outerRadius={65}
                        paddingAngle={3}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`}
                        labelLine={false}
                      >
                        {goalChartData.map((_, i) => (
                          <Cell key={i} fill={["#3bcac4", "#005476", "#22c55e"][i % 3]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-1">
                  {goalChartData.map((g, i) => (
                    <div key={i} className="flex items-center justify-between text-xs px-1">
                      <span className="text-slate-600">{g.name}</span>
                      <Badge variant="outline" className="font-mono">{g.value}</Badge>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Session outcome row */}
      <Card className="shadow-sm border border-slate-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <BarChart3 className="h-4 w-4" style={{ color: "#005476" }} />
            Session Outcome Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Completed", value: sessions.allCompleted, color: "#22c55e", pct: completionRate },
              { label: "Timed Out", value: sessions.allTimedOut, color: "#f59e0b",
                pct: sessions.allTotal > 0 ? Math.round((sessions.allTimedOut / sessions.allTotal) * 100) : 0 },
              { label: "Opted Out", value: sessions.allOptOut, color: "#ef4444",
                pct: sessions.allTotal > 0 ? Math.round((sessions.allOptOut / sessions.allTotal) * 100) : 0 },
              { label: "In Progress / Other",
                value: sessions.allTotal - sessions.allCompleted - sessions.allTimedOut - sessions.allOptOut,
                color: "#3bcac4",
                pct: sessions.allTotal > 0
                  ? Math.round(((sessions.allTotal - sessions.allCompleted - sessions.allTimedOut - sessions.allOptOut) / sessions.allTotal) * 100)
                  : 0,
              },
            ].map(({ label, value, color, pct }) => (
              <div key={label} className="rounded-xl p-4 bg-slate-50 border border-slate-100">
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-1">{label}</p>
                <p className="text-2xl font-bold" style={{ color }}>{value}</p>
                <div className="mt-2 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                </div>
                <p className="text-xs text-slate-400 mt-1">{pct}% of total</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent hot-lead escalations */}
      <Card className="shadow-sm border border-slate-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Flame className="h-4 w-4 text-red-500" />
            Recent Hot-Lead Escalations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {escalations.recent.length === 0 ? (
            <p className="text-center text-slate-400 py-6 text-sm">No escalations recorded yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-slate-400 uppercase tracking-wide">
                    <th className="text-left py-2 pr-4">Time</th>
                    <th className="text-left py-2 pr-4">Type</th>
                    <th className="text-left py-2 pr-4">Lead</th>
                    <th className="text-left py-2">Phone</th>
                    <th className="text-right py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {escalations.recent.map((e, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 pr-4 text-slate-400 text-xs whitespace-nowrap">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {timeAgo(e.createdAt)}
                        <span className="block text-[10px]">{fmt(e.createdAt)}</span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge
                          variant="outline"
                          className="text-xs font-medium border-red-200 text-red-600 bg-red-50"
                        >
                          {ESCALATION_LABELS[e.escalationType] ?? e.escalationType}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-1.5">
                          <User className="h-3 w-3 text-slate-400" />
                          <span className="text-slate-700 font-medium">{e.leadName ?? "—"}</span>
                        </div>
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Phone className="h-3 w-3 text-slate-400" />
                          <span className="text-slate-600 font-mono text-xs">{e.leadPhone ?? "—"}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right">
                        {e.leadId && (
                          <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                            <Link href={`/admin/crm/${e.leadId}`}>View Lead</Link>
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-right text-xs text-slate-400">
        Last updated: {fmt(data.generatedAt)}
      </p>
    </div>
  );
}
