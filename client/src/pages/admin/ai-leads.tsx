import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Sparkles, Phone, Mail, Globe, MapPin, Target, DollarSign,
  Clock, MessageSquare, ChevronDown, ChevronUp, Flame, Thermometer,
  Snowflake, CalendarDays, Loader2, CreditCard, Zap, User,
  ArrowRight, RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface InvestorProfile {
  id: number;
  userId: number;
  accountPhone: string | null;
  whatsappContactNumber: string | null;
  email: string | null;
  language: string | null;
  goal: string | null;
  budget: string | null;
  paymentPreference: string | null;
  country: string | null;
  city: string | null;
  interestedProject: string | null;
  timeline: string | null;
  communicationMethod: string | null;
  summary: string | null;
  leadScore: string | null;
  createdAt: string;
  updatedAt: string;
  username?: string;
  conversation?: { role: string; content: string; createdAt: string }[];
}

const SCORE_CONFIG = {
  hot: { label: "Hot", icon: Flame, bg: "bg-red-50", text: "text-red-600", border: "border-red-200", dot: "bg-red-500" },
  warm: { label: "Warm", icon: Thermometer, bg: "bg-amber-50", text: "text-amber-600", border: "border-amber-200", dot: "bg-amber-500" },
  cold: { label: "Cold", icon: Snowflake, bg: "bg-sky-50", text: "text-sky-600", border: "border-sky-200", dot: "bg-sky-400" },
};

function parseSummaryField(summary: string | null, field: string): string | null {
  if (!summary) return null;
  const regex = new RegExp(`${field}:\\s*([^.]+)`, "i");
  const match = summary.match(regex);
  return match ? match[1].trim() : null;
}

function extractNextAction(summary: string | null): string | null {
  return parseSummaryField(summary, "NEXT ACTION");
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 text-[#3bcac4] flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <span className="text-[10px] text-gray-400 uppercase tracking-wide block">{label}</span>
        <span className="text-xs text-gray-700 break-words">{value}</span>
      </div>
    </div>
  );
}

