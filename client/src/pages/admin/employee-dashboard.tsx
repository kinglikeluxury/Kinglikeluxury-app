import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Users, Flame, CheckCircle2, Phone, TrendingUp, Clock,
  AlertCircle, Calendar, Target, DollarSign, Award, ArrowRight,
  Loader2, BarChart3, Globe, Crown, Banknote, ShoppingCart,
  ListTodo, Zap,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";

interface DashboardData {
  agentId: number;
  agentName: string;
  stats: {
    total: number; new: number; qualified: number; hot: number; hotScore: number;
    followUp: number; noAnswer: number; deposited: number; reserved: number;
    purchased: number; pendingTasks: number; overdueTasks: number; todayTasks: number;
  };
  performance: {
    total: number; qualified: number; hot: number; deposited: number;
    purchased: number; conversionRate: string;
  };
  countries: { name: string; flag: string; count: number }[];
  sources: { source: string; count: number }[];
  tasks: {
    today: TaskRow[];
    upcoming: TaskRow[];
    overdue: TaskRow[];
  };
  topHotLeads: LeadRow[];
  recentLeads: LeadRow[];
}

interface TaskRow {
  id: number; title: string; description: string | null;
  dueDate: string | null; dueTime: string | null; priority: string;
  leadId: number; leadName: string; leadPhone: string;
}

interface LeadRow {
  id: number; name: string; phone: string;
  status: string; leadScore: string;
  updatedAt?: string; createdAt?: string;
}

const STATUS_LABELS: Record<string, string> = {
  new: "New", hot_buyer: "Hot Buyer", qualified: "Qualified", follow_up: "Follow Up",
  deposited: "Deposited", reserved: "Reserved", purchased: "Purchased",
  no_answer: "No Answer", no_answer_1: "No Answer", no_answer_2: "No Answer",
  will_think: "Will Think", junk_lead: "Junk", lost: "Lost", broker: "Broker",
};

const SCORE_COLORS: Record<string, string> = {
  hot: "bg-red-100 text-red-700 border-red-200",
  warm: "bg-amber-100 text-amber-700 border-amber-200",
  cold: "bg-sky-100 text-sky-700 border-sky-200",
};

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  meta:    { label: "Meta Lead Ads",  color: "bg-blue-500" },
  whatsapp:{ label: "WhatsApp AI",    color: "bg-green-500" },
  manual:  { label: "Manual",         color: "bg-slate-400" },
  excel:   { label: "Import / Excel", color: "bg-purple-500" },
  website: { label: "Website",        color: "bg-teal-500" },
};

const PRIORITY_COLORS: Record<string, string> = {
  high:   "text-red-600 bg-red-50 border-red-200",
  medium: "text-amber-600 bg-amber-50 border-amber-200",
  low:    "text-green-600 bg-green-50 border-green-200",
};

function StatCard({
  label, value, icon: Icon, color, sub,
}: { label: string; value: number; icon: any; color: string; sub?: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className="text-2xl font-bold text-[#005476] mt-0.5">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
            <Icon className="h-4.5 w-4.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TaskCard({ task }: { task: TaskRow }) {
  const pcfg = PRIORITY_COLORS[task.priority ?? "medium"] ?? PRIORITY_COLORS.medium;
  return (
    <Link href={`/admin/crm/${task.leadId}`}>
      <div className="flex items-start gap-3 p-3 rounded-lg border bg-white hover:border-[#3bcac4]/50 hover:bg-[#3bcac4]/5 transition-colors cursor-pointer">
        <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${pcfg}`}>
          {(task.priority ?? "med").toUpperCase().slice(0, 3)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#005476] truncate">{task.title}</p>
          <p className="text-xs text-muted-foreground truncate">{task.leadName ?? task.leadPhone}</p>
          {task.dueDate && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              <Clock className="h-3 w-3" />{task.dueDate}{task.dueTime ? ` ${task.dueTime}` : ""}
            </div>
          )}
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
      </div>
    </Link>
  );
}

function LeadRow({ lead }: { lead: LeadRow }) {
  const scoreClass = SCORE_COLORS[lead.leadScore] ?? SCORE_COLORS.cold;
  return (
    <Link href={`/admin/crm/${lead.id}`}>
      <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-[#3bcac4]/5 transition-colors cursor-pointer border border-transparent hover:border-[#3bcac4]/30">
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#3bcac4]/20 to-[#005476]/20 flex items-center justify-center shrink-0 text-xs font-bold text-[#005476]">
          {(lead.name ?? "?").charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#005476] truncate">{lead.name || "No name"}</p>
          <p className="text-xs text-muted-foreground truncate">{lead.phone || "—"}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${scoreClass}`}>
            {(lead.leadScore ?? "cold").toUpperCase()}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {STATUS_LABELS[lead.status] ?? lead.status}
          </span>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </div>
    </Link>
  );
}

