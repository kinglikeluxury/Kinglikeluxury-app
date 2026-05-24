import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Sparkles, Phone, Mail, Globe, MapPin, Target, DollarSign,
  Clock, MessageSquare, ChevronDown, ChevronUp, Flame, Thermometer,
  Snowflake, ExternalLink, CalendarDays, Loader2,
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
  hot: { label: "Hot", icon: Flame, bg: "bg-red-100", text: "text-red-700", border: "border-red-200" },
  warm: { label: "Warm", icon: Thermometer, bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200" },
  cold: { label: "Cold", icon: Snowflake, bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-200" },
};

function LeadCard({ lead, onConvert }: { lead: InvestorProfile; onConvert: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const score = SCORE_CONFIG[lead.leadScore as keyof typeof SCORE_CONFIG] || SCORE_CONFIG.cold;
  const ScoreIcon = score.icon;

  const waLink = (num: string) =>
    `https://wa.me/${num.replace(/\D/g, "")}`;

  const mailLink = (em: string) =>
    `mailto:${em}?subject=Kinglike Luxury — Investment Consultation`;

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${score.border}`}>
      {/* Header */}
      <div className="px-5 py-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${score.bg}`}>
            <ScoreIcon className={`w-5 h-5 ${score.text}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-[#005476]">{lead.username || `User #${lead.userId}`}</span>
              <Badge className={`text-[10px] px-2 py-0.5 ${score.bg} ${score.text} border-0`}>
                {score.label} Lead
              </Badge>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{new Date(lead.createdAt).toLocaleString()} · {lead.language?.toUpperCase()}</p>
          </div>
        </div>
        <button onClick={() => setExpanded((e) => !e)} className="text-gray-400 hover:text-[#3bcac4] flex-shrink-0 mt-1">
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>

      {/* Quick info row */}
      <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
        {lead.goal && (
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <Target className="w-3.5 h-3.5 text-[#3bcac4]" />
            <span className="truncate">{lead.goal}</span>
          </div>
        )}
        {lead.budget && (
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <DollarSign className="w-3.5 h-3.5 text-[#3bcac4]" />
            <span className="truncate">{lead.budget}</span>
          </div>
        )}
        {(lead.country || lead.city) && (
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <MapPin className="w-3.5 h-3.5 text-[#3bcac4]" />
            <span className="truncate">{[lead.country, lead.city].filter(Boolean).join(" · ")}</span>
          </div>
        )}
        {lead.timeline && (
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <Clock className="w-3.5 h-3.5 text-[#3bcac4]" />
            <span className="truncate">{lead.timeline}</span>
          </div>
        )}
        {lead.accountPhone && (
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <Phone className="w-3.5 h-3.5 text-[#3bcac4]" />
            <span className="truncate">{lead.accountPhone}</span>
          </div>
        )}
        {lead.email && (
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <Mail className="w-3.5 h-3.5 text-[#3bcac4]" />
            <span className="truncate">{lead.email}</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-5 pb-4 flex flex-wrap gap-2">
        {(lead.whatsappContactNumber || lead.accountPhone) && (
          <a
            href={waLink((lead.whatsappContactNumber || lead.accountPhone)!)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-green-50 text-green-700 px-3 py-1.5 rounded-lg border border-green-200 hover:bg-green-100"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            WhatsApp
          </a>
        )}
        {lead.email && (
          <a
            href={mailLink(lead.email)}
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-100"
          >
            <Mail className="w-3.5 h-3.5" />
            Email
          </a>
        )}
        <button
          onClick={() => onConvert(lead.id)}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border text-white border-[#005476]"
          style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}
        >
          <CalendarDays className="w-3.5 h-3.5" />
          Convert to Booking
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {lead.summary && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">AI Summary</p>
              <p className="text-sm text-gray-700 bg-gray-50 rounded-xl px-4 py-3 leading-relaxed">{lead.summary}</p>
            </div>
          )}
          {lead.interestedProject && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Interested Project</p>
              <p className="text-sm text-gray-700">{lead.interestedProject}</p>
            </div>
          )}
          {lead.paymentPreference && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Payment Preference</p>
              <p className="text-sm text-gray-700">{lead.paymentPreference}</p>
            </div>
          )}
          {lead.communicationMethod && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Preferred Communication</p>
              <p className="text-sm text-gray-700">{lead.communicationMethod}</p>
            </div>
          )}

          {/* Full conversation */}
          {lead.conversation && lead.conversation.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Full Conversation</p>
              <div className="space-y-2 max-h-60 overflow-y-auto bg-gray-50 rounded-xl p-3">
                {lead.conversation.map((msg, i) => (
                  <div key={i} className={`text-xs ${msg.role === "user" ? "text-right" : "text-left"}`}>
                    <span className={`inline-block px-3 py-2 rounded-xl max-w-[85%] ${
                      msg.role === "user" ? "bg-[#005476] text-white" : "bg-white border border-gray-200 text-gray-700"
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
  const { t } = useTranslation();
  const [filter, setFilter] = useState<"all" | "hot" | "warm" | "cold">("all");

  const { data: leads = [], isLoading } = useQuery<InvestorProfile[]>({
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

  const handleConvert = (profileId: number) => {
    navigate("/consultation");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="text-white px-4 pt-8 pb-6" style={{ background: "linear-gradient(135deg, #3bcac4 0%, #005476 100%)" }}>
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6" />
            AI Investment Leads
          </h1>
          <p className="text-white/70 text-sm mt-1">{leads.length} total leads collected</p>

          {/* Score tabs */}
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

      <div className="max-w-4xl mx-auto px-4 py-6">
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin w-8 h-8 text-[#3bcac4]" /></div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <Sparkles className="w-16 h-16 mx-auto mb-4 text-gray-200" />
            <p className="text-gray-400 font-medium">No AI leads yet</p>
            <p className="text-gray-300 text-sm mt-1">Leads appear here when users complete conversations with the AI advisor</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((lead) => (
              <LeadCard key={lead.id} lead={lead} onConvert={handleConvert} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
