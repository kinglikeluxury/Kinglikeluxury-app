import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { Menu, Heart, Home, Building2, FolderOpen, BookOpen, Map, Star, PlusCircle, Shield, FileText, KeyRound, LogOut, Search, CalendarDays, Bell, Bot, Sparkles, Tv, Crown } from "lucide-react";
import logoPath from "@assets/LUXURY_20230822_234540_0000-removebg.png";
import LanguageSwitcher from "./LanguageSwitcher";
import MobileDrawer from "./MobileDrawer";
import NotificationBell from "./NotificationBell";
import { useTranslation } from "react-i18next";
import { useFavorites } from "@/hooks/use-favorites";
import { ADMIN_NAV_ITEMS } from "@/lib/adminNavItems";

const Navbar = () => {
  const [location, navigate] = useLocation();
  const { user, logout } = useAuth();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [adminSearchId, setAdminSearchId] = useState("");
  const { favorites, removeFromFavorites } = useFavorites();
  const { t } = useTranslation();

  const handleLogout = async () => {
    await logout();
  };

  const handleAdminSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const id = adminSearchId.trim();
    if (id && !isNaN(Number(id))) {
      navigate(`/property/${id}`);
      setAdminSearchId("");
    }
  };

  const navLinks = [
    { name: t("nav.home", "Home"), path: "/" },
    { name: t("propertyTypes.apartment", "Apartments"), path: "/properties?type=apartment" },
    { name: t("propertyTypes.villa", "Villas"), path: "/properties?type=villa" },
    { name: t("propertyTypes.land", "Lands"), path: "/properties?type=land" },
    { name: t("propertyTypes.project", "Off Plan Projects"), path: "/projects", isSpecial: true },
    { name: t("nav.live", "Live"), path: "/live-projects", isLive: true },
    { name: t("property.uploadProperties", "Upload your properties"), path: "/submit-property", isSpecial: true },
  ];

  return (
    <>
      <nav className="bg-white shadow-sm sticky top-0 z-30 overflow-visible">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 sm:h-14 overflow-visible">
            {/* Logo */}
            <div className="flex items-center overflow-visible">
              <Link href="/">
                <img src={logoPath} alt="Kinglike Luxury" className="h-48 sm:h-48 w-auto translate-y-3" />
              </Link>
              {/* Desktop nav links */}
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {navLinks.map((link) => (
                  <Link key={link.path} href={link.path}>
                    <span
                      className={`${
                        location === link.path
                          ? "border-primary text-gray-900"
                          : (link as any).isLive
                          ? "border-transparent text-red-500 hover:border-red-200"
                          : link.isSpecial
                          ? "border-transparent text-primary hover:border-primary/30"
                          : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                      } inline-flex items-center gap-1.5 px-1 pt-1 border-b-2 text-sm font-medium cursor-pointer`}
                    >
                      {(link as any).isLive && (
                        <span className="relative flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping absolute -top-0.5 -left-0.5 opacity-75" />
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                        </span>
                      )}
                      {link.name}
                      {link.isSpecial && <span className="ml-1 text-[#005476] font-bold">+</span>}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Desktop right actions */}
            <div className="hidden sm:flex sm:items-center gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="relative p-2 rounded-full hover:bg-gray-100 transition-colors focus:outline-none">
                    <Heart className={`h-5 w-5 ${favorites.length > 0 ? "text-[#3bcac4] fill-[#3bcac4]" : "text-gray-400"}`} />
                    {favorites.length > 0 && (
                      <span className="absolute -top-1 -right-1 bg-[#3bcac4] text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                        {favorites.length}
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>{t("favorites.title", "Favorites")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {favorites.length === 0 ? (
                    <div className="px-2 py-4 text-center text-sm text-gray-500">{t("favorites.empty", "No favorites yet")}</div>
                  ) : (
                    favorites.map((property) => (
                      <DropdownMenuItem key={property.id} className="flex justify-between items-center">
                        <div className="flex-1 truncate">
                          <div className="font-medium truncate">{property.title}</div>
                          <div className="text-sm text-gray-500">{property.type} · ${property.price.toLocaleString()}</div>
                        </div>
                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeFromFavorites(property.id); }} className="ml-2 text-gray-400 hover:text-[#3bcac4]">
                          <Heart className="h-4 w-4 fill-current" />
                        </button>
                      </DropdownMenuItem>
                    ))
                  )}
                  {favorites.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <Link href="/favorites" className="w-full">
                        <DropdownMenuItem className="cursor-pointer text-center">{t("favorites.viewAll", "View all favorites")}</DropdownMenuItem>
                      </Link>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <LanguageSwitcher />
              <NotificationBell />

              {user ? (
                <>
                  <Button asChild variant="default" size="sm">
                    <Link href="/submit-property">{t("property.submit", "Add Property")}</Link>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center text-white text-xs font-bold">
                        {user.username.substring(0, 2).toUpperCase()}
                      </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {/* User info */}
                      <div className="px-3 py-2 border-b border-gray-100">
                        <p className="font-semibold text-sm text-gray-900">{user.username}</p>
                        {(user.email || user.phoneNumber) && (
                          <p className="text-xs text-gray-500 truncate">{user.email || user.phoneNumber}</p>
                        )}
                      </div>

                      {/* Navigation links */}
                      <DropdownMenuItem asChild>
                        <Link href="/" className="flex items-center gap-2"><Home className="w-4 h-4 text-gray-400" />{t("nav.home", "Home")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/properties?type=apartment" className="flex items-center gap-2"><Building2 className="w-4 h-4 text-gray-400" />{t("propertyTypes.apartment", "Apartments")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/projects" className="flex items-center gap-2"><FolderOpen className="w-4 h-4 text-gray-400" />{t("nav.projects", "Projects")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/blog" className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-gray-400" />{t("nav.blog", "Blog")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/map" className="flex items-center gap-2"><Map className="w-4 h-4 text-gray-400" />{t("nav.map", "Map")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/favorites" className="flex items-center gap-2"><Heart className="w-4 h-4 text-gray-400" />{t("favorites.title", "Favorites")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/properties?myProperties=true" className="flex items-center gap-2"><Star className="w-4 h-4 text-gray-400" />{t("property.myProperties", "My Properties")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/submit-property" className="flex items-center gap-2"><PlusCircle className="w-4 h-4 text-gray-400" />{t("property.submit", "Add Property")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/ai-advisor" className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#3bcac4]" />{t("aiAdvisor.menuLabel", "AI Investment Advisor")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/live-projects" className="flex items-center gap-2">
                          <span className="relative flex items-center">
                            <Tv className="w-4 h-4 text-red-500" />
                            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
                          </span>
                          {t("nav.live", "Live Projects")}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/consultation" className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-gray-400" />{t("consultation.menuLabel", "Book Consultation")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/notifications" className="flex items-center gap-2"><Bell className="w-4 h-4 text-gray-400" />{t("nav.notifications", "Notifications")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/privacy-policy" className="flex items-center gap-2"><Shield className="w-4 h-4 text-gray-400" />{t("nav.privacyPolicy", "Privacy Policy")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/terms" className="flex items-center gap-2"><FileText className="w-4 h-4 text-gray-400" />{t("nav.termsConditions", "Terms & Conditions")}</Link>
                      </DropdownMenuItem>

                      {/* Sub-Agent CRM section */}
                      {user.role === "sub_agent" && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs text-gray-400 font-semibold uppercase">Sales CRM</DropdownMenuLabel>
                          <DropdownMenuItem asChild>
                            <Link href="/admin/crm" className="flex items-center gap-2">
                              <Crown className="w-3.5 h-3.5" style={{ color: "#3bcac4" }} />
                              Kinglike CRM
                            </Link>
                          </DropdownMenuItem>
                        </>
                      )}

                      {/* Admin section */}
                      {user.isAdmin && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs text-gray-400 font-semibold uppercase">Admin</DropdownMenuLabel>
                          {ADMIN_NAV_ITEMS.map((item) => (
                            <DropdownMenuItem key={item.path} asChild>
                              <Link href={item.path} className="flex items-center gap-2">
                                <item.Icon
                                  className={`w-3.5 h-3.5${item.iconColorClass ? ` ${item.iconColorClass}` : ""}`}
                                  style={item.iconColorHex ? { color: item.iconColorHex } : undefined}
                                />
                                {t(item.labelKey, item.labelFallback)}
                              </Link>
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <div className="px-2 py-1.5">
                            <p className="text-[10px] text-gray-400 font-semibold uppercase mb-1.5 flex items-center gap-1">
                              <Search className="w-3 h-3" /> Search by Property ID
                            </p>
                            <form onSubmit={handleAdminSearch} className="flex gap-1">
                              <input
                                type="number"
                                min="1"
                                value={adminSearchId}
                                onChange={(e) => setAdminSearchId(e.target.value)}
                                placeholder="Property ID..."
                                className="flex-1 text-sm border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:border-[#3bcac4] min-w-0"
                                onClick={(e) => e.stopPropagation()}
                              />
                              <button
                                type="submit"
                                className="px-2 py-1 rounded-md text-white text-sm font-medium flex-shrink-0"
                                style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}
                              >
                                <Search className="w-3.5 h-3.5" />
                              </button>
                            </form>
                          </div>
                        </>
                      )}

                      {/* Language */}
                      <DropdownMenuSeparator />
                      <div className="px-2 py-1">
                        <LanguageSwitcher />
                      </div>

                      {/* Account actions */}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link href="/change-password" className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-gray-400" />{t("auth.changePassword", "Change Password")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleLogout} className="flex items-center gap-2 text-red-500 focus:text-red-500">
                        <LogOut className="w-4 h-4" />{t("auth.logout", "Sign out")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" asChild><Link href="/login">{t("auth.login", "Login")}</Link></Button>
                  <Button size="sm" asChild><Link href="/register">{t("auth.register", "Sign Up")}</Link></Button>
                </>
              )}
            </div>

            {/* Mobile: language + hamburger */}
            <div className="flex items-center gap-1 sm:hidden">
              <LanguageSwitcher />
              <button
                onClick={() => setIsDrawerOpen(true)}
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors focus:outline-none"
                aria-label="Open menu"
              >
                <Menu className="h-6 w-6" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Drawer */}
      <MobileDrawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />
    </>
  );
};

export default Navbar;
