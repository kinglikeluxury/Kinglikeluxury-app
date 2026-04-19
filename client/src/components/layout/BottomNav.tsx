import { Link, useLocation } from "wouter";
import { Home, Building2, FolderOpen, BookOpen, PlusCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";

export default function BottomNav() {
  const [location] = useLocation();
  const { t } = useTranslation();
  const { user } = useAuth();

  const tabs = [
    { 
      path: "/", 
      label: t("nav.home", "Home"), 
      icon: Home,
      exact: true
    },
    { 
      path: "/properties", 
      label: t("propertyTypes.apartment", "Properties"), 
      icon: Building2 
    },
    { 
      path: "/submit-property", 
      label: t("property.add", "Add"), 
      icon: PlusCircle,
      isCenter: true
    },
    { 
      path: "/projects", 
      label: t("nav.projects", "Projects"), 
      icon: FolderOpen 
    },
    { 
      path: "/blog", 
      label: t("nav.blog", "Blog"), 
      icon: BookOpen 
    },
  ];

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location === path;
    return location.startsWith(path);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t border-gray-100 safe-area-bottom"
      style={{ boxShadow: "0 -1px 20px rgba(0,0,0,0.08)" }}>
      <div className="flex items-center justify-around h-16 px-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.path, tab.exact);

          if (tab.isCenter) {
            return (
              <Link key={tab.path} href={tab.path}>
                <div className="flex flex-col items-center -mt-5">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95"
                    style={{
                      background: "linear-gradient(135deg, #3bcac4, #005476)",
                    }}
                  >
                    <Icon className="w-7 h-7 text-white" />
                  </div>
                  <span className="text-[10px] mt-1 font-medium"
                    style={{ color: active ? "#3bcac4" : "#9ca3af" }}>
                    {tab.label}
                  </span>
                </div>
              </Link>
            );
          }

          return (
            <Link key={tab.path} href={tab.path}>
              <div className="flex flex-col items-center justify-center gap-1 px-3 py-2 min-w-[60px] transition-all active:scale-95">
                <div className="relative">
                  <Icon
                    className="w-6 h-6 transition-all"
                    style={{ color: active ? "#3bcac4" : "#9ca3af" }}
                    strokeWidth={active ? 2.5 : 1.8}
                  />
                  {active && (
                    <div
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                      style={{ backgroundColor: "#3bcac4" }}
                    />
                  )}
                </div>
                <span
                  className="text-[10px] font-medium transition-all"
                  style={{ color: active ? "#3bcac4" : "#9ca3af" }}
                >
                  {tab.label}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
