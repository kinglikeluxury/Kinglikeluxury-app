import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Video, Phone, Monitor, MessageSquare, ChevronRight, ChevronLeft,
  CheckCircle, Calendar, Clock, Globe, DollarSign, FileText, Mail,
  MapPin, Building2, Users, TrendingUp, CreditCard, Loader2, AlertCircle
} from "lucide-react";
import { Link } from "wouter";
import { ConsultationTimeSlot } from "@shared/schema";
import { CountryCodePicker } from "@/components/ui/country-code-picker";

const COUNTRIES = ["georgia", "turkey", "dubai", "north_cyprus"] as const;
const TYPES = ["investment", "viewing", "residency", "installment"] as const;
const METHODS = ["google_meet", "zoom", "whatsapp_video", "whatsapp_voice"] as const;

const typeIcons: Record<string, React.ElementType> = {
  investment: TrendingUp, viewing: Building2, residency: Users, installment: CreditCard
};
const methodIcons: Record<string, React.ElementType> = {
  google_meet: Monitor, zoom: Video, whatsapp_video: Video, whatsapp_voice: Phone
};

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export default function ConsultationBooking() {
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const search = useSearch();
  const { user } = useAuth();
  const { toast } = useToast();

  const params = new URLSearchParams(search);
  const propId = params.get("propertyId");
  const propTitle = params.get("propertyTitle");

  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 4;

  const [country, setCountry] = useState("");
  const [consultationType, setConsultationType] = useState("");
  const [consultationMethod, setConsultationMethod] = useState("");
  const [whatsappChoice, setWhatsappChoice] = useState<"same" | "different" | null>(null);
  const [customWhatsappDialCode, setCustomWhatsappDialCode] = useState("+971");
  const [customWhatsappLocal, setCustomWhatsappLocal] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [budget, setBudget] = useState("");
  const [notes, setNotes] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [aiPrefilled, setAiPrefilled] = useState(false);
  const [privacyConsent, setPrivacyConsent] = useState(false);

  // Pre-fill from AI conversation profile saved in sessionStorage
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("kl_ai_prefill");
      if (!raw) return;
      const profile = JSON.parse(raw);
      sessionStorage.removeItem("kl_ai_prefill");

      // Map AI country values to form country keys
      const countryMap: Record<string, string> = {
        georgia: "georgia", "georgia/batumi": "georgia", "georgia/tbilisi": "georgia",
        turkey: "turkey", istanbul: "turkey", antalya: "turkey", alanya: "turkey",
        "uae": "dubai", "uae/dubai": "dubai", dubai: "dubai",
        "north cyprus": "north_cyprus", "northern cyprus": "north_cyprus", cyprus: "north_cyprus",
      };
      if (profile.country) {
        const mapped = countryMap[(profile.country as string).toLowerCase().trim()];
        if (mapped) setCountry(mapped);
      }

      // Map AI goal to consultation type
      const goalMap: Record<string, string> = {
        investment: "investment", "rental income": "investment", residency: "residency",
        "holiday home": "viewing", viewing: "viewing", installments: "installment",
        "installment plan": "installment",
      };
      if (profile.goal) {
        const mapped = goalMap[(profile.goal as string).toLowerCase().trim()];
        if (mapped) setConsultationType(mapped);
      }

      if (profile.budget) setBudget(profile.budget as string);

      // Build a notes summary from the AI profile
      const notesParts: string[] = [];
      if (profile.goal) notesParts.push(`Goal: ${profile.goal}`);
      if (profile.country) notesParts.push(`Country: ${profile.country}`);
      if (profile.city) notesParts.push(`City: ${profile.city}`);
      if (profile.timeline) notesParts.push(`Timeline: ${profile.timeline}`);
      if (profile.interestedProject) notesParts.push(`Interested in: ${profile.interestedProject}`);
      if (profile.paymentPreference) notesParts.push(`Payment: ${profile.paymentPreference}`);
      if (profile.summary) notesParts.push(`\nAI Summary: ${profile.summary}`);
      if (notesParts.length > 0) setNotes(notesParts.join(" | "));

      if (profile.email) setEmail(profile.email as string);
      if (notesParts.length > 0) setAiPrefilled(true);
    } catch {}
  }, []);

  const isWhatsApp = consultationMethod === "whatsapp_video" || consultationMethod === "whatsapp_voice";
  const customWhatsapp = `${customWhatsappDialCode}${customWhatsappLocal.replace(/\s+/g, "")}`;

  const emailError = emailTouched && (!email || !isValidEmail(email));
  const emailValid = email && isValidEmail(email);

  const { data: slots = [], isLoading: slotsLoading } = useQuery<ConsultationTimeSlot[]>({
    queryKey: ["/api/consultation/slots", selectedDate],
    queryFn: () => fetch(`/api/consultation/slots?date=${selectedDate}`).then(r => r.json()),
    enabled: !!selectedDate,
  });

  const bookMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/consultation/bookings", data),
    onSuccess: () => setSubmitted(true),
    onError: (err: any) => {
      toast({ title: t("common.error", "Error"), description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!user || !selectedSlotId || !country || !consultationType || !consultationMethod) return;
    if (!emailValid) {
      setEmailTouched(true);
      toast({ title: "Email required", description: "Please enter a valid email address for booking confirmation.", variant: "destructive" });
      return;
    }
    const whatsappContactNumber = isWhatsApp
      ? (whatsappChoice === "different" ? customWhatsapp : user.phoneNumber)
      : undefined;

    bookMutation.mutate({
      country,
      consultationType,
      consultationMethod,
      slotId: selectedSlotId,
      budget: budget || undefined,
      notes: notes || undefined,
      email,
      whatsappContactNumber,
      propertyId: propId ? parseInt(propId) : undefined,
      propertyTitle: propTitle || undefined,
      userLanguage: i18n.language,
    });
  };

  const canProceed = () => {
    if (step === 1) return !!country && !!consultationType;
    if (step === 2) {
      if (!consultationMethod) return false;
      if (isWhatsApp && whatsappChoice === null) return false;
      if (isWhatsApp && whatsappChoice === "different" && !customWhatsappLocal.trim()) return false;
      return true;
    }
    if (step === 3) return !!selectedSlotId;
    // Step 4: email + privacy consent required
    return !!(emailValid && privacyConsent);
  };

  const today = new Date().toISOString().split("T")[0];

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}>
            <Calendar className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">{t("consultation.title")}</h2>
          <p className="text-gray-500 text-sm mb-6">{t("consultation.loginRequired")}</p>
          <Link href="/login">
            <Button className="w-full" style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}>
              {t("consultation.loginBtn")}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}>
            <CheckCircle className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">{t("consultation.success")}</h2>
          <p className="text-gray-500 mb-2">{t("consultation.successMessage")}</p>
          <p className="text-sm text-[#3bcac4] font-medium mb-6">📧 A confirmation email has been sent to {email}</p>
          <Button onClick={() => navigate("/")} style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }} className="w-full">
            {t("nav.home")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="text-white pt-8 pb-16 px-4" style={{ background: "linear-gradient(135deg, #3bcac4 0%, #005476 100%)" }}>
        <div className="max-w-lg mx-auto">
          {propTitle && (
            <div className="inline-flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1 text-xs font-medium mb-4">
              <Building2 className="w-3 h-3" />
              {t("consultation.forProperty")}
            </div>
          )}
          <h1 className="text-2xl font-bold mb-1">{t("consultation.title")}</h1>
          <p className="text-white/80 text-sm">{t("consultation.subtitle")}</p>
          {propTitle && <p className="text-white/90 text-sm mt-1 font-medium">📍 {propTitle}</p>}
        </div>
      </div>

      {/* Step progress */}
      <div className="max-w-lg mx-auto px-4 -mt-8 mb-4">
        <div className="bg-white rounded-2xl shadow-md p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {t("consultation.step")} {step} {t("consultation.of")} {TOTAL_STEPS}
            </span>
            <span className="text-xs font-medium" style={{ color: "#3bcac4" }}>
              {Math.round((step / TOTAL_STEPS) * 100)}%
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all duration-300"
              style={{ width: `${(step / TOTAL_STEPS) * 100}%`, background: "linear-gradient(90deg, #3bcac4, #005476)" }}
            />
          </div>
        </div>
      </div>

      {/* Form card */}
      <div className="max-w-lg mx-auto px-4 pb-24">
        <div className="bg-white rounded-2xl shadow-md p-6">

          {/* AI pre-fill notice — shown when redirected from AI Advisor */}
          {aiPrefilled && (
            <div className="mb-4 rounded-xl px-4 py-3 flex items-start gap-2"
              style={{ background: "rgba(59,202,196,0.08)", border: "1px solid rgba(59,202,196,0.3)" }}>
              <span className="text-[#3bcac4] text-base mt-0.5 flex-shrink-0">✦</span>
              <p className="text-xs text-[#005476] leading-relaxed">
                {i18n.language === "ar"
                  ? "تم تعبئة بعض الحقول تلقائياً من محادثتك مع المستشار الذكي. يمكنك مراجعتها وتعديلها."
                  : "Some fields were pre-filled from your AI Advisor conversation. Please review and adjust as needed."}
              </p>
            </div>
          )}

          {/* STEP 1: Country + Type */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-5 flex items-center gap-2">
                <Globe className="w-5 h-5" style={{ color: "#3bcac4" }} />
                {t("consultation.country")}
              </h2>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {COUNTRIES.map(c => (
                  <button
                    key={c}
                    onClick={() => setCountry(c)}
                    className="rounded-xl p-3 border-2 text-left transition-all"
                    style={{ borderColor: country === c ? "#3bcac4" : "#e5e7eb", background: country === c ? "#f0fdfc" : "#fff" }}
                  >
                    <span className="text-[13px] font-semibold" style={{ color: country === c ? "#005476" : "#374151" }}>
                      {t(`consultation.countries.${c}`)}
                    </span>
                  </button>
                ))}
              </div>

              <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5" style={{ color: "#3bcac4" }} />
                {t("consultation.consultationType")}
              </h2>
              <div className="space-y-2">
                {TYPES.map(type => {
                  const Icon = typeIcons[type];
                  return (
                    <button
                      key={type}
                      onClick={() => setConsultationType(type)}
                      className="w-full rounded-xl p-4 border-2 flex items-center gap-3 transition-all text-left"
                      style={{ borderColor: consultationType === type ? "#3bcac4" : "#e5e7eb", background: consultationType === type ? "#f0fdfc" : "#fff" }}
                    >
                      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: consultationType === type ? "linear-gradient(135deg, #3bcac4, #005476)" : "#f3f4f6" }}>
                        <Icon className="w-4 h-4" style={{ color: consultationType === type ? "#fff" : "#6b7280" }} />
                      </div>
                      <span className="font-medium text-[14px]" style={{ color: consultationType === type ? "#005476" : "#374151" }}>
                        {t(`consultation.types.${type}`)}
                      </span>
                      {consultationType === type && <CheckCircle className="w-4 h-4 ml-auto" style={{ color: "#3bcac4" }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2: Method + WhatsApp */}
          {step === 2 && (
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-5 flex items-center gap-2">
                <MessageSquare className="w-5 h-5" style={{ color: "#3bcac4" }} />
                {t("consultation.consultationMethod")}
              </h2>
              <div className="space-y-2 mb-6">
                {METHODS.map(method => {
                  const Icon = methodIcons[method];
                  const isWA = method === "whatsapp_video" || method === "whatsapp_voice";
                  return (
                    <button
                      key={method}
                      onClick={() => { setConsultationMethod(method); setWhatsappChoice(null); setCustomWhatsappLocal(""); }}
                      className="w-full rounded-xl p-4 border-2 flex items-center gap-3 transition-all text-left"
                      style={{ borderColor: consultationMethod === method ? "#3bcac4" : "#e5e7eb", background: consultationMethod === method ? "#f0fdfc" : "#fff" }}
                    >
                      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: isWA ? "#25D366" : consultationMethod === method ? "linear-gradient(135deg, #3bcac4, #005476)" : "#f3f4f6" }}>
                        <Icon className="w-4 h-4" style={{ color: (!isWA && consultationMethod !== method) ? "#6b7280" : "#fff" }} />
                      </div>
                      <span className="font-medium text-[14px]" style={{ color: consultationMethod === method ? "#005476" : "#374151" }}>
                        {t(`consultation.methods.${method}`)}
                      </span>
                      {consultationMethod === method && <CheckCircle className="w-4 h-4 ml-auto" style={{ color: "#3bcac4" }} />}
                    </button>
                  );
                })}
              </div>

              {/* WhatsApp number confirmation */}
              {isWhatsApp && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="text-sm font-bold text-green-800 mb-1">
                    💬 {t("consultation.whatsappConfirmTitle", "WhatsApp Contact Number")}
                  </p>
                  <p className="text-xs text-green-700 mb-1">
                    {t("consultation.whatsappQuestion", "Is this the WhatsApp number our team should use?")}
                  </p>
                  <p className="text-sm font-bold text-gray-800 mb-3 font-mono bg-white/70 rounded-lg px-3 py-2" dir="ltr">
                    {user.phoneNumber}
                  </p>
                  <div className="flex gap-2 flex-col">
                    <button
                      onClick={() => setWhatsappChoice("same")}
                      className="w-full py-2.5 rounded-xl text-sm font-medium border-2 transition-all flex items-center justify-center gap-2"
                      style={{ borderColor: whatsappChoice === "same" ? "#3bcac4" : "#d1fae5", background: whatsappChoice === "same" ? "#f0fdfc" : "#fff", color: whatsappChoice === "same" ? "#005476" : "#374151" }}
                    >
                      {whatsappChoice === "same" && <CheckCircle className="w-4 h-4 text-[#3bcac4]" />}
                      ✓ {t("consultation.useThisNumber", "Yes, use this number")}
                    </button>
                    <button
                      onClick={() => setWhatsappChoice("different")}
                      className="w-full py-2.5 rounded-xl text-sm font-medium border-2 transition-all flex items-center justify-center gap-2"
                      style={{ borderColor: whatsappChoice === "different" ? "#3bcac4" : "#d1fae5", background: whatsappChoice === "different" ? "#f0fdfc" : "#fff", color: whatsappChoice === "different" ? "#005476" : "#374151" }}
                    >
                      {whatsappChoice === "different" && <CheckCircle className="w-4 h-4 text-[#3bcac4]" />}
                      {t("consultation.useDifferentNumber", "No, use a different number")}
                    </button>
                  </div>
                  {whatsappChoice === "different" && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-green-700 font-medium">Enter the WhatsApp number to use for this booking:</p>
                      <div className="flex gap-2">
                        <CountryCodePicker value={customWhatsappDialCode} onChange={setCustomWhatsappDialCode} />
                        <Input
                          value={customWhatsappLocal}
                          onChange={e => setCustomWhatsappLocal(e.target.value)}
                          placeholder={t("consultation.enterWhatsappNumber", "50 123 4567")}
                          dir="ltr"
                          className="flex-1 border-green-300 focus:border-green-500"
                        />
                      </div>
                      {customWhatsappLocal && (
                        <p className="text-xs text-green-600 font-mono">
                          Will save as: {customWhatsapp}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Date + Slot */}
          {step === 3 && (
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2">
                <Calendar className="w-5 h-5" style={{ color: "#3bcac4" }} />
                {t("consultation.date")}
              </h2>
              <p className="text-xs text-gray-400 mb-4 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                All times are in <strong>Georgia Time (GMT+4)</strong> — available 10:00 AM – 8:00 PM
              </p>
              <input
                type="date"
                value={selectedDate}
                min={today}
                onChange={e => { setSelectedDate(e.target.value); setSelectedSlotId(null); }}
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:border-[#3bcac4] mb-6"
                dir="ltr"
              />

              {selectedDate && (
                <>
                  <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Clock className="w-5 h-5" style={{ color: "#3bcac4" }} />
                    {t("consultation.timeSlot")}
                  </h2>
                  {slotsLoading ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-3">
                      <Loader2 className="animate-spin text-[#3bcac4] w-7 h-7" />
                      <p className="text-xs text-gray-400">Loading available times…</p>
                    </div>
                  ) : slots.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center">
                      <Clock className="w-8 h-8 mx-auto mb-3 opacity-25 text-gray-400" />
                      <p className="text-sm font-medium text-gray-500">No available consultation times currently.</p>
                      <p className="text-xs text-gray-400 mt-1">Please try another date or contact our advisory team.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {slots.map(slot => {
                        const isSelected = selectedSlotId === slot.id;
                        return (
                          <button
                            key={slot.id}
                            onClick={() => setSelectedSlotId(slot.id)}
                            className="rounded-xl p-3 border-2 text-center transition-all active:scale-95"
                            style={{
                              borderColor: isSelected ? "#3bcac4" : "#e5e7eb",
                              background: isSelected ? "linear-gradient(135deg, #3bcac4 0%, #005476 100%)" : "#fff",
                            }}
                          >
                            <p className="font-bold text-[15px] leading-tight" style={{ color: isSelected ? "#fff" : "#005476" }} dir="ltr">
                              {slot.startTime}
                            </p>
                            <p className="text-[10px] mt-0.5 font-medium" style={{ color: isSelected ? "rgba(255,255,255,0.8)" : "#9ca3af" }} dir="ltr">
                              – {slot.endTime}
                            </p>
                            {isSelected && (
                              <div className="mt-1 flex justify-center">
                                <CheckCircle className="w-3 h-3 text-white opacity-90" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* STEP 4: Budget + Notes + Email (required) */}
          {step === 4 && (
            <div className="space-y-5">
              {/* Email — required, shown first */}
              <div>
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-1">
                  <Mail className="w-4 h-4" style={{ color: "#3bcac4" }} />
                  {t("consultation.email", "Email Address")}
                  <span className="text-red-500 text-xs font-bold ml-1">* Required</span>
                </label>
                <p className="text-xs text-gray-400 mb-2">Used only for booking confirmation and communication. Not used for login.</p>
                <Input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setEmailTouched(true); }}
                  onBlur={() => setEmailTouched(true)}
                  placeholder="your@email.com"
                  dir="ltr"
                  className={`${emailError ? "border-red-400 focus:border-red-500" : emailValid ? "border-green-400" : "border-gray-200 focus:border-[#3bcac4]"}`}
                />
                {emailError && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Please enter a valid email address
                  </p>
                )}
                {emailValid && (
                  <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    Confirmation will be sent to {email}
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4" style={{ color: "#3bcac4" }} />
                  {t("consultation.budget")}
                  <span className="text-gray-400 text-xs font-normal ml-1">(optional)</span>
                </label>
                <Input
                  value={budget}
                  onChange={e => setBudget(e.target.value)}
                  placeholder={t("consultation.budgetPlaceholder")}
                  dir="ltr"
                  className="border-gray-200 focus:border-[#3bcac4]"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4" style={{ color: "#3bcac4" }} />
                  {t("consultation.notes")}
                  <span className="text-gray-400 text-xs font-normal ml-1">(optional)</span>
                </label>
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder={t("consultation.notesPlaceholder")}
                  rows={3}
                  className="border-gray-200 focus:border-[#3bcac4] resize-none"
                />
              </div>

              {/* Privacy/Terms consent */}
              <div
                onClick={() => setPrivacyConsent(v => !v)}
                className="flex items-start gap-3 cursor-pointer rounded-xl border-2 p-4 transition-all select-none"
                style={{ borderColor: privacyConsent ? "#3bcac4" : "#e5e7eb", background: privacyConsent ? "#f0fdfc" : "#fafafa" }}
              >
                <div className="flex-shrink-0 mt-0.5">
                  <div className="w-5 h-5 rounded border-2 flex items-center justify-center transition-all"
                    style={{ borderColor: privacyConsent ? "#3bcac4" : "#d1d5db", background: privacyConsent ? "#3bcac4" : "transparent" }}>
                    {privacyConsent && <CheckCircle className="w-3 h-3 text-white" />}
                  </div>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">
                  I agree to be contacted by Kinglike Luxury Real Estate regarding this consultation request. I understand my information will be handled confidentially and not shared with third parties.{" "}
                  <span className="font-semibold text-[#005476]">* Required</span>
                </p>
              </div>

              {/* Summary */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Booking Summary</p>
                {[
                  { label: t("consultation.country"), value: t(`consultation.countries.${country}`) },
                  { label: t("consultation.consultationType"), value: t(`consultation.types.${consultationType}`) },
                  { label: t("consultation.consultationMethod"), value: t(`consultation.methods.${consultationMethod}`) },
                  { label: t("consultation.date"), value: selectedDate },
                  ...(isWhatsApp ? [{ label: "WhatsApp", value: whatsappChoice === "different" ? customWhatsapp : (user.phoneNumber || "") }] : []),
                ].map(item => (
                  <div key={item.label} className="flex justify-between text-sm">
                    <span className="text-gray-500">{item.label}</span>
                    <span className="font-medium text-gray-800">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex gap-3 mt-6">
            {step > 1 && (
              <Button
                variant="outline"
                onClick={() => setStep(s => s - 1)}
                className="flex-1 border-gray-200"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                {t("common.back", "Back")}
              </Button>
            )}
            {step < TOTAL_STEPS ? (
              <Button
                onClick={() => setStep(s => s + 1)}
                disabled={!canProceed()}
                className="flex-1 text-white font-semibold disabled:opacity-50"
                style={{ background: canProceed() ? "linear-gradient(135deg, #3bcac4, #005476)" : undefined }}
              >
                {t("common.next", "Next")}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={bookMutation.isPending || !emailValid || !privacyConsent}
                className="flex-1 text-white font-semibold disabled:opacity-50"
                style={{ background: (emailValid && privacyConsent && !bookMutation.isPending) ? "linear-gradient(135deg, #3bcac4, #005476)" : undefined }}
              >
                {bookMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t("consultation.submitting")}</>
                ) : t("consultation.submit")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