function LeadCard({ lead, onConvert }: { lead: InvestorProfile; onConvert: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const score = SCORE_CONFIG[lead.leadScore as keyof typeof SCORE_CONFIG] || SCORE_CONFIG.cold;
  const ScoreIcon = score.icon;
  const nextAction = extractNextAction(lead.summary);

  const waLink = (num: string) =>
    `https://wa.me/${num.replace(/\D/g, "")}?text=Hello%20from%20Kinglike%20Luxury%20—%20following%20up%20on%20your%20real%20estate%20interest.`;

  const mailLink = (em: string) =>
    `mailto:${em}?subject=Kinglike Luxury — Your Investment Consultation`;

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-shadow hover:shadow-md ${score.border}`}>
      {/* Header */}
      <div className="px-5 py-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${score.bg}`}>
            <ScoreIcon className={`w-5 h-5 ${score.text}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-[#005476]">{lead.username || `User #${lead.userId}`}</span>
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${score.bg} ${score.text} ${score.border}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${score.dot}`} />
                {score.label} Lead
              </span>
              {lead.language && (
                <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full uppercase">{lead.language}</span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {new Date(lead.updatedAt).toLocaleString()}
            </p>
          </div>
        </div>
        <button onClick={() => setExpanded((e) => !e)} className="text-gray-400 hover:text-[#3bcac4] flex-shrink-0 mt-1 transition-colors">
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>

      {/* Quick info grid */}
      <div className="px-5 pb-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
        <InfoRow icon={Target} label="Goal" value={lead.goal} />
        <InfoRow icon={DollarSign} label="Budget" value={lead.budget} />
        <InfoRow icon={MapPin} label="Location" value={[lead.country, lead.city].filter(Boolean).join(" · ") || null} />
        <InfoRow icon={Clock} label="Timeline" value={lead.timeline} />
        <InfoRow icon={CreditCard} label="Payment" value={lead.paymentPreference} />
        <InfoRow icon={MessageSquare} label="Communication" value={lead.communicationMethod} />
        <InfoRow icon={Phone} label="Phone" value={lead.whatsappContactNumber || lead.accountPhone} />
        <InfoRow icon={Mail} label="Email" value={lead.email} />
        {lead.interestedProject && (
          <InfoRow icon={Sparkles} label="Interested Project" value={lead.interestedProject} />
        )}
      </div>

      {/* Next Action banner — most important for sales team */}
      {nextAction && (
        <div className="mx-5 mb-3 px-4 py-2.5 rounded-xl flex items-start gap-2.5"
          style={{ background: "linear-gradient(135deg, rgba(59,202,196,0.10), rgba(0,84,118,0.08))", border: "1px solid rgba(59,202,196,0.25)" }}>
          <Zap className="w-4 h-4 text-[#3bcac4] flex-shrink-0 mt-0.5" />
          <div>
            <span className="text-[10px] font-semibold text-[#005476] uppercase tracking-wide block">Suggested Next Action</span>
            <span className="text-sm text-[#005476] font-medium">{nextAction}</span>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="px-5 pb-4 flex flex-wrap gap-2">
        {(lead.whatsappContactNumber || lead.accountPhone) && (
          <a
            href={waLink((lead.whatsappContactNumber || lead.accountPhone)!)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold bg-green-50 text-green-700 px-3 py-2 rounded-xl border border-green-200 hover:bg-green-100 transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Contact on WhatsApp
          </a>
        )}
        {lead.email && (
          <a
            href={mailLink(lead.email)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold bg-blue-50 text-blue-700 px-3 py-2 rounded-xl border border-blue-200 hover:bg-blue-100 transition-colors"
          >
            <Mail className="w-3.5 h-3.5" />
            Send Email
          </a>
        )}
        <button
          onClick={() => onConvert(lead.id)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border text-white border-[#005476] hover:opacity-90 transition-opacity"
          style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}
        >
          <CalendarDays className="w-3.5 h-3.5" />
          Convert to Booking
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {/* Full AI summary */}
          {lead.summary && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> AI Summary (Admin Only)
              </p>
              <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5">
                {["GOAL", "BUDGET", "LOCATION", "SERIOUSNESS", "COMMUNICATION", "NEXT ACTION"].map((field) => {
                  const val = parseSummaryField(lead.summary, field);
                  if (!val) return null;
                  return (
                    <div key={field} className="flex items-start gap-2">
                      <span className="text-[10px] font-bold text-[#005476] uppercase w-28 flex-shrink-0 pt-0.5">{field}:</span>
                      <span className="text-xs text-gray-700">{val}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Full conversation */}
          {lead.conversation && lead.conversation.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                <MessageSquare className="w-3 h-3" /> Full Conversation ({lead.conversation.length} messages)
              </p>
              <div className="space-y-2 max-h-72 overflow-y-auto bg-gray-50 rounded-xl p-3">
                {lead.conversation.map((msg, i) => (
                  <div key={i} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                      msg.role === "user" ? "bg-[#005476]" : "bg-[#3bcac4]"
                    }`}>
                      {msg.role === "user"
                        ? <User className="w-3 h-3 text-white" />
                        : <Sparkles className="w-3 h-3 text-white" />}
                    </div>
                    <span className={`inline-block text-xs px-3 py-2 rounded-xl max-w-[82%] leading-relaxed ${
                      msg.role === "user"
                        ? "bg-[#005476] text-white rounded-tr-sm"
                        : "bg-white border border-gray-200 text-gray-700 rounded-tl-sm"
                    }`}>
                      {msg.content}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AiLeadsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<"all" | "hot" | "warm" | "cold">("all");

  const { data: leads = [], isLoading, refetch, isFetching } = useQuery<InvestorProfile[]>({
    queryKey: ["/api/admin/ai-leads"],
    enabled: !!user?.isAdmin,
    refetchInterval: 30_000,
  });

  if (!user?.isAdmin) { navigate("/"); return null; }

  const filtered = filter === "all" ? leads : leads.filter((l) => l.leadScore === filter);
  const counts = {
    all: leads.length,
    hot: leads.filter((l) => l.leadScore === "hot").length,
    warm: leads.filter((l) => l.leadScore === "warm").length,
    cold: leads.filter((l) => l.leadScore === "cold").length,
  };

  const handleConvert = (_profileId: number) => {
    navigate("/consultation");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="text-white px-4 pt-8 pb-6" style={{ background: "linear-gradient(135deg, #3bcac4 0%, #005476 100%)" }}>
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Sparkles className="w-6 h-6" />
                AI Investment Leads
              </h1>
              <p className="text-white/70 text-sm mt-1">{leads.length} total leads collected</p>
            </div>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-2 rounded-xl transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            {(["hot", "warm", "cold"] as const).map((s) => {
              const cfg = SCORE_CONFIG[s];
              return (
                <div key={s} className="bg-white/10 rounded-xl px-3 py-2 text-center">
                  <div className="text-xl font-bold">{counts[s]}</div>
                  <div className="text-white/70 text-xs">{cfg.label} Leads</div>
                </div>
              );
            })}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 mt-4 flex-wrap">
            {(["all", "hot", "warm", "cold"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  filter === s ? "bg-white text-[#005476]" : "bg-white/20 text-white hover:bg-white/30"
                }`}
              >
                {s === "all" ? `All (${counts.all})` : `${s.charAt(0).toUpperCase() + s.slice(1)} (${counts[s]})`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lead cards */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin w-8 h-8 text-[#3bcac4]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <Sparkles className="w-16 h-16 mx-auto mb-4 text-gray-200" />
            <p className="text-gray-400 font-medium">No {filter === "all" ? "" : filter + " "}AI leads yet</p>
            <p className="text-gray-300 text-sm mt-1">Leads appear here when users complete conversations with the AI advisor</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-gray-400 font-medium">
              Showing {filtered.length} {filter === "all" ? "" : filter + " "}lead{filtered.length !== 1 ? "s" : ""}
              {filter !== "all" && (
                <button onClick={() => setFilter("all")} className="ml-2 text-[#3bcac4] hover:underline">
                  Show all <ArrowRight className="w-3 h-3 inline" />
                </button>
              )}
            </p>
            {filtered.map((lead) => (
              <LeadCard key={lead.id} lead={lead} onConvert={handleConvert} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
