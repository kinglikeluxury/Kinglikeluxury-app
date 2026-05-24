import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Bell, Check, CheckCheck, Calendar, X } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { UserNotification } from "@shared/schema";
import { useTranslation } from "react-i18next";

export default function NotificationBell() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Auto-close on outside click
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
    refetchInterval: 30_000, // poll every 30s
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

  if (!user) return null;

  const recent = notifications.slice(0, 5);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-full hover:bg-gray-100 transition-colors focus:outline-none"
        aria-label="Notifications"
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
                <span className="ml-2 bg-[#3bcac4] text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
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
              recent.map(n => (
                <div
                  key={n.id}
                  className={`px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${!n.isRead ? "bg-[#f0fdfc]" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${!n.isRead ? "bg-gradient-to-br from-[#3bcac4] to-[#005476]" : "bg-gray-100"}`}>
                      <Calendar className={`w-3.5 h-3.5 ${!n.isRead ? "text-white" : "text-gray-400"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold ${!n.isRead ? "text-[#005476]" : "text-gray-700"}`}>{n.title}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{n.message}</p>
                      <p className="text-[10px] text-gray-400 mt-1">
                        {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {!n.isRead && (
                      <button
                        onClick={() => markReadMutation.mutate(n.id)}
                        className="text-[#3bcac4] hover:text-[#005476] flex-shrink-0 mt-0.5"
                        title="Mark as read"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
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
