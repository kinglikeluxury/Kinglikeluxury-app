import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  RadioTower, Plus, Send, Pause, Play, Square, Trash2, Eye, Loader2,
  Mail, Users, CheckCircle2, XCircle, Clock, Filter, Image as ImageIcon,
  ChevronDown, ChevronUp, RefreshCw, AlertTriangle,
} from "lucide-react";
import { uploadToCloudinary } from "@/lib/cloudinaryUpload";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Broadcast {
  id: number;
  name: string;
  subject: string;
  body_html: string;
  image_url: string | null;
  filter_config: FilterConfig;
  status: "draft" | "test_sent" | "approved" | "running" | "paused" | "completed" | "cancelled";
  batch_size: number;
  batch_delay_ms: number;
  test_sent_at: string | null;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  pending_count: number;
}

interface FilterConfig {
  search?: string;
  status?: string[];
  source?: string[];
  assignedTo?: string[];
  expectedMonth?: string[];
  contactDate?: string;
  qualScore?: string[];
  aiScore?: string[];
  projectInterest?: string[];
  interestedCountry?: string[];
  city?: string[];
  waStage?: string[];
  leadScore?: string[];
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:     { label: "Draft",     color: "bg-gray-100 text-gray-600 border-gray-200" },
  test_sent: { label: "Test Sent", color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  approved:  { label: "Approved",  color: "bg-blue-50 text-blue-700 border-blue-200" },
  running:   { label: "Running",   color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  paused:    { label: "Paused",    color: "bg-orange-50 text-orange-700 border-orange-200" },
  completed: { label: "Completed", color: "bg-teal-50 text-[#005476] border-teal-200" },
  cancelled: { label: "Cancelled", color: "bg-red-50 text-red-600 border-red-200" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

// ── Minimal multi-select dropdown ─────────────────────────────────────────────

function MultiSelect({
  label, options, selected, onChange,
}: { label: string; options: { value: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between border rounded-md px-3 py-2 text-sm bg-white hover:bg-gray-50 transition-colors"
      >
        <span className="truncate text-left">
          {selected.length === 0
            ? <span className="text-muted-foreground">{label}</span>
            : selected.length === 1
              ? (options.find(o => o.value === selected[0])?.label ?? selected[0])
              : `${selected.length} selected`}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0 ml-1 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 ml-1 text-muted-foreground" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[180px] rounded-md border bg-popover shadow-lg">
          <div className="max-h-52 overflow-y-auto p-1">
            {options.map(opt => (
              <label key={opt.value} className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-accent text-sm select-none">
                <input
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  className="h-3.5 w-3.5 accent-[#3bcac4] shrink-0"
                />
                <span className="truncate">{opt.label}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="border-t p-1">
              <button type="button" onClick={() => { onChange([]); setOpen(false); }}
                className="w-full text-xs text-muted-foreground hover:text-destructive px-2 py-1 rounded hover:bg-accent transition-colors">
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Filter panel options ──────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "new",         label: "New" },
  { value: "contacted",   label: "Contacted" },
  { value: "interested",  label: "Interested" },
  { value: "not_interested", label: "Not Interested" },
  { value: "deal_closed", label: "Deal Closed" },
  { value: "follow_up",   label: "Follow Up" },
];
const SOURCE_OPTIONS = [
  { value: "manual",       label: "Manual" },
  { value: "facebook_ad",  label: "Facebook Ads" },
  { value: "whatsapp",     label: "WhatsApp" },
  { value: "website",      label: "Website" },
  { value: "referral",     label: "Referral" },
  { value: "instagram",    label: "Instagram" },
  { value: "tiktok",       label: "TikTok" },
];
const LEAD_SCORE_OPTIONS = [
  { value: "hot",  label: "🔥 Hot" },
  { value: "warm", label: "🌡️ Warm" },
  { value: "cold", label: "❄️ Cold" },
];
const AI_SCORE_OPTIONS = [
  { value: "HOT",  label: "AI Hot" },
  { value: "WARM", label: "AI Warm" },
  { value: "COLD", label: "AI Cold" },
  { value: "none", label: "Not scored" },
];
const QUAL_SCORE_OPTIONS = [
  { value: "1", label: "Score 1" },
  { value: "2", label: "Score 2" },
  { value: "3", label: "Score 3" },
  { value: "4", label: "Score 4" },
  { value: "5", label: "Score 5" },
  { value: "in_progress", label: "In Progress" },
  { value: "none", label: "Not Qualified" },
];
const WA_STAGE_OPTIONS = [
  { value: "new_lead",      label: "New Lead" },
  { value: "contacted",     label: "Contacted" },
  { value: "qualified",     label: "Qualified" },
  { value: "negotiating",   label: "Negotiating" },
  { value: "closed",        label: "Closed" },
];
const CONTACT_DATE_OPTIONS = [
  { value: "all",       label: "All time" },
  { value: "today",     label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7",     label: "Last 7 days" },
  { value: "last30",    label: "Last 30 days" },
  { value: "thisMonth", label: "This month" },
  { value: "prevMonth", label: "Previous month" },
];

// ── Filter panel ──────────────────────────────────────────────────────────────

function FilterPanel({
  filters,
  onChange,
}: { filters: FilterConfig; onChange: (f: FilterConfig) => void }) {
  const set = (key: keyof FilterConfig, value: any) => onChange({ ...filters, [key]: value });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {/* Search */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Search name/phone/email</Label>
        <Input
          placeholder="Search..."
          value={filters.search ?? ""}
          onChange={e => set("search", e.target.value || undefined)}
          className="h-9 text-sm"
        />
      </div>

      {/* Lead status */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Lead Status</Label>
        <MultiSelect
          label="Any status"
          options={STATUS_OPTIONS}
          selected={filters.status ?? []}
          onChange={v => set("status", v.length ? v : undefined)}
        />
      </div>

      {/* Source */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Lead Source</Label>
        <MultiSelect
          label="Any source"
          options={SOURCE_OPTIONS}
          selected={filters.source ?? []}
          onChange={v => set("source", v.length ? v : undefined)}
        />
      </div>

      {/* Lead score (hot/warm/cold) */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Lead Temperature</Label>
        <MultiSelect
          label="Any temperature"
          options={LEAD_SCORE_OPTIONS}
          selected={filters.leadScore ?? []}
          onChange={v => set("leadScore", v.length ? v : undefined)}
        />
      </div>

      {/* AI score */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">AI Score</Label>
        <MultiSelect
          label="Any AI score"
          options={AI_SCORE_OPTIONS}
          selected={filters.aiScore ?? []}
          onChange={v => set("aiScore", v.length ? v : undefined)}
        />
      </div>

      {/* WA qual score */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">WA Score</Label>
        <MultiSelect
          label="Any WA score"
          options={QUAL_SCORE_OPTIONS}
          selected={filters.qualScore ?? []}
          onChange={v => set("qualScore", v.length ? v : undefined)}
        />
      </div>

      {/* WA stage */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">WA Stage</Label>
        <MultiSelect
          label="Any WA stage"
          options={WA_STAGE_OPTIONS}
          selected={filters.waStage ?? []}
          onChange={v => set("waStage", v.length ? v : undefined)}
        />
      </div>

      {/* Interested country */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Interested Country</Label>
        <Input
          placeholder="e.g. Georgia, UAE"
          value={(filters.interestedCountry ?? []).join(", ")}
          onChange={e => {
            const vals = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
            set("interestedCountry", vals.length ? vals : undefined);
          }}
          className="h-9 text-sm"
        />
      </div>

      {/* City */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">City</Label>
        <Input
          placeholder="e.g. Batumi, Dubai"
          value={(filters.city ?? []).join(", ")}
          onChange={e => {
            const vals = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
            set("city", vals.length ? vals : undefined);
          }}
          className="h-9 text-sm"
        />
      </div>

      {/* Project interest */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Project Interest</Label>
        <Input
          placeholder="e.g. Orbi, Sheraton"
          value={(filters.projectInterest ?? []).join(", ")}
          onChange={e => {
            const vals = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
            set("projectInterest", vals.length ? vals : undefined);
          }}
          className="h-9 text-sm"
        />
      </div>

      {/* Contact date */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Contact Date</Label>
        <select
          className="w-full border rounded-md px-3 py-2 text-sm bg-white"
          value={filters.contactDate ?? "all"}
          onChange={e => set("contactDate", e.target.value === "all" ? undefined : e.target.value)}
        >
          {CONTACT_DATE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Empty filter check ────────────────────────────────────────────────────────

function hasActiveFilters(f: FilterConfig): boolean {
  return !!(
    f.search ||
    f.status?.length ||
    f.source?.length ||
    f.leadScore?.length ||
    f.aiScore?.length ||
    f.qualScore?.length ||
    f.waStage?.length ||
    f.interestedCountry?.length ||
    f.city?.length ||
    f.projectInterest?.length ||
    (f.contactDate && f.contactDate !== "all")
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BroadcastPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  // List of all broadcasts
  const { data: broadcasts = [], isLoading, refetch } = useQuery<Broadcast[]>({
    queryKey: ["/api/admin/broadcast"],
    refetchInterval: 15000,
  });

  // ── Dialog state ──────────────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Form state
  const [form, setForm] = useState({
    name: "",
    subject: "",
    body_html: "",
    image_url: "",
    batch_size: 10,
    batch_delay_ms: 600000,
  });
  const [filters, setFilters] = useState<FilterConfig>({});
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [imgUploading, setImgUploading] = useState(false);
  const [isRtl, setIsRtl] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);

  // Test send
  const [testEmail, setTestEmail] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testSent, setTestSent] = useState(false);

  // Recipients modal
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const [recipientsBroadcastId, setRecipientsBroadcastId] = useState<number | null>(null);

  // Confirm approve
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBroadcastId, setConfirmBroadcastId] = useState<number | null>(null);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/admin/broadcast", data),
    onSuccess: async (res: any) => {
      const bc = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcast"] });
      setEditingId(bc.id);
      setStep(2);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/admin/broadcast/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcast"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/broadcast/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcast"] });
      toast({ title: "Deleted", description: "Broadcast deleted." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const pauseMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/broadcast/${id}/pause`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcast"] }),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/broadcast/${id}/resume`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcast"] }),
  });

  const stopMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/broadcast/${id}/stop`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcast"] }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/broadcast/${id}/approve`),
    onSuccess: async (res: any) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcast"] });
      setConfirmOpen(false);
      toast({ title: "Broadcast started!", description: `Sending to ${data.recipients} recipients in batches of ${form.batch_size}.` });
      closeDialog();
    },
    onError: (err: any) => {
      setConfirmOpen(false);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingId(null);
    setStep(1);
    setForm({ name: "", subject: "", body_html: "", image_url: "", batch_size: 10, batch_delay_ms: 600000 });
    setFilters({});
    setRecipientCount(null);
    setTestSent(false);
    setTestEmail("");
    setDialogOpen(true);
  };

  const openEdit = (bc: Broadcast) => {
    setEditingId(bc.id);
    setStep(bc.status === "draft" ? 1 : bc.status === "test_sent" ? 2 : 3);
    setForm({
      name: bc.name,
      subject: bc.subject,
      body_html: bc.body_html,
      image_url: bc.image_url ?? "",
      batch_size: bc.batch_size,
      batch_delay_ms: bc.batch_delay_ms,
    });
    setFilters(bc.filter_config ?? {});
    setRecipientCount(bc.total_recipients > 0 ? bc.total_recipients : null);
    setTestSent(!!bc.test_sent_at);
    setTestEmail("");
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setStep(1);
    setRecipientCount(null);
    setTestSent(false);
  };

  const handleImageUpload = async (file: File) => {
    setImgUploading(true);
    try {
      const result = await uploadToCloudinary(file, "image");
      setForm(f => ({ ...f, image_url: result.secure_url }));
      toast({ title: "Image uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setImgUploading(false);
    }
  };

  const previewCount = useCallback(async () => {
    setCountLoading(true);
    try {
      const res = await apiRequest("POST", "/api/admin/broadcast/preview-count", { filters });
      const data = await res.json();
      setRecipientCount(data.count);
    } catch (err: any) {
      toast({ title: "Count failed", description: err.message, variant: "destructive" });
    } finally {
      setCountLoading(false);
    }
  }, [filters]);

  const saveStep1AndContinue = async () => {
    if (!form.name.trim()) return toast({ title: "Campaign name is required", variant: "destructive" });
    if (!form.subject.trim()) return toast({ title: "Subject is required", variant: "destructive" });
    if (!form.body_html.trim()) return toast({ title: "Body content is required", variant: "destructive" });

    if (editingId) {
      await updateMutation.mutateAsync({ id: editingId, data: { ...form, filter_config: filters } });
      setStep(2);
    } else {
      await createMutation.mutateAsync({ ...form, filter_config: filters });
    }
  };

  const saveStep2AndContinue = async () => {
    if (!editingId) return;
    await updateMutation.mutateAsync({ id: editingId, data: { filter_config: filters } });
    setStep(3);
  };

  const sendTest = async () => {
    if (!editingId) return;
    if (!testEmail.trim()) return toast({ title: "Enter an email for the test", variant: "destructive" });
    setTestSending(true);
    try {
      await updateMutation.mutateAsync({ id: editingId, data: { ...form, filter_config: filters } });
      const res = await apiRequest("POST", `/api/admin/broadcast/${editingId}/send-test`, {
        to_email: testEmail.trim(),
        first_name: user?.username ?? "Admin",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message ?? "Send failed");
      }
      setTestSent(true);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcast"] });
      toast({ title: "Test email sent!", description: `Sent to ${testEmail}` });
    } catch (err: any) {
      toast({ title: "Test send failed", description: err.message, variant: "destructive" });
    } finally {
      setTestSending(false);
    }
  };

  const confirmApprove = () => {
    if (!editingId) return;
    if (!testSent) return toast({ title: "Send a test email first", description: "You must test the campaign before bulk sending.", variant: "destructive" });
    setConfirmBroadcastId(editingId);
    setConfirmOpen(true);
  };

  // ── Progress stats ────────────────────────────────────────────────────────

  function progressPct(bc: Broadcast): number {
    if (!bc.total_recipients) return 0;
    return Math.round(((bc.sent_count + bc.failed_count) / bc.total_recipients) * 100);
  }

  const delayLabel = (ms: number) => {
    if (ms >= 3600000) return `${ms / 3600000}h`;
    if (ms >= 60000) return `${ms / 60000}m`;
    return `${ms / 1000}s`;
  };

  // ── Recipients viewer ─────────────────────────────────────────────────────

  const { data: recipientsData, isLoading: recipientsLoading } = useQuery<{
    recipients: any[]; total: number; page: number; limit: number;
  }>({
    queryKey: ["/api/admin/broadcast", recipientsBroadcastId, "recipients"],
    queryFn: async () => {
      if (!recipientsBroadcastId) return { recipients: [], total: 0, page: 1, limit: 50 };
      const res = await apiRequest("GET", `/api/admin/broadcast/${recipientsBroadcastId}/recipients?limit=100`);
      return res.json();
    },
    enabled: recipientsOpen && !!recipientsBroadcastId,
  });

  // ── Broadcast card ────────────────────────────────────────────────────────

  function BroadcastCard({ bc }: { bc: Broadcast }) {
    const pct = progressPct(bc);
    const isActive = bc.status === "running" || bc.status === "paused";
    const isDraftOrTest = bc.status === "draft" || bc.status === "test_sent";
    const isDeletable = ["draft", "test_sent", "cancelled", "completed"].includes(bc.status);

    return (
      <Card className="border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base font-semibold text-[#005476] truncate">{bc.name}</CardTitle>
                <StatusBadge status={bc.status} />
              </div>
              <p className="text-sm text-muted-foreground mt-0.5 truncate">{bc.subject}</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {isDraftOrTest && (
                <Button size="sm" variant="outline" onClick={() => openEdit(bc)} className="h-7 px-2 text-xs">
                  <Eye className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
              )}
              {isDeletable && (
                <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(bc.id)}
                  className="h-7 px-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { icon: Users, label: "Total", value: bc.total_recipients ?? 0, color: "text-[#005476]" },
              { icon: CheckCircle2, label: "Sent", value: bc.sent_count ?? 0, color: "text-emerald-600" },
              { icon: XCircle, label: "Failed", value: bc.failed_count ?? 0, color: "text-red-500" },
              { icon: Clock, label: "Pending", value: bc.pending_count ?? 0, color: "text-amber-600" },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className="bg-gray-50 rounded-lg p-2">
                <Icon className={`h-4 w-4 mx-auto mb-0.5 ${color}`} />
                <div className={`text-sm font-bold ${color}`}>{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>

          {/* Progress */}
          {bc.total_recipients > 0 && (
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Progress</span>
                <span>{pct}%</span>
              </div>
              <Progress value={pct} className="h-1.5" />
            </div>
          )}

          {/* Batch info */}
          <div className="text-xs text-muted-foreground flex gap-3">
            <span>Batch: {bc.batch_size} emails</span>
            <span>Delay: {delayLabel(bc.batch_delay_ms)}</span>
            {bc.test_sent_at && <span className="text-amber-600">✓ Test sent</span>}
          </div>

          {/* Controls */}
          <div className="flex gap-2 flex-wrap">
            {bc.status === "running" && (
              <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate(bc.id)}
                className="h-7 px-3 text-xs border-orange-200 text-orange-700 hover:bg-orange-50">
                <Pause className="h-3 w-3 mr-1" /> Pause
              </Button>
            )}
            {bc.status === "paused" && (
              <Button size="sm" variant="outline" onClick={() => resumeMutation.mutate(bc.id)}
                className="h-7 px-3 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                <Play className="h-3 w-3 mr-1" /> Resume
              </Button>
            )}
            {isActive && (
              <Button size="sm" variant="outline" onClick={() => stopMutation.mutate(bc.id)}
                className="h-7 px-3 text-xs border-red-200 text-red-600 hover:bg-red-50">
                <Square className="h-3 w-3 mr-1" /> Stop
              </Button>
            )}
            {bc.total_recipients > 0 && (
              <Button size="sm" variant="ghost" onClick={() => { setRecipientsBroadcastId(bc.id); setRecipientsOpen(true); }}
                className="h-7 px-3 text-xs text-muted-foreground hover:text-[#005476]">
                <Users className="h-3 w-3 mr-1" /> Recipients
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f0f9f9] to-white p-4 md:p-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center shadow-md">
              <RadioTower className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#005476]">Email Broadcast</h1>
              <p className="text-sm text-muted-foreground">Bulk email campaigns to CRM leads</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => refetch()} className="h-8 px-2">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              onClick={openCreate}
              className="h-8 px-4 text-sm font-semibold bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:opacity-90 text-white shadow-md"
            >
              <Plus className="h-4 w-4 mr-1.5" /> New Broadcast
            </Button>
          </div>
        </div>

        {/* Broadcast list */}
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 text-[#3bcac4] animate-spin" />
          </div>
        ) : broadcasts.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <RadioTower className="h-12 w-12 mx-auto mb-3 text-[#3bcac4] opacity-40" />
            <p className="text-lg font-medium">No broadcasts yet</p>
            <p className="text-sm mt-1">Create your first broadcast campaign to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {broadcasts.map(bc => <BroadcastCard key={bc.id} bc={bc} />)}
          </div>
        )}
      </div>

      {/* ── Create / Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#005476]">
              <RadioTower className="h-5 w-5 text-[#3bcac4]" />
              {editingId ? "Edit Broadcast" : "New Broadcast"}
            </DialogTitle>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-0 mb-4">
            {[
              { n: 1, label: "Campaign" },
              { n: 2, label: "Recipients" },
              { n: 3, label: "Send" },
            ].map(({ n, label }) => (
              <div key={n} className="flex items-center">
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${step === n ? "bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white" : step > n ? "bg-teal-50 text-[#005476]" : "bg-gray-100 text-gray-400"}`}>
                  <span>{n}</span>
                  <span>{label}</span>
                </div>
                {n < 3 && <div className={`w-6 h-px mx-0.5 ${step > n ? "bg-[#3bcac4]" : "bg-gray-200"}`} />}
              </div>
            ))}
          </div>

          {/* Step 1: Campaign details */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Campaign Name *</Label>
                <Input
                  placeholder="e.g. Summer 2026 Promotion"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Email Subject *</Label>
                <Input
                  placeholder="Enter email subject line"
                  value={form.subject}
                  onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                  className="mt-1"
                />
              </div>

              {/* Campaign image */}
              <div>
                <Label className="text-sm font-medium">Campaign Image (optional)</Label>
                <div className="mt-1 flex gap-2 items-start">
                  {form.image_url ? (
                    <div className="relative w-28 h-20 rounded-lg overflow-hidden border bg-gray-50 shrink-0">
                      <img src={form.image_url} alt="campaign" className="w-full h-full object-cover" />
                      <button onClick={() => setForm(f => ({ ...f, image_url: "" }))}
                        className="absolute top-1 right-1 bg-black/50 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-black/70">
                        ×
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => imgInputRef.current?.click()}
                      disabled={imgUploading}
                      className="w-28 h-20 rounded-lg border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-[#3bcac4] hover:text-[#3bcac4] transition-colors shrink-0"
                    >
                      {imgUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
                      <span className="text-xs">{imgUploading ? "Uploading…" : "Upload"}</span>
                    </button>
                  )}
                  <div className="flex-1">
                    <Input
                      placeholder="Or paste image URL"
                      value={form.image_url}
                      onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))}
                      className="text-sm"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Appears at the top of every email.</p>
                  </div>
                </div>
                <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ""; }} />
              </div>

              {/* Body */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-sm font-medium">Email Body *</Label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={isRtl} onChange={e => setIsRtl(e.target.checked)} className="accent-[#3bcac4]" />
                    RTL (Arabic/Hebrew)
                  </label>
                </div>
                <Textarea
                  placeholder="Write the email content. You can use HTML tags for formatting."
                  value={form.body_html}
                  onChange={e => setForm(f => ({ ...f, body_html: e.target.value }))}
                  rows={8}
                  dir={isRtl ? "rtl" : "ltr"}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">Supports basic HTML. The subject will appear as an &lt;h2&gt; inside the email.</p>
              </div>

              {/* Batch settings */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg">
                <div>
                  <Label className="text-xs text-muted-foreground">Emails per batch</Label>
                  <Input
                    type="number" min={1} max={50}
                    value={form.batch_size}
                    onChange={e => setForm(f => ({ ...f, batch_size: parseInt(e.target.value) || 10 }))}
                    className="mt-1 h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Delay between batches (minutes)</Label>
                  <Input
                    type="number" min={1} max={120}
                    value={Math.round(form.batch_delay_ms / 60000)}
                    onChange={e => setForm(f => ({ ...f, batch_delay_ms: (parseInt(e.target.value) || 10) * 60000 }))}
                    className="mt-1 h-8 text-sm"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeDialog}>Cancel</Button>
                <Button
                  onClick={saveStep1AndContinue}
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white hover:opacity-90"
                >
                  {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  Next: Recipients →
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 2: Recipients / Filters */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-[#005476]">
                <Filter className="h-4 w-4 text-[#3bcac4]" />
                Filter Recipients
                <span className="text-xs text-muted-foreground font-normal ml-1">
                  (Only CRM leads with a valid email are included)
                </span>
              </div>

              <FilterPanel filters={filters} onChange={setFilters} />

              {/* Count preview */}
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-gradient-to-r from-teal-50 to-white">
                <Mail className="h-5 w-5 text-[#3bcac4] shrink-0" />
                <div className="flex-1">
                  {recipientCount !== null ? (
                    <span className="text-sm">
                      <strong className="text-[#005476] text-lg">{recipientCount}</strong>
                      <span className="text-muted-foreground ml-1">
                        {recipientCount === 1 ? "lead" : "leads"} will receive this email
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {hasActiveFilters(filters)
                        ? "Click 'Preview count' to see how many leads match your filters."
                        : "No filters active — will send to all CRM leads with a valid email."}
                    </span>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={previewCount} disabled={countLoading}
                  className="shrink-0 border-[#3bcac4] text-[#3bcac4] hover:bg-teal-50">
                  {countLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                  Preview count
                </Button>
              </div>

              {recipientCount === 0 && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  No leads match the current filters. Adjust your selection.
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
                <Button
                  onClick={saveStep2AndContinue}
                  disabled={updateMutation.isPending}
                  className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white hover:opacity-90"
                >
                  {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  Next: Send →
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 3: Test & Send */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Summary card */}
              <div className="p-4 rounded-xl border bg-gradient-to-r from-teal-50 to-white space-y-2">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-[#3bcac4]" />
                  <span className="font-semibold text-[#005476] text-sm">{form.subject}</span>
                </div>
                {recipientCount !== null && (
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground"><strong>{recipientCount}</strong> recipients estimated</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {form.batch_size} emails every {Math.round(form.batch_delay_ms / 60000)} minutes
                  </span>
                </div>
              </div>

              {/* Email preview */}
              {form.body_html && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Email Preview</Label>
                  <div className="rounded-lg border overflow-hidden max-h-60 overflow-y-auto bg-white">
                    <iframe
                      srcDoc={`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;font-family:Arial,sans-serif}</style></head><body>
                        <div style="background:#f0f9f9;padding:20px">
                        <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
                          <div style="background:linear-gradient(135deg,#3bcac4,#005476);padding:24px;text-align:center">
                            <h1 style="color:#fff;margin:0;font-size:20px">Kinglike Luxury</h1>
                          </div>
                          ${form.image_url ? `<img src="${form.image_url}" style="width:100%;max-height:200px;object-fit:cover" />` : ""}
                          <div style="padding:20px;direction:${isRtl ? "rtl" : "ltr"}">
                            <h2 style="color:#005476;margin:0 0 12px">${form.subject}</h2>
                            <div style="color:#333;line-height:1.7">${form.body_html}</div>
                          </div>
                        </div></div>
                      </body></html>`}
                      className="w-full h-52 border-0"
                      sandbox="allow-same-origin"
                    />
                  </div>
                </div>
              )}

              {/* Test send */}
              <div className="p-4 rounded-xl border space-y-3">
                <div className="flex items-center gap-2">
                  <Send className="h-4 w-4 text-[#3bcac4]" />
                  <span className="font-medium text-sm text-[#005476]">Send Test Email</span>
                  {testSent && (
                    <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">✓ Test Sent</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  A test email must be sent and reviewed before bulk sending is unlocked.
                </p>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="test@example.com"
                    value={testEmail}
                    onChange={e => setTestEmail(e.target.value)}
                    className="flex-1 h-9 text-sm"
                  />
                  <Button size="sm" variant="outline" onClick={sendTest} disabled={testSending}
                    className="h-9 border-[#3bcac4] text-[#3bcac4] hover:bg-teal-50 shrink-0">
                    {testSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                    Send Test
                  </Button>
                </div>
              </div>

              {/* Approve / Send */}
              {!testSent && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Test email required before bulk send is enabled.
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
                <Button
                  onClick={confirmApprove}
                  disabled={!testSent || approveMutation.isPending}
                  className={`font-semibold ${testSent ? "bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white hover:opacity-90" : "opacity-50 cursor-not-allowed bg-gray-200 text-gray-500"}`}
                >
                  {approveMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  <Send className="h-4 w-4 mr-1.5" />
                  Start Bulk Send
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Final confirm dialog ── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[#005476] flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirm Bulk Send
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-muted-foreground space-y-2">
            <p>This will build the recipient list and start sending emails immediately.</p>
            {recipientCount !== null && (
              <p>Estimated: <strong className="text-[#005476]">{recipientCount} emails</strong> in batches of {form.batch_size} every {Math.round(form.batch_delay_ms / 60000)} minutes.</p>
            )}
            <p className="text-amber-700 font-medium">This action cannot be undone (you can pause or stop after it starts).</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              onClick={() => confirmBroadcastId && approveMutation.mutate(confirmBroadcastId)}
              disabled={approveMutation.isPending}
              className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white"
            >
              {approveMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Yes, Start Sending
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Recipients viewer ── */}
      <Dialog open={recipientsOpen} onOpenChange={setRecipientsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[#005476] flex items-center gap-2">
              <Users className="h-5 w-5 text-[#3bcac4]" />
              Recipient List
            </DialogTitle>
          </DialogHeader>
          {recipientsLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[#3bcac4]" /></div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{recipientsData?.total ?? 0} recipients total</p>
              <div className="divide-y max-h-96 overflow-y-auto rounded-lg border">
                {recipientsData?.recipients.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{r.email}</div>
                      {r.first_name && <div className="text-xs text-muted-foreground">{r.first_name}</div>}
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