export default function EmployeeDashboardPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  const isCrmAuthorized = !authLoading && !!user && (!!user.isAdmin || user.role === "sub_agent");

  useEffect(() => {
    if (!authLoading && !isCrmAuthorized) navigate("/");
  }, [authLoading, isCrmAuthorized, navigate]);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/admin/crm/employee-dashboard"],
    queryFn: () => fetch("/api/admin/crm/employee-dashboard").then(r => {
      if (!r.ok) throw new Error("Failed to load dashboard");
      return r.json();
    }),
    enabled: isCrmAuthorized,
    refetchInterval: 60_000,
  });

  if (authLoading || !isCrmAuthorized) return null;

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-[#3bcac4]" />
      </div>
    );
  }

  const { stats, performance, countries, sources, tasks, topHotLeads, recentLeads, agentName } = data;
  const sourceTotal = sources.reduce((s, r) => s + r.count, 0);
  const countryTotal = countries.reduce((s, r) => s + r.count, 0);

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#005476] flex items-center gap-2">
            <Crown className="h-6 w-6 text-[#3bcac4]" />
            My Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {agentName} · {dateStr}
          </p>
        </div>
        {tasks.overdue.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
            <AlertCircle className="h-4 w-4" />
            {tasks.overdue.length} overdue task{tasks.overdue.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Lead Stats — Row 1 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total Leads"    value={stats.total}     icon={Users}         color="bg-[#3bcac4]/15 text-[#005476]" />
        <StatCard label="New Leads"      value={stats.new}       icon={Zap}           color="bg-blue-100 text-blue-600" />
        <StatCard label="Qualified"      value={stats.qualified} icon={CheckCircle2}  color="bg-[#3bcac4]/20 text-[#005476]" />
        <StatCard label="Hot Buyers"     value={stats.hot}       icon={Flame}         color="bg-red-100 text-red-600" />
        <StatCard label="Follow Up"      value={stats.followUp}  icon={Phone}         color="bg-amber-100 text-amber-600" />
        <StatCard label="No Answer"      value={stats.noAnswer}  icon={AlertCircle}   color="bg-slate-100 text-slate-500" />
      </div>

      {/* Lead Stats — Row 2 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Deposited"      value={stats.deposited}     icon={DollarSign}  color="bg-green-100 text-green-600" />
        <StatCard label="Reserved"       value={stats.reserved}      icon={Award}       color="bg-purple-100 text-purple-600" />
        <StatCard label="Purchased"      value={stats.purchased}     icon={ShoppingCart} color="bg-[#005476]/10 text-[#005476]" />
        <StatCard label="Pending Tasks"  value={stats.pendingTasks}  icon={ListTodo}    color="bg-slate-100 text-slate-600" />
        <StatCard
          label="Overdue Tasks"
          value={stats.overdueTasks}
          icon={AlertCircle}
          color={stats.overdueTasks > 0 ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-400"}
        />
        <StatCard
          label="Today's Tasks"
          value={stats.todayTasks}
          icon={Calendar}
          color={stats.todayTasks > 0 ? "bg-[#3bcac4]/20 text-[#005476]" : "bg-slate-100 text-slate-400"}
        />
      </div>

      {/* Performance KPI */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base text-[#005476] flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#3bcac4]" /> Performance KPI
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y sm:divide-y-0">
            {[
              { label: "Assigned",     value: performance.total,        icon: Users,         color: "text-[#005476]" },
              { label: "Qualified",    value: performance.qualified,     icon: CheckCircle2,  color: "text-[#3bcac4]" },
              { label: "Hot Leads",    value: performance.hot,           icon: Flame,         color: "text-red-500" },
              { label: "Deposits",     value: performance.deposited,     icon: Banknote,      color: "text-green-600" },
              { label: "Purchases",    value: performance.purchased,     icon: ShoppingCart,  color: "text-[#005476]" },
              { label: "Conversion %", value: `${performance.conversionRate}%`, icon: Target, color: "text-[#3bcac4]" },
            ].map(item => (
              <div key={item.label} className="flex flex-col items-center justify-center py-5 px-3 gap-1">
                <item.icon className={`h-5 w-5 ${item.color}`} />
                <p className="text-xl font-bold text-[#005476]">{item.value}</p>
                <p className="text-[11px] text-muted-foreground font-medium">{item.label}</p>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 bg-gradient-to-r from-[#3bcac4]/5 to-[#005476]/5 border-t text-xs text-muted-foreground">
            Conversion Rate = Purchases ÷ Total Assigned Leads × 100
          </div>
        </CardContent>
      </Card>

      {/* Country + Source row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Country Breakdown */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base text-[#005476] flex items-center gap-2">
              <Globe className="h-4 w-4 text-[#3bcac4]" /> Country Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            {countries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No phone data available</p>
            ) : (
              <div className="space-y-2">
                {countries.slice(0, 10).map(c => {
                  const pct = countryTotal > 0 ? ((c.count / countryTotal) * 100).toFixed(1) : "0";
                  return (
                    <div key={c.name} className="flex items-center gap-3">
                      <span className="text-lg shrink-0">{c.flag}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-[#005476] truncate">{c.name}</span>
                          <span className="text-xs text-muted-foreground ml-2 shrink-0">{c.count} · {pct}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
                {countries.length > 10 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">+{countries.length - 10} more countries</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Lead Sources */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base text-[#005476] flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-[#3bcac4]" /> Lead Sources
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No data available</p>
            ) : (
              <div className="space-y-3">
                {sources.map(s => {
                  const cfg = SOURCE_LABELS[s.source] ?? { label: s.source, color: "bg-gray-400" };
                  const pct = sourceTotal > 0 ? ((s.count / sourceTotal) * 100).toFixed(1) : "0";
                  return (
                    <div key={s.source} className="flex items-center gap-3">
                      <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${cfg.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-[#005476]">{cfg.label}</span>
                          <span className="text-xs text-muted-foreground ml-2 shrink-0">{s.count} · {pct}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${cfg.color}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Today's Tasks */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm text-[#005476] flex items-center gap-2">
              <Calendar className="h-4 w-4 text-[#3bcac4]" />
              Today's Tasks
              {tasks.today.length > 0 && (
                <Badge className="ml-auto bg-[#3bcac4]/15 text-[#005476] border-[#3bcac4]/30 hover:bg-[#3bcac4]/20">
                  {tasks.today.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 space-y-2 max-h-72 overflow-y-auto">
            {tasks.today.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                <Calendar className="h-6 w-6 mx-auto mb-1.5 opacity-20" />
                No tasks today
              </div>
            ) : tasks.today.map(t => <TaskCard key={t.id} task={t} />)}
          </CardContent>
        </Card>

        {/* Overdue Tasks */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm text-[#005476] flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              Overdue Tasks
              {tasks.overdue.length > 0 && (
                <Badge className="ml-auto bg-red-100 text-red-700 border-red-200 hover:bg-red-100">
                  {tasks.overdue.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 space-y-2 max-h-72 overflow-y-auto">
            {tasks.overdue.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                <CheckCircle2 className="h-6 w-6 mx-auto mb-1.5 opacity-20" />
                No overdue tasks
              </div>
            ) : tasks.overdue.map(t => <TaskCard key={t.id} task={t} />)}
          </CardContent>
        </Card>

        {/* Upcoming Tasks */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm text-[#005476] flex items-center gap-2">
              <Clock className="h-4 w-4 text-[#3bcac4]" />
              Upcoming Tasks
              {tasks.upcoming.length > 0 && (
                <Badge className="ml-auto bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100">
                  {tasks.upcoming.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 space-y-2 max-h-72 overflow-y-auto">
            {tasks.upcoming.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                <Clock className="h-6 w-6 mx-auto mb-1.5 opacity-20" />
                No upcoming tasks
              </div>
            ) : tasks.upcoming.map(t => <TaskCard key={t.id} task={t} />)}
          </CardContent>
        </Card>
      </div>

      {/* Hot Leads + Recent Leads */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Hot Leads */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base text-[#005476] flex items-center gap-2">
              <Flame className="h-4 w-4 text-red-500" /> Top Hot Leads
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            {topHotLeads.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <Flame className="h-7 w-7 mx-auto mb-2 opacity-20" />
                No hot leads yet
              </div>
            ) : (
              <div className="space-y-1">
                {topHotLeads.map(lead => <LeadRow key={lead.id} lead={lead} />)}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recently Assigned */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base text-[#005476] flex items-center gap-2">
              <Users className="h-4 w-4 text-[#3bcac4]" /> Recently Assigned
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            {recentLeads.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <Users className="h-7 w-7 mx-auto mb-2 opacity-20" />
                No leads assigned yet
              </div>
            ) : (
              <div className="space-y-1">
                {recentLeads.map(lead => <LeadRow key={lead.id} lead={lead} />)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
