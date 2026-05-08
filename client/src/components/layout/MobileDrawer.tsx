import { Link, useLocation } from "wouter";
import {
  Home, Building2, FolderOpen, BookOpen, Heart, PlusCircle,
  LogOut, LogIn, UserPlus, LayoutDashboard, CheckSquare,
  Globe, ChevronRight, X, Star, ChevronDown, ChevronUp, Map, KeyRound
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useFavorites } from "@/hooks/use-favorites";
import { languages, getFlagUrl } from "@/lib/i18n";
import logoPath from "@assets/LUXURY_20230822_234540_0000-removebg.png";

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MobileDrawer({ isOpen, onClose }: MobileDrawerProps) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const { favorites } = useFavorites();
  const [location, navigate] = useLocation();
  const [langExpanded, setLangExpanded] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);

  const handleNav = () => {
    setShowLoginPrompt(false);
    onClose();
  };

  const handleLogout = async () => {
    await logout();
    onClose();
  };

  const handleProtectedNav = (path: string) => {
    if (user) {
      navigate(path);
      onClose();
    } else {
      setShowLoginPrompt(true);
    }
  };

  // Lock background scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      document.body.style.overflowY = 'scroll';
    } else {
      const scrollY = document.body.style.top;
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflowY = '';
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY || '0') * -1);
      }
    }
    return () => {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflowY = '';
    };
  }, [isOpen]);

  const isActive = (path: string) =>
    location === path || location.startsWith(path + "?");

  const renderItem = ({
    label,
    path,
    icon: Icon,
    badge,
    protected: isProtected,
  }: {
    label: string;
    path: string;
    icon: React.ElementType;
    badge?: number;
    protected?: boolean;
  }) => {
    const active = isActive(path);
    const content = (
      <div
        className={`flex items-center justify-between px-5 py-3.5 transition-colors active:bg-gray-100 ${
          active ? "bg-teal-50" : ""
        }`}
      >
        <div className="flex items-center gap-3.5">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: active
                ? "linear-gradient(135deg, #3bcac4, #005476)"
                : "#f3f4f6",
            }}
          >
            <Icon className="w-4 h-4" style={{ color: active ? "#fff" : "#6b7280" }} />
          </div>
          <span
            className="text-[15px] font-medium"
            style={{ color: active ? "#3bcac4" : "#1f2937" }}
          >
            {label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {badge !== undefined && badge > 0 && (
            <span
              className="text-xs text-white font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center"
              style={{ background: "#3bcac4" }}
            >
              {badge}
            </span>
          )}
          <ChevronRight className="w-4 h-4 text-gray-300" />
        </div>
      </div>
    );

    if (isProtected) {
      return (
        <button
          key={path}
          className="w-full text-left"
          onClick={() => handleProtectedNav(path)}
        >
          {content}
        </button>
      );
    }

    return (
      <Link key={path} href={path} onClick={handleNav}>
        {content}
      </Link>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className="fixed top-0 right-0 h-full w-[82vw] max-w-[340px] z-50 flex flex-col bg-gray-50 shadow-2xl transition-transform duration-300 ease-out md:hidden"
        style={{ transform: isOpen ? "translateX(0)" : "translateX(100%)" }}
      >
        {/* Header — white background, logo centred */}
        <div className="bg-white border-b border-gray-100 pt-8 pb-4 px-5 relative flex items-center justify-center">
          <img src={logoPath} alt="Kinglike Luxury" className="h-40 w-auto max-w-[75%]" />
          <button
            onClick={onClose}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* User info / Login buttons */}
        {user ? (
          <div className="bg-white px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}
              >
                {user.username.substring(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-[15px] truncate">{user.username}</p>
                {(user.email || user.phoneNumber) && (
                  <p className="text-xs text-gray-500 truncate">{user.email || user.phoneNumber}</p>
                )}
              </div>
              {/* Logout button — always visible next to user info */}
              <button
                onClick={handleLogout}
                className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl bg-red-50 active:bg-red-100 flex-shrink-0"
              >
                <LogOut className="w-4 h-4 text-red-500" />
                <span className="text-[10px] font-medium text-red-500">{t("auth.logout", "Logout")}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white px-5 py-4 border-b border-gray-100 flex gap-3">
            <Link href="/login" onClick={handleNav} className="flex-1">
              <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium">
                <LogIn className="w-4 h-4" />
                {t("auth.login", "Login")}
              </div>
            </Link>
            <Link href="/register" onClick={handleNav} className="flex-1">
              <div
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-sm font-medium"
                style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}
              >
                <UserPlus className="w-4 h-4" />
                {t("auth.register", "Sign Up")}
              </div>
            </Link>
          </div>
        )}

        {/* Login prompt banner (shown when non-auth user taps protected item) */}
        {showLoginPrompt && (
          <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <LogIn className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">يجب تسجيل الدخول أولاً</p>
              <div className="flex gap-2 mt-2">
                <Link href="/login" onClick={handleNav}>
                  <span className="text-xs px-3 py-1.5 rounded-lg text-white font-medium" style={{ background: "#3bcac4" }}>
                    تسجيل الدخول
                  </span>
                </Link>
                <Link href="/register" onClick={handleNav}>
                  <span className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 font-medium">
                    إنشاء حساب
                  </span>
                </Link>
              </div>
            </div>
            <button onClick={() => setShowLoginPrompt(false)}>
              <X className="w-4 h-4 text-amber-400" />
            </button>
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto py-2" style={{ overscrollBehavior: 'contain' }}>

          {/* Browse section — visible to all */}
          <div className="mb-2">
            <p className="px-5 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
              {t("drawer.browse", "Browse")}
            </p>
            <div className="bg-white">
              {renderItem({ label: t("nav.home", "Home"), path: "/", icon: Home })}
              {renderItem({ label: t("propertyTypes.apartment", "Properties"), path: "/properties", icon: Building2 })}
              {renderItem({ label: t("nav.projects", "Projects"), path: "/projects", icon: FolderOpen })}
              {renderItem({ label: t("nav.blog", "Blog"), path: "/blog", icon: BookOpen })}
              {renderItem({ label: t("nav.map", "Map"), path: "/map", icon: Map })}
              {renderItem({
                label: t("favorites.title", "Favorites"),
                path: "/favorites",
                icon: Heart,
                badge: favorites.length,
                protected: !user,
              })}
              {renderItem({
                label: t("property.myProperties", "My Properties"),
                path: "/properties?myProperties=true",
                icon: Star,
                protected: !user,
              })}
              {renderItem({
                label: t("property.submit", "Add Property"),
                path: "/submit-property",
                icon: PlusCircle,
                protected: !user,
              })}
            </div>
          </div>

          {/* Admin section */}
          {user?.isAdmin && (
            <div className="mb-2">
              <p className="px-5 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                {t("drawer.admin", "Admin Tools")}
              </p>
              <div className="bg-white">
                {renderItem({ label: t("admin.dashboard", "Dashboard"), path: "/admin/dashboard", icon: LayoutDashboard })}
                {renderItem({ label: t("admin.approvals", "Approvals"), path: "/admin/approvals", icon: CheckSquare })}
                {renderItem({ label: t("admin.blogManagement", "Blog"), path: "/admin/blog", icon: BookOpen })}
              </div>
            </div>
          )}

          {/* Language */}
          <div className="mb-2">
            <p className="px-5 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
              {t("drawer.settings", "Settings")}
            </p>
            <div className="bg-white">
              <button
                onClick={() => setLangExpanded(!langExpanded)}
                className="flex items-center justify-between w-full px-5 py-3.5 active:bg-gray-50"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <img src={getFlagUrl(i18n.language)} alt="" className="w-5 h-4 object-cover rounded-sm" />
                  </div>
                  <span className="text-[15px] font-medium text-gray-800">
                    {t("nav.language", "Language")} — {languages[i18n.language as keyof typeof languages]?.name || "English"}
                  </span>
                </div>
                {langExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {langExpanded && (
                <div className="px-4 pb-3 grid grid-cols-2 gap-2">
                  {Object.entries(languages).map(([code, { name }]) => {
                    const active = i18n.language === code;
                    return (
                      <button
                        key={code}
                        onClick={() => { i18n.changeLanguage(code); setLangExpanded(false); }}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all"
                        style={{
                          borderColor: active ? "#3bcac4" : "#e5e7eb",
                          background: active ? "#f0fdfc" : "#fff",
                        }}
                      >
                        <img src={getFlagUrl(code)} alt="" className="w-6 h-4 object-cover rounded-sm flex-shrink-0" />
                        <span className="text-[13px] font-medium truncate" style={{ color: active ? "#3bcac4" : "#374151" }}>
                          {name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Change password + Sign out */}
        {user && (
          <div className="border-t border-gray-200 bg-white">
            <Link
              href="/change-password"
              onClick={() => { onClose(); }}
              className="flex items-center gap-3.5 w-full px-5 py-4 text-gray-700 active:bg-gray-50"
            >
              <div className="w-8 h-8 rounded-full bg-[#3bcac4]/10 flex items-center justify-center">
                <KeyRound className="w-4 h-4 text-[#3bcac4]" />
              </div>
              <span className="text-[15px] font-medium">{t("auth.changePassword", "Change Password")}</span>
            </Link>
            <button
              onClick={handleLogout}
              className="flex items-center gap-3.5 w-full px-5 py-4 text-red-500 active:bg-red-50"
            >
              <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center">
                <LogOut className="w-4 h-4 text-red-500" />
              </div>
              <span className="text-[15px] font-medium">{t("auth.logout", "Sign out")}</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
