import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Bot, Loader2, RefreshCw, ChevronDown, ChevronUp,
  MessageSquare, ShieldCheck, RotateCcw, Play, CheckCircle2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OpeningExample  { name: string; message: string }
interface RecoveryExample { scenario: string; name: string; message: string }
interface FlowStep        { step: number; topic: string; question: string }
interface SimTurn         { sender: "ai" | "lead"; text: string }

// ── Static data ────────────────────────────────────────────────────────────────

const AI_RULES_FORBIDDEN = [
  "No legal advice",
  "No tax advice",
  "No immigration / residency / citizenship advice",
  "No ROI or investment return promises",
  "No rental income guarantees",
  "No capital appreciation promises",
  "No preference for any country over another",
  "No preference for any city over another",
  "No preference for any project over another",
  "No developer website links",
  "No project links",
  "No external links of any kind",
];

const AI_RULES_REQUIRED = [
  "Always human, warm, and professional",
  "Arabic Modern Standard — natural, not robotic",
  "One question per message only",
  "First question is always: Investment / Residence / Holiday Home",
  "Opening never asks about country, city, or budget",
  "Short messages — WhatsApp friendly (≤4 lines)",
];

const QUALIFICATION_STEPS = [
  { step: 1, topic: "Goal" },
  { step: 2, topic: "Country" },
  { step: 3, topic: "City / Region" },
  { step: 4, topic: "Property Type" },
  { step: 5, topic: "Budget" },
  { step: 6, topic: "Payment Method" },
  { step: 7, topic: "Purchase Timeframe" },
  { step: 8, topic: "Best Call Time" },
];

// ── Collapsible section wrapper ───────────────────────────────────────────────

function Section({
  icon,
  title,
  badge,
  children,
  defaultOpen = false,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardHeader
        className="pb-3 cursor-pointer select-none bg-gradient-to-r from-[#005476]/5 to-[#3bcac4]/5 hover:from-[#005476]/10 hover:to-[#3bcac4]/10 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center shrink-0 text-white">
              {icon}
            </div>
            <CardTitle className="text-sm font-semibold text-[#005476]">{title}</CardTitle>
            {badge && (
              <Badge className="text-[10px] bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/30 font-normal">
                {badge}
              </Badge>
            )}
          </div>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {open && <CardContent className="pt-4">{children}</CardContent>}
    </Card>
  );
}

// ── Chat bubble ───────────────────────────────────────────────────────────────

