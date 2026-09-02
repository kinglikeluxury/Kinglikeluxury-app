import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListTodo,
  Loader2,
  RotateCcw,
  Search,
  UserRound,
} from "lucide-react";

type DatePreset = "" | "today" | "tomorrow" | "this_week" | "overdue" | "upcoming" | "completed" | "custom";
type TaskStatus = "" | "pending" | "completed" | "overdue";
type TaskSort = "operational" | "due_asc" | "due_desc" | "priority" | "created_desc";

interface TaskRow {
  id: number;
  title: string;
  description: string | null;
  dueDate: string | null;
  dueTime: string | null;
  priority: string;
  completedAt: string | null;
  createdAt: string;
  leadId: number;
  leadName: string;
  leadPhone: string | null;
  assignedTo: number | null;
  assigneeName: string | null;
  createdBy: number | null;
  creatorName: string | null;
  status: "pending" | "completed" | "overdue";
}

interface TasksResponse {
  tasks: TaskRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: {
    today: number;
    overdue: number;
    upcoming: number;
    completed: number;
  };
}

interface AssignableAgent {
  id: number;
  username: string;
  role: string;
}

const PRIORITIES = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const priorityStyle: Record<string, string> = {
  high: "bg-red-50 text-red-700 border-red-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-green-50 text-green-700 border-green-200",
};

const statusStyle: Record<string, string> = {
  pending: "bg-sky-50 text-sky-700 border-sky-200",
  completed: "bg-green-50 text-green-700 border-green-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
};

const statusLabel: Record<string, string> = {
  pending: "Pending",
  completed: "Completed",
  overdue: "Overdue",
};

function SelectField({
  value,
  onChange,
  children,
  className = "",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className={`h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-[#3bcac4] focus:ring-1 focus:ring-[#3bcac4] ${className}`}
    >
      {children}
    </select>
  );
}

