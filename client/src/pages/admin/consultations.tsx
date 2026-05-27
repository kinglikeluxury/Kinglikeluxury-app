import { useState, type ElementType } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Calendar, Clock, Trash2, Plus, Phone, Mail, Globe, Building2,
  MessageSquare, CheckCircle, XCircle, Loader2, StickyNote, Link as LinkIcon,
  CreditCard, Video, Monitor, Send, Wifi, WifiOff, AlertTriangle
} from "lucide-react";
import { ConsultationTimeSlot, ConsultationBooking } from "@shared/schema";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-green-100 text-green-800",
  completed: "bg-blue-100 text-blue-800",
  cancelled: "bg-gray-100 text-gray-600",
  rejected: "bg-red-100 text-red-800",
};

const METHOD_ICONS: Record<string, ElementType> = {
  google_meet: Monitor,
  zoom: Video,
  whatsapp_video: Video,
  whatsapp_voice: Phone,
};

interface DeliveryBadgeProps {
  label: string;
  result?: { sent: boolean; error?: string; sid?: string; id?: number };
}

function DeliveryBadge({ label, result }: DeliveryBadgeProps) {
  if (!result) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${result.sent ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
      title={result.error || (result.sent ? "Delivered" : "Failed")}>
      {result.sent ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
      {label}: {result.sent ? "✓" : "✗"}
      {!result.sent && result.error && <span className="ml-0.5 opacity-70 truncate max-w-[120px]" title={result.error}>{result.error.slice(0, 30)}</span>}
    </span>
  );
}

export default function AdminConsultations() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"bookings" | "slots" | "test">("bookings");

  // Filters
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCountry, setFilterCountry] = useState("all");
  const [filterMethod, setFilterMethod] = useState("all");

  // New slot form
  const [newDate, setNewDate] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");

  // Inline booking update
  const [editingId, setEditingId] = useState<number | null>(null);
  const [meetingLinkInput, setMeetingLinkInput] = useState("");
  const [adminNotesInput, setAdminNotesInput] = useState("");

  // Delivery status map: bookingId → delivery
  const [deliveryStatus, setDeliveryStatus] = useState<Record<number, any>>({});

  // Test notification form
  const [testEmail, setTestEmail] = useState("");
  const [testUserId, setTestUserId] = useState("");
  const [testResult, setTestResult] = useState<any>(null);

  // Fetch bookings
  const { data: rawBookings, isLoading: bookingsLoading } = useQuery<ConsultationBooking[]>({
    queryKey: ["/api/admin/consultation/bookings", filterStatus, filterCountry, filterMethod],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterCountry !== "all") params.set("country", filterCountry);
      if (filterMethod !== "all") params.set("method", filterMethod);
      const res = await fetch(`/api/admin/consultation/bookings?${params}`);
      if (!res.ok) throw new Error("Forbidden");
      return res.json();
    },
    retry: false,
  });
  const bookings: ConsultationBooking[] = Array.isArray(rawBookings) ? rawBookings : [];

  // Fetch slots
  const { data: rawSlots, isLoading: slotsLoading } = useQuery<ConsultationTimeSlot[]>({
    queryKey: ["/api/admin/consultation/slots"],
    queryFn: async () => {
      const res = await fetch("/api/admin/consultation/slots");
      if (!res.ok) throw new Error("Forbidden");
      return res.json();
    },
    retry: false,
  });
  const slots: ConsultationTimeSlot[] = Array.isArray(rawSlots) ? rawSlots : [];

  // Generate slots date
  const [generateDate, setGenerateDate] = useState("");
  // Filter slots by date in the slots tab
  const [slotsDateFilter, setSlotsDateFilter] = useState("");

  const filteredSlots = slotsDateFilter ? slots.filter(s => s.date === slotsDateFilter) : slots;

  const addSlotMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/consultation/slots", { date: newDate, startTime: newStart, endTime: newEnd }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/consultation/slots"] });
      setNewDate(""); setNewStart(""); setNewEnd("");
      toast({ title: t("consultation.admin.slotAdded") });
    },
    onError: () => toast({ title: t("common.error", "Error"), variant: "destructive" }),
  });

  const generateSlotsMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/consultation/slots/generate", { date: generateDate }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/consultation/slots"] });
      const d = generateDate;
      setGenerateDate("");
      setSlotsDateFilter(d);
      toast({ title: `Generated ${result?.created ?? 0} slots for ${d} (Georgia Time 10:00 AM – 8:00 PM)` });
    },
    onError: () => toast({ title: t("common.error", "Error"), variant: "destructive" }),
  });

  const toggleSlotMutation = useMutation({
    mutationFn: ({ id, isAvailable }: { id: number; isAvailable: boolean }) =>
      apiRequest("PATCH", `/api/admin/consultation/slots/${id}/toggle`, { isAvailable }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/consultation/slots"] }),
    onError: () => toast({ title: t("common.error", "Error"), variant: "destructive" }),
  });

  const deleteSlotMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/consultation/slots/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/consultation/slots"] }),
  });

  const updateBookingMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/admin/consultation/bookings/${id}`, data),
    onSuccess: (result: any, variables: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/consultation/bookings"] });
      setEditingId(null);
      if (result?.delivery) {
        setDeliveryStatus(prev => ({ ...prev, [variables.id]: result.delivery }));
      }
      const d = result?.delivery;
      const emailOk = d?.email?.sent;
      const inAppOk = d?.inApp?.sent;
      const pushOk = d?.push?.sent;
      toast({
        title: "Booking updated",
        description: d
          ? `Email: ${emailOk ? "✓" : "✗"} | In-App: ${inAppOk ? "✓" : "✗"} | Push: ${pushOk ? "✓" : "✗"}`
          : "Updated successfully",
      });
    },
    onError: () => toast({ title: t("common.error", "Error"), variant: "destructive" }),
  });

  const testNotifMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/admin/test-notifications", {
        email: testEmail || undefined,
        userId: testUserId ? parseInt(testUserId) : undefined,
      }),
    onSuccess: (result: any) => {
      setTestResult(result);
      toast({ title: "Test sent — see results below" });
    },
    onError: () => toast({ title: "Test failed", variant: "destructive" }),
  });

  const updateStatus = (id: number, status: string, meetingLink?: string, adminNotes?: string) => {
    updateBookingMutation.mutate({ id, status, meetingLink, adminNotes });
  };

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="text-white px-4 pt-8 pb-6" style={{ background: "linear-gradient(135deg, #3bcac4 0%, #005476 100%)" }}>
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl font-bold">{t("consultation.admin.title")}</h1>
          <div className="flex items-center gap-4 mt-1">
            <p className="text-white/70 text-sm">{bookings.length} {t("consultation.admin.bookingsTab").toLowerCase()}</p>
            {bookings.filter(b => b.status === "pending").length > 0 && (
              <span className="bg-amber-400 text-amber-900 text-xs font-bold px-2.5 py-0.5 rounded-full">
                {bookings.filter(b => b.status === "pending").length} pending review
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-5xl mx-auto px-4">
        <div className="bg-white border-b flex overflow-x-auto">
          {(["bookings", "slots", "test"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3.5 text-sm font-semibold transition-colors border-b-2 whitespace-nowrap ${
                activeTab === tab ? "border-[#3bcac4] text-[#005476]" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab === "bookings" ? t("consultation.admin.bookingsTab")
                : tab === "slots" ? t("consultation.admin.slotsTab")
                : "🔔 Test Notifications"}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">

        {/* ── BOOKINGS TAB ── */}
        {activeTab === "bookings" && (
          <div>
            {/* Filters */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-5 flex flex-wrap gap-3">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-36 h-9 text-sm">
                  <SelectValue placeholder={t("consultation.admin.allStatuses")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("consultation.admin.allStatuses")}</SelectItem>
                  {["pending","confirmed","completed","cancelled","rejected"].map(s => (
                    <SelectItem key={s} value={s}>{t(`consultation.status.${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterCountry} onValueChange={setFilterCountry}>
                <SelectTrigger className="w-40 h-9 text-sm">
                  <SelectValue placeholder={t("consultation.admin.allCountries")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("consultation.admin.allCountries")}</SelectItem>
                  {["georgia","turkey","dubai","north_cyprus"].map(c => (
                    <SelectItem key={c} value={c}>{t(`consultation.countries.${c}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterMethod} onValueChange={setFilterMethod}>
                <SelectTrigger className="w-44 h-9 text-sm">
                  <SelectValue placeholder={t("consultation.admin.allMethods")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("consultation.admin.allMethods")}</SelectItem>
                  {["google_meet","zoom","whatsapp_video","whatsapp_voice"].map(m => (
                    <SelectItem key={m} value={m}>{t(`consultation.methods.${m}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Bookings list */}
            {bookingsLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="animate-spin w-8 h-8 text-[#3bcac4]" /></div>
            ) : bookings.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
                <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>{t("consultation.admin.noBookings")}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {bookings.map(b => {
                  const MethodIcon = METHOD_ICONS[b.consultationMethod] || MessageSquare;
                  const isWA = b.consultationMethod.startsWith("whatsapp");
                  const isEditing = editingId === b.id;
                  const ds = deliveryStatus[b.id];
                  return (
                    <div key={b.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs font-mono text-gray-400">#{b.id}</span>
                          <Badge className={`text-xs ${STATUS_COLORS[b.status]}`}>{t(`consultation.status.${b.status}`)}</Badge>
                          <div className="flex items-center gap-1.5 text-xs text-gray-600">
                            <MethodIcon className="w-3.5 h-3.5" />
                            {t(`consultation.methods.${b.consultationMethod}`)}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-gray-600">
                            <Globe className="w-3.5 h-3.5" />
                            {t(`consultation.countries.${b.country}`)}
                          </div>
                          <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full text-gray-600">
                            {t(`consultation.types.${b.consultationType}`)}
                          </span>
                        </div>
                        <span className="text-xs text-gray-400">{new Date(b.createdAt).toLocaleDateString()}</span>
                      </div>

                      {/* Delivery status badges (shown after action) */}
                      {ds && (
                        <div className="flex flex-wrap gap-2 mb-3 p-2 bg-gray-50 rounded-xl">
                          <DeliveryBadge label="Email" result={ds.email} />
                          <DeliveryBadge label="In-App" result={ds.inApp} />
                          <DeliveryBadge label="Push" result={ds.push} />
                        </div>
                      )}

                      {/* Details grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="w-4 h-4 text-[#3bcac4] flex-shrink-0" />
                          <div>
                            <p className="text-xs text-gray-400">{t("consultation.admin.userPhone")}</p>
                            <p className="font-medium text-gray-800 font-mono" dir="ltr">{b.userPhone}</p>
                          </div>
                        </div>
                        {b.whatsappContactNumber && (
                          <div className="flex items-center gap-2 text-sm">
                            <MessageSquare className="w-4 h-4 text-green-500 flex-shrink-0" />
                            <div>
                              <p className="text-xs text-gray-400">{t("consultation.admin.whatsappNumber")}</p>
                              <p className="font-medium text-gray-800 font-mono" dir="ltr">{b.whatsappContactNumber}</p>
                            </div>
                          </div>
                        )}
                        {b.email && (
                          <div className="flex items-center gap-2 text-sm">
                            <Mail className="w-4 h-4 text-[#3bcac4] flex-shrink-0" />
                            <div>
                              <p className="text-xs text-gray-400">{t("consultation.admin.email")}</p>
                              <p className="font-medium text-gray-800">{b.email}</p>
                            </div>
                          </div>
                        )}
                        {b.budget && (
                          <div className="flex items-center gap-2 text-sm">
                            <CreditCard className="w-4 h-4 text-[#3bcac4] flex-shrink-0" />
                            <div>
                              <p className="text-xs text-gray-400">{t("consultation.admin.budget")}</p>
                              <p className="font-medium text-gray-800">{b.budget}</p>
                            </div>
                          </div>
                        )}
                        {b.propertyTitle && (
                          <div className="flex items-center gap-2 text-sm">
                            <Building2 className="w-4 h-4 text-[#3bcac4] flex-shrink-0" />
                            <div>
                              <p className="text-xs text-gray-400">{t("consultation.admin.property")}</p>
                              <p className="font-medium text-gray-800">{b.propertyTitle}</p>
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-sm">
                          <Globe className="w-4 h-4 text-[#3bcac4] flex-shrink-0" />
                          <div>
                            <p className="text-xs text-gray-400">{t("consultation.admin.language")}</p>
                            <p className="font-medium text-gray-800 uppercase">{b.userLanguage}</p>
                          </div>
                        </div>
                      </div>

                      {b.notes && (() => {
                        const aiSummaryMatch = b.notes.match(/\nAI Summary:\s*([\s\S]+)$/);
                        const mainNotes = aiSummaryMatch ? b.notes.slice(0, b.notes.indexOf("\nAI Summary:")).trim() : b.notes;
                        const aiSummary = aiSummaryMatch ? aiSummaryMatch[1].trim() : null;
                        return (
                          <div className="mb-4 space-y-2">
                            {mainNotes && (
                              <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 flex gap-2">
                                <StickyNote className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                                {mainNotes}
                              </div>
                            )}
                            {aiSummary && (
                              <div className="rounded-xl p-3 text-sm flex gap-2" style={{ background: "rgba(59,202,196,0.08)", border: "1px solid rgba(59,202,196,0.25)" }}>
                                <span className="text-[#3bcac4] text-base flex-shrink-0 mt-0.5">✦</span>
                                <div>
                                  <p className="text-xs font-bold text-[#005476] mb-1">AI Advisor Summary</p>
                                  <p className="text-gray-600 text-xs leading-relaxed">{aiSummary}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {b.meetingLink && !isWA && (
                        <div className="bg-blue-50 rounded-xl p-3 mb-4 flex items-center gap-2 text-sm">
                          <LinkIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />
                          <a href={b.meetingLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline truncate">{b.meetingLink}</a>
                        </div>
                      )}

                      {/* Inline edit for confirming */}
                      {isEditing && (
                        <div className="bg-teal-50 rounded-xl p-4 mb-4 space-y-3 border border-teal-200">
                          {!isWA && (
                            <div>
                              <label className="text-xs font-semibold text-gray-600 mb-1 block">{t("consultation.admin.meetingLink")}</label>
                              <Input
                                value={meetingLinkInput}
                                onChange={e => setMeetingLinkInput(e.target.value)}
                                placeholder={t("consultation.admin.meetingLinkPlaceholder")}
                                dir="ltr"
                              />
                            </div>
                          )}
                          {isWA && (
                            <p className="text-sm text-green-700 bg-green-100 rounded-lg p-2">
                              💬 {t("consultation.admin.whatsappMessage")}
                            </p>
                          )}
                          <div>
                            <label className="text-xs font-semibold text-gray-600 mb-1 block">{t("consultation.admin.adminNotes")}</label>
                            <Input value={adminNotesInput} onChange={e => setAdminNotesInput(e.target.value)} />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => updateStatus(b.id, "confirmed", meetingLinkInput || undefined, adminNotesInput || undefined)}
                              disabled={updateBookingMutation.isPending}
                              style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}
                              className="text-white flex-1"
                            >
                              {updateBookingMutation.isPending
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <CheckCircle className="w-3 h-3 mr-1" />}
                              {t("consultation.admin.confirm")}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="flex-1">
                              {t("common.cancel", "Cancel")}
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Action buttons */}
                      {b.status === "pending" && !isEditing && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => { setEditingId(b.id); setMeetingLinkInput(b.meetingLink || ""); setAdminNotesInput(b.adminNotes || ""); }}
                            style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}
                            className="text-white text-xs"
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />{t("consultation.admin.confirm")}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => updateStatus(b.id, "rejected")} className="text-red-600 border-red-200 hover:bg-red-50 text-xs">
                            <XCircle className="w-3 h-3 mr-1" />{t("consultation.admin.reject")}
                          </Button>
                        </div>
                      )}
                      {b.status === "confirmed" && (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => updateStatus(b.id, "completed")} className="text-xs bg-blue-600 hover:bg-blue-700 text-white">
                            <CheckCircle className="w-3 h-3 mr-1" />{t("consultation.admin.complete")}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => updateStatus(b.id, "cancelled")} className="text-xs text-gray-600 border-gray-200">
                            {t("consultation.admin.cancel")}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── SLOTS TAB ── */}
        {activeTab === "slots" && (
          <div>
            {/* Auto-generate slots panel */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
              <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#3bcac4]" />
                Auto-Generate Daily Schedule
              </h3>
              <p className="text-xs text-gray-400 mb-4">Creates all 30-min slots from <strong>10:00 AM to 8:00 PM</strong> in <strong>Georgia Time (GMT+4)</strong> for the selected date. Slots auto-generate for users too — use this to pre-set or reset a day's schedule.</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <input type="date" value={generateDate} min={today} onChange={e => setGenerateDate(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#3bcac4]" dir="ltr" />
                <Button onClick={() => generateSlotsMutation.mutate()} disabled={!generateDate || generateSlotsMutation.isPending}
                  style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }} className="text-white whitespace-nowrap">
                  {generateSlotsMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  Generate 20 Slots
                </Button>
              </div>
            </div>

            {/* Manual slot form */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
              <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#3bcac4]" />
                {t("consultation.admin.addSlot")} <span className="text-xs font-normal text-gray-400">(manual)</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">{t("consultation.admin.slotDate")}</label>
                  <input type="date" value={newDate} min={today} onChange={e => setNewDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#3bcac4]" dir="ltr" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">{t("consultation.admin.slotStart")}</label>
                  <input type="time" value={newStart} onChange={e => setNewStart(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#3bcac4]" dir="ltr" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">{t("consultation.admin.slotEnd")}</label>
                  <input type="time" value={newEnd} onChange={e => setNewEnd(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#3bcac4]" dir="ltr" />
                </div>
              </div>
              <Button onClick={() => addSlotMutation.mutate()} disabled={!newDate || !newStart || !newEnd || addSlotMutation.isPending}
                style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }} className="text-white">
                {addSlotMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                {t("consultation.admin.addSlot")}
              </Button>
            </div>

            {/* Date filter for slots list */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4 flex flex-col sm:flex-row gap-3 items-center">
              <div className="flex items-center gap-2 flex-1">
                <Calendar className="w-4 h-4 text-[#3bcac4] flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700">Filter by date:</span>
                <input type="date" value={slotsDateFilter} onChange={e => setSlotsDateFilter(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3bcac4]" dir="ltr" />
              </div>
              {slotsDateFilter && (
                <Button size="sm" variant="outline" onClick={() => setSlotsDateFilter("")} className="text-xs text-gray-500 whitespace-nowrap">
                  Show all dates
                </Button>
              )}
            </div>

            {slotsLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="animate-spin w-8 h-8 text-[#3bcac4]" /></div>
            ) : slots.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
                <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>{t("consultation.admin.noSlots")}</p>
              </div>
            ) : filteredSlots.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-gray-400">
                <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No slots found for <strong>{slotsDateFilter}</strong></p>
                <p className="text-xs mt-1">Select a date above and use "Auto-Generate Daily Schedule" to create slots.</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {filteredSlots.map((slot, i) => (
                  <div key={slot.id} className={`flex items-center justify-between px-5 py-4 ${i > 0 ? "border-t border-gray-100" : ""}`}>
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: slot.isAvailable ? "linear-gradient(135deg, #3bcac4, #005476)" : "#f3f4f6" }}>
                        <Calendar className="w-4 h-4" style={{ color: slot.isAvailable ? "#fff" : "#9ca3af" }} />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800 text-sm" dir="ltr">{slot.date}</p>
                        <p className="text-xs text-gray-500 font-mono" dir="ltr">{slot.startTime} – {slot.endTime}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={slot.isAvailable ? "bg-green-100 text-green-700 text-xs" : "bg-gray-100 text-gray-500 text-xs"}>
                        {slot.isAvailable ? "Available" : "Blocked"}
                      </Badge>
                      <Button size="sm" variant="outline"
                        onClick={() => toggleSlotMutation.mutate({ id: slot.id, isAvailable: !slot.isAvailable })}
                        disabled={toggleSlotMutation.isPending}
                        className={`text-xs h-7 px-2 ${slot.isAvailable ? "text-amber-600 border-amber-200 hover:bg-amber-50" : "text-green-600 border-green-200 hover:bg-green-50"}`}>
                        {slot.isAvailable ? "Block" : "Unblock"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteSlotMutation.mutate(slot.id)}
                        disabled={deleteSlotMutation.isPending} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TEST NOTIFICATIONS TAB ── */}
        {activeTab === "test" && (
          <div className="max-w-lg">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2">
                <Send className="w-5 h-5 text-[#3bcac4]" />
                Test Notification Channels
              </h3>
              <p className="text-sm text-gray-500 mb-5">Send test messages to verify email and in-app notifications are working correctly.</p>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">✉️ Email address for email test</label>
                  <Input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)}
                    placeholder="test@example.com" dir="ltr" />
                  <p className="text-[10px] text-gray-400 mt-1">Leave empty to skip email.</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">🔔 User ID for in-app + push notification test</label>
                  <Input type="number" value={testUserId} onChange={e => setTestUserId(e.target.value)}
                    placeholder="User ID (e.g. 1)" dir="ltr" />
                  <p className="text-[10px] text-gray-400 mt-1">Leave empty to skip. User must have push enabled for push test to work.</p>
                </div>
              </div>

              <Button
                onClick={() => testNotifMutation.mutate()}
                disabled={testNotifMutation.isPending || (!testEmail && !testUserId)}
                style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}
                className="text-white w-full"
              >
                {testNotifMutation.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</>
                  : <><Send className="w-4 h-4 mr-2" />Send Test Notifications</>}
              </Button>

              {/* Test results */}
              {testResult && (
                <div className="mt-5 bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">Delivery Results</p>
                  <div className="space-y-2">
                    {Object.entries(testResult).map(([key, val]: [string, any]) => (
                      <div key={key} className="flex items-start gap-3">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${val.sent ? "bg-green-100" : "bg-red-100"}`}>
                          {val.sent
                            ? <CheckCircle className="w-3 h-3 text-green-600" />
                            : <XCircle className="w-3 h-3 text-red-600" />}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-800 capitalize">
                            {key === "email" ? "✉️ Email" : key === "inApp" ? "🔔 In-App" : key === "push" ? "📲 Push" : key}
                            <span className={`ml-2 text-xs font-bold ${val.sent ? "text-green-600" : "text-red-600"}`}>
                              {val.sent ? "SENT" : "FAILED"}
                            </span>
                          </p>
                          {val.sid && <p className="text-[11px] text-gray-500 font-mono">ID: {val.sid}</p>}
                          {val.error && (
                            <p className="text-[11px] text-red-500 flex items-center gap-1 mt-0.5">
                              <AlertTriangle className="w-3 h-3" />{val.error}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Env var status */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mt-4">
              <h4 className="font-semibold text-gray-700 text-sm mb-3">Environment Variable Status</h4>
              <div className="space-y-2 text-xs">
                {[
                  { name: "RESEND_API_KEY", note: "Email confirmations" },
                  { name: "VAPID_PUBLIC_KEY", note: "Web Push (PWA)" },
                  { name: "VAPID_PRIVATE_KEY", note: "Web Push (PWA)" },
                  { name: "VAPID_SUBJECT", note: "Web Push contact" },
                ].map(({ name, note }) => (
                  <div key={name} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
                    <span className="font-mono text-gray-600">{name}</span>
                    <span className="text-gray-400">— {note}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-3">Run a test and check server console for detailed delivery logs.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