function Bubble({ sender, text }: { sender: "ai" | "lead"; text: string }) {
  const isAi = sender === "ai";
  return (
    <div className={`flex ${isAi ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
        isAi
          ? "bg-gradient-to-br from-[#005476]/8 to-[#3bcac4]/8 text-[#005476] border border-[#3bcac4]/20"
          : "bg-[#005476] text-white"
      }`}>
        <div className="flex items-center gap-1.5 mb-1">
          {isAi && <Bot className="h-3 w-3 opacity-60 shrink-0" />}
          <span className="text-[10px] font-medium opacity-60">
            {isAi ? "AI (Khalid)" : "Lead (Omar — simulated)"}
          </span>
        </div>
        <span dir="rtl">{text}</span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WhatsappAiPreviewPage() {
  // ── ALL hooks must come first — no conditional returns before this block ──
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  const [openingExamples, setOpeningExamples]   = useState<OpeningExample[]>([]);
  const [recoveryExamples, setRecoveryExamples] = useState<RecoveryExample[]>([]);
  const [flowSteps, setFlowSteps]               = useState<FlowStep[]>([]);
  const [simTurns, setSimTurns]                 = useState<SimTurn[]>([]);

  // All mutations declared unconditionally (Rules of Hooks)
  const openingMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/whatsapp-ai/preview/opening", {}),
    onSuccess: (data: any) => setOpeningExamples(data.examples ?? []),
  });

  const recoveryMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/whatsapp-ai/preview/recovery", {}),
    onSuccess: (data: any) => setRecoveryExamples(data.examples ?? []),
  });

  const flowMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/whatsapp-ai/preview/flow", {}),
    onSuccess: (data: any) => setFlowSteps(data.steps ?? []),
  });

  const simulateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/whatsapp-ai/preview/simulate", {}),
    onSuccess: (data: any) => setSimTurns(data.turns ?? []),
  });

  useEffect(() => {
    if (!authLoading && user !== undefined && !user?.isAdmin) {
      navigate("/");
    }
  }, [authLoading, user, navigate]);

  // ── Guard: show spinner while auth resolves ────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50/50">
        <div className="flex flex-col items-center gap-3 text-[#005476]">
          <Loader2 className="h-8 w-8 animate-spin text-[#3bcac4]" />
          <p className="text-sm font-medium">Loading…</p>
        </div>
      </div>
    );
  }

  // ── Guard: not an admin ────────────────────────────────────────────────────
  if (!user?.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50/50">
        <div className="text-center text-muted-foreground">
          <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Admin access required.</p>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center shrink-0">
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-bold text-[#005476]">AI Message Preview Center</h1>
          <p className="text-xs text-muted-foreground">
            Inspect exactly what Khalid AI would send — no real messages are transmitted
          </p>
        </div>
        <Badge className="ml-auto text-[10px] bg-amber-50 text-amber-700 border border-amber-200">
          Draft Only — Phase 1
        </Badge>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">

        {/* ── Section 1: Opening Message Preview ─────────────────────────── */}
        <Section
          icon={<MessageSquare className="h-4 w-4" />}
          title="Opening Message Preview"
          badge="5 examples"
          defaultOpen
        >
          <p className="text-xs text-muted-foreground mb-4">
            These are the opening messages Khalid AI would send to brand-new leads. The first question
            is always about their goal (Investment / Residence / Holiday Home). Country, city, and
            budget are never asked in the first message.
          </p>

          <div className="bg-[#005476]/4 border border-[#3bcac4]/25 rounded-xl p-4 mb-4 text-sm" dir="rtl">
            <p className="text-[10px] font-semibold text-[#005476] mb-2 text-left" dir="ltr">Current template (default fallback):</p>
            <p className="text-[#005476] whitespace-pre-wrap leading-relaxed">
              {`مرحباً أستاذ {الاسم} 🌷\n\nأشكرك على اهتمامك بالعقارات معنا في Kinglike Luxury.\n\nأنا خالد من فريق Kinglike Luxury، وسأساعدك في العثور على الخيارات المناسبة حسب هدفك وميزانيتك.\n\nبدايةً، هل تبحث عن عقار بهدف الاستثمار أم السكن أم قضاء العطلات؟`}
            </p>
          </div>

          <Button
            size="sm"
            className="bg-gradient-to-r from-[#3bcac4] to-[#005476] gap-2 mb-5"
            disabled={openingMutation.isPending}
            onClick={() => openingMutation.mutate()}
          >
            {openingMutation.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>
              : <><RefreshCw className="h-3.5 w-3.5" /> Generate 5 Examples</>}
          </Button>

          {openingMutation.isError && (
            <p className="text-xs text-red-500 mb-3">Failed to generate — check OpenAI key.</p>
          )}

          {openingExamples.length > 0 && (
            <div className="space-y-4">
              {openingExamples.map((ex, i) => (
                <div key={i} className="border border-[#3bcac4]/20 rounded-xl p-4 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold text-[#005476] bg-[#3bcac4]/10 px-2 py-0.5 rounded-full">
                      Example #{i + 1}
                    </span>
                    <span className="text-xs text-muted-foreground">Lead Name: {ex.name}</span>
                  </div>
                  <p className="text-sm text-[#005476] whitespace-pre-wrap leading-relaxed" dir="rtl">
                    {ex.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── Section 2: No Answer 3 Recovery Preview ─────────────────────── */}
        <Section
          icon={<RotateCcw className="h-4 w-4" />}
          title="No Answer 3 Recovery Preview"
          badge="5 scenarios"
        >
          <p className="text-xs text-muted-foreground mb-4">
            These recovery messages are sent when a lead's CRM status changes to "No Answer 3".
            Messages are personalized based on known CRM data (city, country, or project interest).
            No blame, no pressure, no mention of "3 calls".
          </p>

          <Button
            size="sm"
            className="bg-gradient-to-r from-[#3bcac4] to-[#005476] gap-2 mb-5"
            disabled={recoveryMutation.isPending}
            onClick={() => recoveryMutation.mutate()}
          >
            {recoveryMutation.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>
              : <><RefreshCw className="h-3.5 w-3.5" /> Generate 5 Recovery Scenarios</>}
          </Button>

          {recoveryMutation.isError && (
            <p className="text-xs text-red-500 mb-3">Failed to generate — check OpenAI key.</p>
          )}

          {recoveryExamples.length > 0 && (
            <div className="space-y-4">
              {recoveryExamples.map((ex, i) => (
                <div key={i} className="border border-amber-200 rounded-xl p-4 bg-amber-50/50">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">
                      Scenario #{i + 1}
                    </span>
                    <span className="text-xs text-amber-700 font-medium">{ex.scenario}</span>
                    <span className="text-xs text-muted-foreground ml-auto">Lead: {ex.name}</span>
                  </div>
                  <p className="text-sm text-amber-900 whitespace-pre-wrap leading-relaxed" dir="rtl">
                    {ex.message}
                  </p>
                  <p className="text-[10px] text-amber-500 mt-2">Draft only — not sent via WhatsApp (Phase 1)</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── Section 3: Qualification Flow Preview ───────────────────────── */}
        <Section
          icon={<CheckCircle2 className="h-4 w-4" />}
          title="Qualification Flow Preview"
          badge="8 steps"
        >
          <p className="text-xs text-muted-foreground mb-4">
            The AI follows this fixed order — one question per message. Click to generate sample
            Arabic questions for each step.
          </p>

          <div className="grid grid-cols-1 gap-2 mb-4">
            {QUALIFICATION_STEPS.map(s => {
              const live = flowSteps.find(f => f.step === s.step);
              return (
                <div key={s.step} className="flex gap-3 items-start p-3 border border-[#3bcac4]/15 rounded-lg bg-white">
                  <span className="h-6 w-6 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {s.step}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#005476]">{s.topic}</p>
                    {live && (
                      <p className="text-sm text-[#005476]/80 mt-1 whitespace-pre-wrap" dir="rtl">
                        {live.question}
                      </p>
                    )}
                    {!live && flowMutation.isPending && (
                      <p className="text-xs text-muted-foreground mt-1 animate-pulse">Generating…</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <Button
            size="sm"
            className="bg-gradient-to-r from-[#3bcac4] to-[#005476] gap-2"
            disabled={flowMutation.isPending}
            onClick={() => flowMutation.mutate()}
          >
            {flowMutation.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>
              : <><RefreshCw className="h-3.5 w-3.5" /> {flowSteps.length ? "Regenerate Sample Questions" : "Generate Sample Questions"}</>}
          </Button>

          {flowMutation.isError && (
            <p className="text-xs text-red-500 mt-3">Failed to generate — check OpenAI key.</p>
          )}
        </Section>

        {/* ── Section 4: AI Rules ──────────────────────────────────────────── */}
        <Section
          icon={<ShieldCheck className="h-4 w-4" />}
          title="AI Behavior Rules"
          badge="active"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-bold text-emerald-700 mb-2 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Always Required
              </p>
              <ul className="space-y-1.5">
                {AI_RULES_REQUIRED.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#005476]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#3bcac4] mt-1.5 shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold text-red-600 mb-2">✕ Strictly Forbidden</p>
              <ul className="space-y-1.5">
                {AI_RULES_FORBIDDEN.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="bg-[#005476]/4 border border-[#3bcac4]/20 rounded-lg p-3">
            <p className="text-[10px] font-semibold text-[#005476] mb-1">If asked about sensitive topics:</p>
            <p className="text-xs text-[#005476]/80 italic" dir="rtl">
              "سيوضح لك المستشار المختص هذه التفاصيل بالكامل."
            </p>
          </div>
        </Section>

        {/* ── Section 5: Simulated Conversation ───────────────────────────── */}
        <Section
          icon={<Play className="h-4 w-4" />}
          title="Simulated Full Qualification Conversation"
          badge="test mode"
        >
          <p className="text-xs text-muted-foreground mb-4">
            Generates a realistic end-to-end conversation between Khalid AI and a simulated lead (Omar)
            interested in investing in Georgia. Shows the complete 8-step qualification flow.
          </p>

          <Button
            size="sm"
            className="bg-gradient-to-r from-[#3bcac4] to-[#005476] gap-2 mb-5"
            disabled={simulateMutation.isPending}
            onClick={() => simulateMutation.mutate()}
          >
            {simulateMutation.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating conversation…</>
              : <><Play className="h-3.5 w-3.5" /> {simTurns.length ? "Regenerate Conversation" : "Generate Simulated Conversation"}</>}
          </Button>

          {simulateMutation.isError && (
            <p className="text-xs text-red-500 mb-3">Failed to generate — check OpenAI key.</p>
          )}

          {simTurns.length > 0 && (
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1 border border-[#3bcac4]/15 rounded-xl p-4 bg-white">
              <div className="flex items-center gap-2 pb-2 border-b mb-2">
                <Bot className="h-3.5 w-3.5 text-[#005476]" />
                <span className="text-[10px] font-semibold text-[#005476]">
                  Simulated lead: Omar — investing in Georgia, budget $150k, cash payment
                </span>
                <Badge className="ml-auto text-[10px] bg-amber-50 text-amber-600 border border-amber-200">
                  Simulation only
                </Badge>
              </div>
              {simTurns.map((turn, i) => (
                <Bubble key={i} sender={turn.sender} text={turn.text} />
              ))}
              <div className="flex justify-center pt-2">
                <span className="text-[10px] text-muted-foreground bg-gray-50 px-3 py-1 rounded-full border">
                  Qualification complete — {simTurns.length} messages
                </span>
              </div>
            </div>
          )}
        </Section>

      </div>
    </div>
  );
}
