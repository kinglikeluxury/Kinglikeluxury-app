import { PhoneCall } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";

export default function FloatingKayCallButton() {
  const [location, navigate] = useLocation();
  const { user, isLoading } = useAuth();

  if (
    isLoading ||
    user?.id !== 1 ||
    user.isAdmin !== true ||
    location === "/admin/kay/call"
  ) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => navigate("/admin/kay/call")}
      aria-label="الاتصال بكاي"
      title="الاتصال بكاي"
      className="fixed bottom-8 right-8 z-40 grid h-[60px] w-[60px] place-items-center rounded-full border-2 border-[#8bd8d1] bg-[#0b7c78] text-white shadow-[0_6px_22px_rgba(11,124,120,0.38)] transition-transform duration-150 hover:scale-105 hover:bg-[#096a67] active:scale-90"
    >
      <PhoneCall className="h-7 w-7" aria-hidden="true" />
    </button>
  );
}