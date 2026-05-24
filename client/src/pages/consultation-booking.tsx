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
  MapPin, Building2, Users, TrendingUp, CreditCard, Loader2
} from "lucide-react";
import { Link } from "wouter";
import { ConsultationTimeSlot } from "@shared/schema";

const COUNTRIES = ["georgia", "turkey", "dubai", "north_cyprus"] as const;
const TYPES = ["investment", "viewing", "residency", "installment"] as const;
const METHODS = ["google_meet", "zoom", "whatsapp_video", "whatsapp_voice"] as const;

const typeIcons: Record<string, React.ElementType> = {
  investment: TrendingUp, viewing: Building2, residency: Users, installment: CreditCard
};
const methodIcons: Record<string, React.ElementType> = {
  google_meet: Monitor, zoom: Video, whatsapp_video: Video, whatsapp_voice: Phone
};

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
  const [customWhatsapp, setCustomWhatsapp] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [budget, setBudget] = useState("");
  const [notes, setNotes] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const isWhatsApp = consultationMethod === "whatsapp_video" || consultationMethod === "whatsapp_voice";

  const { data: slots = [], isLoading: slotsLoading } = useQuery<ConsultationTimeSlot[]>({
    queryKey: ["/api/consultation/slots", selectedDate],
    queryFn: () =>
      fetch(`/api/consultation/slots?date=${selectedDate}`).then(r => r.json()),
    enabled: !!selectedDate,
  });

  const bookMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/consultation/bookings", data),
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: (err: any) => {
      toast({ title: t("common.error", "Error"), description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!user || !selectedSlotId || !country || !consultationType || !consultationMethod) return;
    const whatsappContactNumber = isWhatsApp
      ? whatsappChoice === "different" ? customWhatsapp : user.phoneNumber
      : undefined;

    bookMutation.mutate({
      country,
      consultationType,
      consultationMethod,
      slotId: selectedSlotId,
      budget: budget || undefined,
      notes: notes || undefined,
      email: email || undefined,
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
      if (isWhatsApp && whatsappChoice === "different" && !customWhatsapp.trim()) return false;
      return true;
    }
    if (step === 3) return !!selectedSlotId;
    return true;
  };

  // Today's date as minimum
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
          <p className="text-gray-500 mb-6">{t("consultation.successMessage")}</p>
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

          {/* STEP 2: Method */}
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
                      onClick={() => { setConsultationMethod(method); setWhatsappChoice(null); setCustomWhatsapp(""); }}
                      className="w-full rounded-xl p-4 border-2 flex items-center gap-3 transition-all text-left"
                      style={{ borderColor: consultationMethod === method ? "#3bcac4" : "#e5e7eb", background: consultationMethod === method ? "#f0fdfc" : "#fff" }}
                    >
                      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: isWA ? "#25D366" : consultationMethod === method ? "linear-gradient(135deg, #3bcac4, #005476)" : "#f3f4f6" }}>
                        <Icon className="w-4 h-4 text-white" style={{ color: (!isWA && consultationMethod !== method) ? "#6b7280" : "#fff" }} />
                      </div>
                      <span className="font-medium text-[14px]" style={{ color: consultationMethod === method ? "#005476" : "#374151" }}>
                        {t(`consultation.methods.${method}`)}
                      </span>
                      {consultationMethod === method && <CheckCircle className="w-4 h-4 ml-auto" style={{ color: "#3bcac4" }} />}
                    </button>
                  );
                })}
              </div>

              {/* WhatsApp number logic */}
              {isWhatsApp && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-green-800 mb-1">{t("consultation.whatsappConfirmTitle")}</p>
                  <p className="text-xs text-green-700 mb-1">{t("consultation.whatsappQuestion")}</p>
                  <p className="text-sm font-bold text-gray-800 mb-3 font-mono" dir="ltr">{user.phoneNumber}</p>
                  <div className="flex gap-2 flex-col">
                    <button
                      onClick={() => setWhatsappChoice("same")}
                      className="w-full py-2.5 rounded-xl text-sm font-medium border-2 transition-all"
                      style={{ borderColor: whatsappChoice === "same" ? "#3bcac4" : "#d1fae5", background: whatsappChoice === "same" ? "#f0fdfc" : "#fff", color: whatsappChoice === "same" ? "#005476" : "#374151" }}
                    >
                      ✓ {t("consultation.useThisNumber")}
                    </button>
                    <button
                      onClick={() => setWhatsappChoice("different")}
                      className="w-full py-2.5 rounded-xl text-sm font-medium border-2 transition-all"
                      style={{ borderColor: whatsappChoice === "different" ? "#3bcac4" : "#d1fae5", background: whatsappChoice === "different" ? "#f0fdfc" : "#fff", color: whatsappChoice === "different" ? "#005476" : "#374151" }}
                    >
                      {t("consultation.useDifferentNumber")}
                    </button>
                  </div>
                  {whatsappChoice === "different" && (
                    <div className="mt-3">
                      <Input
                        value={customWhatsapp}
                        onChange={e => setCustomWhatsapp(e.target.value)}
                        placeholder={t("consultation.enterWhatsappNumber")}
                        dir="ltr"
                        className="border-green-300 focus:border-green-500"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Date + Slot */}
          {step === 3 && (
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-5 flex items-center gap-2">
                <Calendar className="w-5 h-5" style={{ color: "#3bcac4" }} />
                {t("consultation.date")}
              </h2>
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
                    <div className="flex justify-center py-6"><Loader2 className="animate-spin text-[#3bcac4] w-6 h-6" /></div>
                  ) : slots.length === 0 ? (
                    <p className="text-center text-gray-400 py-6 text-sm">{t("consultation.noSlotsForDate")}</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {slots.map(slot => (
                        <button
                          key={slot.id}
                          onClick={() => setSelectedSlotId(slot.id)}
                          className="rounded-xl p-3 border-2 text-center transition-all"
                          style={{ borderColor: selectedSlotId === slot.id ? "#3bcac4" : "#e5e7eb", background: selectedSlotId === slot.id ? "#f0fdfc" : "#fff" }}
                        >
                          <p className="font-bold text-[13px]" style={{ color: selectedSlotId === slot.id ? "#005476" : "#374151" }} dir="ltr">
                            {slot.startTime} – {slot.endTime}
                          </p>
                          {selectedSlotId === slot.id && (
                            <p className="text-[10px] font-medium mt-0.5" style={{ color: "#3bcac4" }}>✓</p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* STEP 4: Budget + Notes + Email */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4" style={{ color: "#3bcac4" }} />
                  {t("consultation.budget")}
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
                </label>
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder={t("consultation.notesPlaceholder")}
                  rows={3}
                  className="border-gray-200 focus:border-[#3bcac4] resize-none"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
                  <Mail className="w-4 h-4" style={{ color: "#3bcac4" }} />
                  {t("consultation.email")}
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t("consultation.emailPlaceholder")}
                  dir="ltr"
                  className="border-gray-200 focus:border-[#3bcac4]"
                />
              </div>

              {/* Summary */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Summary</p>
                {[
                  { label: t("consultation.country"), value: t(`consultation.countries.${country}`) },
                  { label: t("consultation.consultationType"), value: t(`consultation.types.${consultationType}`) },
                  { label: t("consultation.consultationMethod"), value: t(`consultation.methods.${consultationMethod}`) },
                  { label: t("consultation.date"), value: selectedDate },
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
                disabled={bookMutation.isPending}
                className="flex-1 text-white font-semibold"
                style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}
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
