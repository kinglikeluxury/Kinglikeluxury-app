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
  Users, TrendingUp, CreditCard, Video, Monitor
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

export default function AdminConsultations() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"bookings" | "slots">("bookings");

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

  const addSlotMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/consultation/slots", { date: newDate, startTime: newStart, endTime: newEnd }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/consultation/slots"] });
      setNewDate(""); setNewStart(""); setNewEnd("");
      toast({ title: t("consultation.admin.slotAdded") });
    },
    onError: () => toast({ title: t("common.error", "Error"), variant: "destructive" }),
  });

  const deleteSlotMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/consultation/slots/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/consultation/slots"] }),
  });

  const updateBookingMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/admin/consultation/bookings/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/consultation/bookings"] });
      setEditingId(null);
      toast({ title: "Updated successfully" });
    },
    onError: () => toast({ title: t("common.error", "Error"), variant: "destructive" }),
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
          <p className="text-white/70 text-sm mt-1">{bookings.length} {t("consultation.admin.bookingsTab").toLowerCase()}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-5xl mx-auto px-4 -mt-px">
        <div className="bg-white rounded-t-none border-b flex">
          {(["bookings", "slots"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3.5 text-sm font-semibold transition-colors border-b-2 ${
                activeTab === tab ? "border-[#3bcac4] text-[#005476]" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab === "bookings" ? t("consultation.admin.bookingsTab") : t("consultation.admin.slotsTab")}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">

        {/* BOOKINGS TAB */}
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
                  const isWA = b.consultationMethod === "whatsapp_video" || b.consultationMethod === "whatsapp_voice";
                  const isEditing = editingId === b.id;
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
                        <span className="text-xs text-gray-400">
                          {new Date(b.createdAt).toLocaleDateString()}
                        </span>
                      </div>

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

                      {b.notes && (
                        <div className="bg-gray-50 rounded-xl p-3 mb-4 text-sm text-gray-700 flex gap-2">
                          <StickyNote className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                          {b.notes}
                        </div>
                      )}

                      {b.meetingLink && !isWA && (
                        <div className="bg-blue-50 rounded-xl p-3 mb-4 flex items-center gap-2 text-sm">
                          <LinkIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />
                          <a href={b.meetingLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline truncate">{b.meetingLink}</a>
                        </div>
                      )}

                      {/* Inline edit (for confirming) */}
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
                              {updateBookingMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}
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

        {/* SLOTS TAB */}
        {activeTab === "slots" && (
          <div>
            {/* Add slot form */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
              <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#3bcac4]" />
                {t("consultation.admin.addSlot")}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">{t("consultation.admin.slotDate")}</label>
                  <input
                    type="date"
                    value={newDate}
                    min={today}
                    onChange={e => setNewDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#3bcac4]"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">{t("consultation.admin.slotStart")}</label>
                  <input
                    type="time"
                    value={newStart}
                    onChange={e => setNewStart(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#3bcac4]"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">{t("consultation.admin.slotEnd")}</label>
                  <input
                    type="time"
                    value={newEnd}
                    onChange={e => setNewEnd(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#3bcac4]"
                    dir="ltr"
                  />
                </div>
              </div>
              <Button
                onClick={() => addSlotMutation.mutate()}
                disabled={!newDate || !newStart || !newEnd || addSlotMutation.isPending}
                style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}
                className="text-white"
              >
                {addSlotMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                {t("consultation.admin.addSlot")}
              </Button>
            </div>

            {/* Slots list */}
            {slotsLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="animate-spin w-8 h-8 text-[#3bcac4]" /></div>
            ) : slots.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
                <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>{t("consultation.admin.noSlots")}</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {slots.map((slot, i) => (
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
                    <div className="flex items-center gap-3">
                      <Badge className={slot.isAvailable ? "bg-green-100 text-green-700 text-xs" : "bg-gray-100 text-gray-500 text-xs"}>
                        {slot.isAvailable ? "Available" : "Booked"}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteSlotMutation.mutate(slot.id)}
                        disabled={deleteSlotMutation.isPending}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
