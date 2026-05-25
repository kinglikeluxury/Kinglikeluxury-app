import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Bell, Check, CheckCheck, Calendar, Video, Phone, Monitor, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserNotification } from "@shared/schema";
import { TFunction } from "i18next";

const TYPE_ICONS: Record<string, React.ElementType> = {
  consultation_confirmed: Calendar,
  consultation_rejected: Calendar,
  consultation_cancelled: Calendar,
  consultation_pending: Calendar,
  consultation_completed: Calendar,
  consultation_booked: Calendar,
  test: Bell,
};

const TYPE_COLORS: Record<string, string> = {
  consultation_pending:   "bg-blue-100 text-blue-800",
  consultation_confirmed: "bg-green-100 text-green-800",
  consultation_rejected:  "bg-red-100 text-red-800",
  consultation_cancelled: "bg-gray-100 text-gray-600",
  consultation_completed: "bg-teal-100 text-teal-800",
  test: "bg-purple-100 text-purple-800",
};

/** Translate a notification's title and message using i18n keys + stored data. */
function getNotifContent(n: UserNotification, t: TFunction) {
  const data = (n.data as any) || {};

  // Translate consultation type/method using existing keys
  const translatedType   = data.consultationType
    ? t(`consultation.types.${data.consultationType}`, data.consultationType)
    : "";
  const translatedMethod = data.consultationMethod
    ? t(`consultation.methods.${data.consultationMethod}`, data.consultationMethod)
    : "";

  const vars = {
    ...data,
    consultationType:   translatedType,
    consultationMethod: translatedMethod,
  };

  const titleKey   = `notifications.types.${n.type}.title`;
  const messageKey = `notifications.types.${n.type}.message`;

  const title   = t(titleKey,   { defaultValue: n.title,   ...vars });
  const message = t(messageKey, { defaultValue: n.message, ...vars });

  return { title, message };
}

export default function NotificationsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { data: notifications = [], isLoading } = useQuery<UserNotification[]>({
    queryKey: ["/api/notifications"],
    enabled: !!user,
    refetchInterval: 30_000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  const markAllMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/notifications/read-all"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  if (!user) { navigate("/login"); return null; }

  const unread = notifications.filter(n => !n.isRead).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="text-white px-4 pt-8 pb-6" style={{ background: "linear-gradient(135deg, #3bcac4 0%, #005476 100%)" }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bell className="w-6 h-6" />
              {t("notifications.title", "Notifications")}
            </h1>
            <p className="text-white/70 text-sm mt-1">
              {unread > 0
                ? t("notifications.unread", "{{count}} unread", { count: unread })
                : t("notifications.allCaughtUp", "All caught up")}
            </p>
          </div>
          {unread > 0 && (
            <Button
              onClick={() => markAllMutation.mutate()}
              disabled={markAllMutation.isPending}
              variant="outline"
              size="sm"
              className="border-white/40 text-white hover:bg-white/20 bg-transparent"
            >
              {markAllMutation.isPending
                ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                : <CheckCheck className="w-3 h-3 mr-1" />}
              {t("notifications.markAllRead", "Mark all read")}
            </Button>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin w-8 h-8 text-[#3bcac4]" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <Bell className="w-16 h-16 mx-auto mb-4 text-gray-200" />
            <p className="text-gray-400 font-medium">{t("notifications.empty", "No notifications yet")}</p>
            <p className="text-gray-300 text-sm mt-1">
              {t("notifications.emptyHint", "You'll see updates here when admin confirms your bookings")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map(n => {
              const Icon = TYPE_ICONS[n.type] || Bell;
              const colorClass = TYPE_COLORS[n.type] || "bg-gray-100 text-gray-600";
              const data = n.data as any;
              const { title, message } = getNotifContent(n, t);

              return (
                <div
                  key={n.id}
                  className={`bg-white rounded-2xl shadow-sm border p-5 transition-all ${
                    !n.isRead
                      ? "border-[#3bcac4]/30 shadow-[#3bcac4]/10 shadow-md"
                      : "border-gray-100"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${
                      !n.isRead ? "bg-gradient-to-br from-[#3bcac4] to-[#005476]" : "bg-gray-100"
                    }`}>
                      <Icon className={`w-5 h-5 ${!n.isRead ? "text-white" : "text-gray-400"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`font-semibold text-sm ${!n.isRead ? "text-[#005476]" : "text-gray-800"}`}>
                          {title}
                        </span>
                        <Badge className={`text-[10px] px-1.5 py-0.5 ${colorClass}`}>
                          {n.type.replace(/_/g, " ")}
                        </Badge>
                        {!n.isRead && (
                          <span className="w-2 h-2 rounded-full bg-[#3bcac4] inline-block" />
                        )}
                      </div>
                      <p className="text-sm text-gray-600 leading-relaxed mb-2">{message}</p>
                      {data?.meetingLink && (
                        <a
                          href={data.meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#3bcac4] hover:text-[#005476] bg-[#f0fdfc] px-3 py-1.5 rounded-lg border border-[#3bcac4]/20 mb-2"
                        >
                          <Monitor className="w-3 h-3" />
                          {t("notifications.joinMeeting", "Join Meeting")}
                        </a>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-400">
                          {new Date(n.createdAt).toLocaleString()}
                        </span>
                        {!n.isRead && (
                          <button
                            onClick={() => markReadMutation.mutate(n.id)}
                            disabled={markReadMutation.isPending}
                            className="text-xs text-[#3bcac4] hover:text-[#005476] font-medium flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" />
                            {t("notifications.markRead", "Mark read")}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