function formatDueDate(date: string | null, time: string | null) {
  if (!date) return "No due date";
  const parsed = new Date(`${date}T00:00:00`);
  const formatted = Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${formatted}${time ? ` · ${time}` : ""}`;
}

function formatCreatedAt(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function CounterCard({
  label,
  value,
  icon: Icon,
  color,
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${active ? "border-[#3bcac4] ring-1 ring-[#3bcac4]" : "border-slate-200"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-[#005476]">{value}</p>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${color}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </button>
  );
}

function TaskCard({
  task,
  onComplete,
  completing,
}: {
  task: TaskRow;
  onComplete: (task: TaskRow) => void;
  completing: boolean;
}) {
  const priority = priorityStyle[task.priority] ?? "bg-slate-50 text-slate-600 border-slate-200";
  const status = statusStyle[task.status] ?? statusStyle.pending;
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm transition hover:shadow-md ${task.status === "completed" ? "opacity-75" : ""}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={`border ${priority}`}>{task.priority.toUpperCase()}</Badge>
            <Badge className={`border ${status}`}>{statusLabel[task.status]}</Badge>
          </div>
          <h3 className="mt-2 truncate text-base font-semibold text-[#005476]" title={task.title}>
            {task.title}
          </h3>
          {task.description && (
            <p className="mt-1 line-clamp-2 text-sm text-slate-500">{task.description}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {task.status !== "completed" && (
            <Button
              size="sm"
              variant="outline"
              disabled={completing}
              onClick={() => onComplete(task)}
              className="border-[#3bcac4] text-[#005476] hover:bg-[#3bcac4]/10"
            >
              {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Complete
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Lead / customer</p>
          <Link href={`/admin/crm/${task.leadId}`} className="mt-1 block truncate font-medium text-[#005476] hover:text-[#3bcac4] hover:underline">
            {task.leadName}
          </Link>
          {task.leadPhone && <p className="truncate text-xs text-slate-500">{task.leadPhone}</p>}
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Due</p>
          <p className={`mt-1 flex items-center gap-1.5 ${task.status === "overdue" ? "font-semibold text-red-600" : "text-slate-700"}`}>
            <Clock3 className="h-3.5 w-3.5" />
            {formatDueDate(task.dueDate, task.dueTime)}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Current lead owner</p>
          <p className="mt-1 flex items-center gap-1.5 text-slate-700">
            <UserRound className="h-3.5 w-3.5 text-slate-400" />
            {task.assigneeName || "Unassigned"}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Created by</p>
          <p className="mt-1 text-slate-700">{task.creatorName || "Unknown"} · {formatCreatedAt(task.createdAt)}</p>
        </div>
      </div>
    </div>
  );
}

export default function CrmTasksPage() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [datePreset, setDatePreset] = useState<DatePreset>("");
  const [status, setStatus] = useState<TaskStatus>("");
  const [priority, setPriority] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<TaskSort>("operational");
  const [page, setPage] = useState(1);
  const [completingId, setCompletingId] = useState<number | null>(null);

  const isCrmAuthorized = !authLoading && !!user && (!!user.isAdmin || user.role === "sub_agent");
  const isAdmin = !!user?.isAdmin;

  useEffect(() => {
    if (!authLoading && !isCrmAuthorized) navigate("/");
  }, [authLoading, isCrmAuthorized, navigate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "25");
    if (datePreset) params.set("datePreset", datePreset);
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (isAdmin && assignedTo) params.set("assignedTo", assignedTo);
    if (isAdmin && createdBy) params.set("createdBy", createdBy);
    if (search) params.set("search", search);
    if (datePreset === "custom") {
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
    }
    if (sort) params.set("sort", sort);
    return `/api/admin/crm/tasks?${params.toString()}`;
  }, [assignedTo, createdBy, dateFrom, datePreset, dateTo, isAdmin, page, priority, search, sort, status]);

  const { data, isLoading, isFetching, error } = useQuery<TasksResponse>({
    queryKey: [queryUrl],
    queryFn: async () => {
      const response = await fetch(queryUrl, { credentials: "include" });
      if (!response.ok) throw new Error((await response.text()) || "Failed to load CRM tasks");
      return response.json();
    },
    enabled: isCrmAuthorized,
    staleTime: 10_000,
  });

  const { data: agents = [] } = useQuery<AssignableAgent[]>({
    queryKey: ["/api/admin/crm/assignable-agents"],
    enabled: isCrmAuthorized && isAdmin,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (data && page > data.totalPages) {
      setPage(data.totalPages);
    }
  }, [data, page]);

  const completeMutation = useMutation({
    mutationFn: async (task: TaskRow) => {
      setCompletingId(task.id);
      return apiRequest("PATCH", `/api/admin/crm/leads/${task.leadId}/tasks/${task.id}`, {
        completedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).startsWith("/api/admin/crm/tasks"),
      });
      toast({ title: "Task marked complete" });
    },
    onError: (mutationError: Error) => {
      toast({ title: "Could not complete task", description: mutationError.message, variant: "destructive" });
    },
    onSettled: () => setCompletingId(null),
  });

  const clearFilters = () => {
    setDatePreset("");
    setStatus("");
    setPriority("");
    setAssignedTo("");
    setCreatedBy("");
    setSearchInput("");
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setSort("operational");
    setPage(1);
  };

  const selectCounter = (preset: DatePreset) => {
    setDatePreset(preset);
    setStatus(preset === "today" ? "pending" : "");
    setPage(1);
  };

  if (authLoading || !isCrmAuthorized) return null;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50/60 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2">
              <ListTodo className="h-7 w-7 text-[#3bcac4]" />
              <h1 className="text-2xl font-bold text-[#005476]">Tasks / المهام</h1>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {isAdmin ? "Centralized view of all CRM follow-up tasks" : "Your permitted CRM follow-up tasks"}
            </p>
          </div>
          {isFetching && <Loader2 className="h-5 w-5 animate-spin text-[#3bcac4]" aria-label="Refreshing tasks" />}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CounterCard label="Today" value={data?.summary.today ?? 0} icon={CalendarDays} color="bg-[#3bcac4]/15 text-[#005476]" active={datePreset === "today"} onClick={() => selectCounter("today")} />
          <CounterCard label="Overdue" value={data?.summary.overdue ?? 0} icon={AlertCircle} color="bg-red-100 text-red-600" active={datePreset === "overdue"} onClick={() => selectCounter("overdue")} />
          <CounterCard label="Upcoming" value={data?.summary.upcoming ?? 0} icon={Clock3} color="bg-sky-100 text-sky-600" active={datePreset === "upcoming"} onClick={() => selectCounter("upcoming")} />
          <CounterCard label="Completed" value={data?.summary.completed ?? 0} icon={CheckCircle2} color="bg-green-100 text-green-600" active={datePreset === "completed"} onClick={() => selectCounter("completed")} />
        </div>

        <Card className="border-slate-200 shadow-sm">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-col gap-3 lg:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search customer, phone, task title or description..."
                  className="pl-9"
                />
              </div>
              <SelectField value={datePreset} onChange={(value) => { setDatePreset(value as DatePreset); setPage(1); }} className="lg:w-44" aria-label="Date filter">
                <option value="">All dates</option>
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="this_week">This week</option>
                <option value="overdue">Overdue</option>
                <option value="upcoming">Upcoming</option>
                <option value="completed">Completed</option>
                <option value="custom">Custom range</option>
              </SelectField>
              <SelectField value={status} onChange={(value) => { setStatus(value as TaskStatus); setPage(1); }} className="lg:w-36" aria-label="Status filter">
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="overdue">Overdue</option>
              </SelectField>
              <SelectField value={priority} onChange={(value) => { setPriority(value); setPage(1); }} className="lg:w-36" aria-label="Priority filter">
                <option value="">All priorities</option>
                {PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </SelectField>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              {isAdmin && (
                <>
                  <SelectField value={assignedTo} onChange={(value) => { setAssignedTo(value); setPage(1); }} className="xl:w-52" aria-label="Assigned employee filter">
                    <option value="">All assigned employees</option>
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.username}</option>)}
                  </SelectField>
                  <SelectField value={createdBy} onChange={(value) => { setCreatedBy(value); setPage(1); }} className="xl:w-48" aria-label="Created by filter">
                    <option value="">All creators</option>
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.username}</option>)}
                  </SelectField>
                </>
              )}
              {datePreset === "custom" && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    From
                    <Input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} className="h-9 w-full sm:w-40" />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    To
                    <Input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} className="h-9 w-full sm:w-40" />
                  </label>
                </div>
              )}
              <div className="flex flex-1 flex-wrap items-center gap-2 xl:justify-end">
                <span className="text-xs font-medium text-slate-500">Sort by</span>
                <SelectField value={sort} onChange={(value) => { setSort(value as TaskSort); setPage(1); }} className="w-full sm:w-52" aria-label="Sort tasks">
                  <option value="operational">Operational: overdue first</option>
                  <option value="due_asc">Due date: nearest first</option>
                  <option value="due_desc">Due date: latest first</option>
                  <option value="priority">Priority</option>
                  <option value="created_desc">Created date</option>
                </SelectField>
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="text-slate-500">
                  <RotateCcw className="h-4 w-4" />
                  Clear
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-5 text-sm text-red-700">
              Could not load CRM tasks. Please refresh and try again.
            </CardContent>
          </Card>
        ) : isLoading || !data ? (
          <div className="flex min-h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#3bcac4]" />
          </div>
        ) : data.tasks.length === 0 ? (
          <Card className="border-dashed border-slate-300 bg-white">
            <CardContent className="flex min-h-64 flex-col items-center justify-center p-6 text-center">
              <ListTodo className="h-10 w-10 text-slate-300" />
              <h2 className="mt-3 font-semibold text-[#005476]">No tasks found</h2>
              <p className="mt-1 max-w-md text-sm text-slate-500">Try changing the filters, or create a follow-up task from a CRM Lead.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>{data.total.toLocaleString()} task{data.total === 1 ? "" : "s"}</span>
              <span>Page {data.page} of {data.totalPages}</span>
            </div>
            <div className="space-y-3">
              {data.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onComplete={(selectedTask) => completeMutation.mutate(selectedTask)}
                  completing={completingId === task.id}
                />
              ))}
            </div>
            {data.totalPages > 1 && (
              <div className="flex items-center justify-center gap-3">
                <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <span className="text-sm text-slate-500">{page} / {data.totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= data.totalPages || isFetching} onClick={() => setPage((current) => Math.min(data.totalPages, current + 1))}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}