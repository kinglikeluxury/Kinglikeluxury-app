import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Bell, Check, CheckCheck, Calendar, X, Flame } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { UserNotification } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { TFunction } from "i18next";

/** Translate notification title/message using i18n keys + stored data fields. */
function getNotifContent(n: UserNotification, t: TFunction) {
  const data = (n.data as any) || {};
  const translatedType   = data.consultationType
    ? t(`consultation.types.${data.consultationType}`, data.consultationType)
    : "";
  const translatedMethod = data.consultationMethod
    ? t(`consultation.methods.${data.consultationMethod}`, data.consultationMethod)
    : "";
  const vars = { ...data, consultationType: translatedType, consultationMethod: translatedMethod };
  const title   = t(`notifications.types.${n.type}.title`,   { defaultValue: n.title,   ...vars });
  const message = t(`notifications.types.${n.type}.message`, { defaultValue: n.message, ...vars });
  return { title, message };
}

function isHotLeadEscalation(n: UserNotification): boolean {
  return n.type === "hot_lead_escalation";
}

function getLeadIdFromNotif(n: UserNotification): number | null {
  const data = (n.data as any) || {};
  return data.leadId ? Number(data.leadId) : null;
}

function getEscalationTypeLabel(n: UserNotification): string | null {
  const data = (n.data as any) || {};
  if (!data.escalationType) return null;
  const labels: Record<string, string> = {
    site_visit:        "Site Visit",
    reservation:       "Reservation",
    payment_plan:      "Payment Plan",
    unit_availability: "Unit Availability",
    contract_question: "Contract Question",
    purchase_intent:   "Purchase Intent",
  };
  return labels[data.escalationType] ?? data.escalationType;
}

export default function NotificationBell() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const { data: notifications = [] } = useQuery<UserNotification[]>({
    queryKey: ["/api/notifications"],
    enabled: !!user,
    refetchInterval: 15_000,
  });

  const unread = notifications.filter(n => !n.isRead).length;

  const markReadMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  const markAllMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/notifications/read-all"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  function handleNotifClick(n: UserNotification) {
    if (!n.isRead) markReadMutation.mutate(n.id);
    if (isHotLeadEscalation(n)) {
      const leadId = getLeadIdFromNotif(n);
      if (leadId) {
        setOpen(false);
        navigate(`/admin/crm/${leadId}`);
      }
    }
  }

  if (!user) return null;

  const recent = notifications.slice(0, 5);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-full hover:bg-gray-100 transition-colors focus:outline-none"
        aria-label={t("notifications.title", "Notifications")}
      >
        <Bell className={`h-5 w-5 ${unread > 0 ? "text-[#3bcac4]" : "text-gray-400"}`} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-[#005476] text-white text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="font-semibold text-gray-900 text-sm">
              {t("notifications.title", "Notifications")}
              {unread > 0 && (
                <span className="ml-2 bg-[#005476] text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                  {unread}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  onClick={() => markAllMutation.mutate()}
                  className="text-[10px] text-[#3bcac4] font-semibold hover:underline flex items-center gap-1"
                >
                  <CheckCheck className="w-3 h-3" />
                  {t("notifications.markAllRead", "Mark all read")}
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Notifications list */}
          <div className="max-h-72 overflow-y-auto">
            {recent.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-sm">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                {t("notifications.empty", "No notifications yet")}
              </div>
            ) : (
              recent.map(n => {
                const { title, message } = getNotifContent(n, t);
                const isHot = isHotLeadEscalation(n);
                const escalationLabel = isHot ? getEscalationTypeLabel(n) : null;
                const isClickable = isHot && !!getLeadIdFromNotif(n);

                return (
                  <div
                    key={n.id}
                    onClick={() => handleNotifClick(n)}
                    className={`px-4 py-3 border-b border-gray-50 transition-colors
                      ${!n.isRead ? (isHot ? "bg-red-50/60" : "bg-[#f0fdfc]") : ""}
                      ${isClickable ? "cursor-pointer hover:bg-red-50" : "hover:bg-gray-50"}
                    `}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isHot
                          ? (!n.isRead ? "bg-gradient-to-br from-red-400 to-orange-500" : "bg-red-100")
                          : (!n.isRead ? "bg-gradient-to-br from-[#3bcac4] to-[#005476]" : "bg-gray-100")
                      }`}>
                        {isHot
                          ? <Flame className={`w-3.5 h-3.5 ${!n.isRead ? "text-white" : "text-red-400"}`} />
                          : <Calendar className={`w-3.5 h-3.5 ${!n.isRead ? "text-white" : "text-gray-400"}`} />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className={`text-xs font-semibold ${!n.isRead ? (isHot ? "text-red-700" : "text-[#005476]") : "text-gray-700"}`}>
                            {title}
                          </p>
                          {isHot && !n.isRead && (
                            <span className="text-[9px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                              🔥 Hot Lead
                            </span>
                          )}
                        </div>
                        {escalationLabel && (
                          <p className="text-[10px] font-semibold text-red-600 mt-0.5">
                            Intent: {escalationLabel}
                          </p>
                        )}
                        <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed line-clamp-2">
                          {message}
                        </p>
                        <div className="flex items-center justify-between mt-1">
                          <p className="text-[10px] text-gray-400">
                            {new Date(n.createdAt).toLocaleString()}
                          </p>
                          {isClickable && (
                            <span className="text-[10px] text-red-500 font-medium">
                              View lead →
                            </span>
                          )}
                        </div>
                      </div>
                      {!n.isRead && (
                        <button
                          onClick={(e) => { e.stopPropagation(); markReadMutation.mutate(n.id); }}
                          className={`flex-shrink-0 mt-0.5 ${isHot ? "text-red-400 hover:text-red-600" : "text-[#3bcac4] hover:text-[#005476]"}`}
                          title={t("notifications.markRead", "Mark as read")}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 text-center">
              <Link href="/notifications" onClick={() => setOpen(false)}>
                <span className="text-xs font-semibold text-[#3bcac4] hover:text-[#005476] cursor-pointer">
                  {t("notifications.viewAll", "View all notifications")} →
                </span>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
