import { Link, useLocation } from "wouter";
import {
  Home, Building2, FolderOpen, BookOpen, Heart, PlusCircle,
  LogOut, LogIn, UserPlus, LayoutDashboard, CheckSquare,
  Globe, ChevronRight, X, Star, ChevronDown, ChevronUp
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useFavorites } from "@/hooks/use-favorites";
import { languages, getFlagUrl } from "@/lib/i18n";
import logoPath from "@assets/LUXURY_20230822_234540_0000-removebg.png";

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DrawerItem {
  label: string;
  path: string;
  icon: React.ElementType;
  badge?: number;
}

interface DrawerSection {
  title: string;
  items: DrawerItem[];
}

export default function MobileDrawer({ isOpen, onClose }: MobileDrawerProps) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const { favorites } = useFavorites();
  const [location] = useLocation();
  const [langExpanded, setLangExpanded] = useState(false);

  const handleNav = () => onClose();

  const handleLogout = async () => {
    await logout();
    onClose();
  };

  const browseSection: DrawerSection = {
    title: t("drawer.browse", "Browse"),
    items: [
      { label: t("nav.home", "Home"), path: "/", icon: Home },
      { label: t("propertyTypes.apartment", "Properties"), path: "/properties", icon: Building2 },
      { label: t("nav.projects", "Projects"), path: "/projects", icon: FolderOpen },
      { label: t("nav.blog", "Blog"), path: "/blog", icon: BookOpen },
    ],
  };

  const accountSection: DrawerSection = {
    title: t("drawer.account", "My Account"),
    items: [
      { label: t("favorites.title", "Favorites"), path: "/favorites", icon: Heart, badge: favorites.length },
      { label: t("property.myProperties", "My Properties"), path: "/properties?myProperties=true", icon: Star },
      { label: t("property.submit", "Add Property"), path: "/submit-property", icon: PlusCircle },
    ],
  };

  const adminSection: DrawerSection = {
    title: t("drawer.admin", "Admin Tools"),
    items: [
      { label: t("admin.dashboard", "Dashboard"), path: "/admin/dashboard", icon: LayoutDashboard },
      { label: t("admin.approvals", "Approvals"), path: "/admin/approvals", icon: CheckSquare },
      { label: t("admin.blogManagement", "Blog"), path: "/admin/blog", icon: BookOpen },
    ],
  };

  const isActive = (path: string) => location === path || location.startsWith(path + "?");

  const renderItem = (item: DrawerItem) => {
    const Icon = item.icon;
    const active = isActive(item.path);
    return (
      <Link key={item.path} href={item.path} onClick={handleNav}>
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
              <Icon
                className="w-4 h-4"
                style={{ color: active ? "#fff" : "#6b7280" }}
              />
            </div>
            <span
              className="text-[15px] font-medium"
              style={{ color: active ? "#3bcac4" : "#1f2937" }}
            >
              {item.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {item.badge !== undefined && item.badge > 0 && (
              <span
                className="text-xs text-white font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center"
                style={{ background: "#3bcac4" }}
              >
                {item.badge}
              </span>
            )}
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </div>
        </div>
      </Link>
    );
  };

  const renderSection = (section: DrawerSection) => (
    <div key={section.title} className="mb-2">
      <p className="px-5 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
        {section.title}
      </p>
      <div className="bg-white">
        {section.items.map(renderItem)}
      </div>
    </div>
  );

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
        className={`fixed top-0 right-0 h-full w-[82vw] max-w-[340px] z-50 flex flex-col bg-gray-50 shadow-2xl transition-transform duration-300 ease-out md:hidden`}
        style={{
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 pt-12 pb-5"
          style={{
            background: "linear-gradient(135deg, #005476, #3bcac4)",
          }}
        >
          <img src={logoPath} alt="Kinglike" className="h-9 w-auto brightness-0 invert" />
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>

        {/* User info */}
        {user ? (
          <div className="bg-white px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}
              >
                {user.username.substring(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-gray-900 text-[15px]">{user.username}</p>
                <p className="text-xs text-gray-500">{user.email}</p>
              </div>
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

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto py-2">
          {renderSection(browseSection)}
          {user && renderSection(accountSection)}
          {user?.isAdmin && renderSection(adminSection)}

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
                    <img
                      src={getFlagUrl(i18n.language)}
                      alt=""
                      className="w-5 h-4 object-cover rounded-sm"
                    />
                  </div>
                  <span className="text-[15px] font-medium text-gray-800">
                    {t("nav.language", "Language")} — {languages[i18n.language as keyof typeof languages]?.name || "English"}
                  </span>
                </div>
                {langExpanded ? (
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
              </button>

              {langExpanded && (
                <div className="px-4 pb-3 grid grid-cols-2 gap-2">
                  {Object.entries(languages).map(([code, { name }]) => {
                    const isActive = i18n.language === code;
                    return (
                      <button
                        key={code}
                        onClick={() => {
                          i18n.changeLanguage(code);
                          setLangExpanded(false);
                        }}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all"
                        style={{
                          borderColor: isActive ? "#3bcac4" : "#e5e7eb",
                          background: isActive ? "#f0fdfc" : "#fff",
                        }}
                      >
                        <img
                          src={getFlagUrl(code)}
                          alt=""
                          className="w-6 h-4 object-cover rounded-sm flex-shrink-0"
                        />
                        <span
                          className="text-[13px] font-medium truncate"
                          style={{ color: isActive ? "#3bcac4" : "#374151" }}
                        >
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

        {/* Sign out */}
        {user && (
          <div className="border-t border-gray-200 bg-white">
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
