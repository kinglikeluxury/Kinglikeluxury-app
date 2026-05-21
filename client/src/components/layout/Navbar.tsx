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
import { Menu, Heart, Home, Building2, FolderOpen, BookOpen, Map, Star, PlusCircle, Shield, FileText, KeyRound, LogOut } from "lucide-react";
import logoPath from "@assets/LUXURY_20230822_234540_0000-removebg.png";
import LanguageSwitcher from "./LanguageSwitcher";
import MobileDrawer from "./MobileDrawer";
import { useTranslation } from "react-i18next";
import { useFavorites } from "@/hooks/use-favorites";

const Navbar = () => {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const { favorites, removeFromFavorites } = useFavorites();
  const { t } = useTranslation();

  const handleLogout = async () => {
    await logout();
  };

  const navLinks = [
    { name: t("nav.home", "Home"), path: "/" },
    { name: t("propertyTypes.apartment", "Apartments"), path: "/properties?type=apartment" },
    { name: t("propertyTypes.villa", "Villas"), path: "/properties?type=villa" },
    { name: t("propertyTypes.land", "Lands"), path: "/properties?type=land" },
    { name: t("propertyTypes.project", "Off Plan Projects"), path: "/projects", isSpecial: true },
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
                <img src={logoPath} alt="Kinglike Luxury" className="h-32 sm:h-32 w-auto" />
              </Link>
              {/* Desktop nav links */}
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {navLinks.map((link) => (
                  <Link key={link.path} href={link.path}>
                    <span
                      className={`${
                        location === link.path
                          ? "border-primary text-gray-900"
                          : link.isSpecial
                          ? "border-transparent text-primary hover:border-primary/30"
                          : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                      } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium cursor-pointer`}
                    >
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
                        <Link href="/" className="flex items-center gap-2"><Home className="w-4 h-4 text-gray-400" />{t("nav.home", "الرئيسية")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/properties?type=apartment" className="flex items-center gap-2"><Building2 className="w-4 h-4 text-gray-400" />{t("propertyTypes.apartment", "شقق")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/projects" className="flex items-center gap-2"><FolderOpen className="w-4 h-4 text-gray-400" />{t("nav.projects", "المشاريع")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/blog" className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-gray-400" />{t("nav.blog", "المدونة")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/map" className="flex items-center gap-2"><Map className="w-4 h-4 text-gray-400" />{t("nav.map", "الخريطة")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/favorites" className="flex items-center gap-2"><Heart className="w-4 h-4 text-gray-400" />{t("favorites.title", "المفضلة")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/properties?myProperties=true" className="flex items-center gap-2"><Star className="w-4 h-4 text-gray-400" />{t("property.myProperties", "عقاراتي")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/submit-property" className="flex items-center gap-2"><PlusCircle className="w-4 h-4 text-gray-400" />{t("property.submit", "إضافة عقار")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/privacy-policy" className="flex items-center gap-2"><Shield className="w-4 h-4 text-gray-400" />{t("nav.privacyPolicy", "سياسة الخصوصية")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/terms" className="flex items-center gap-2"><FileText className="w-4 h-4 text-gray-400" />{t("nav.termsConditions", "الشروط والأحكام")}</Link>
                      </DropdownMenuItem>

                      {/* Admin section */}
                      {user.isAdmin && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs text-gray-400 font-semibold uppercase">Admin</DropdownMenuLabel>
                          <DropdownMenuItem asChild><Link href="/admin/dashboard">{t("admin.dashboard", "Admin Dashboard")}</Link></DropdownMenuItem>
                          <DropdownMenuItem asChild><Link href="/admin/approvals">{t("admin.approvals", "Approvals")}</Link></DropdownMenuItem>
                          <DropdownMenuItem asChild><Link href="/admin/add-project">{t("admin.createProject", "Add Project")}</Link></DropdownMenuItem>
                          <DropdownMenuItem asChild><Link href="/admin/blog">{t("admin.blogManagement", "Blog")}</Link></DropdownMenuItem>
                          <DropdownMenuItem asChild><Link href="/admin/leads">👥 {t("admin.leads", "Leads Database")}</Link></DropdownMenuItem>
                          <DropdownMenuItem asChild><Link href="/admin/project-offer">📄 {t("admin.projectOffer", "إنشاء عرض للمشاريع")}</Link></DropdownMenuItem>
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
                        <Link href="/change-password" className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-gray-400" />{t("auth.changePassword", "تغيير كلمة السر")}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleLogout} className="flex items-center gap-2 text-red-500 focus:text-red-500">
                        <LogOut className="w-4 h-4" />{t("auth.logout", "تسجيل الخروج")}
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
