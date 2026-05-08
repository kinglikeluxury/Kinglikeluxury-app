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
import { Menu, Heart } from "lucide-react";
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
      <nav className="bg-white shadow-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-24 sm:h-16">
            {/* Logo */}
            <div className="flex items-center">
              <Link href="/">
                <img src={logoPath} alt="Kinglike Luxury" className="h-20 sm:h-10 w-auto" />
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
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem><span className="font-medium">{user.username}</span></DropdownMenuItem>
                      {(user.email || user.phoneNumber) && (
                        <DropdownMenuItem>
                          <span className="text-sm text-gray-500">
                            {user.email || user.phoneNumber}
                          </span>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild><Link href="/properties?myProperties=true">{t("property.myProperties", "My Properties")}</Link></DropdownMenuItem>
                      {user.isAdmin && (
                        <>
                          <DropdownMenuItem asChild><Link href="/admin/dashboard">{t("admin.dashboard", "Admin Dashboard")}</Link></DropdownMenuItem>
                          <DropdownMenuItem asChild><Link href="/admin/approvals">{t("admin.approvals", "Approvals")}</Link></DropdownMenuItem>
                          <DropdownMenuItem asChild><Link href="/admin/add-project">{t("admin.createProject", "Add Project")}</Link></DropdownMenuItem>
                          <DropdownMenuItem asChild><Link href="/admin/blog">{t("admin.blogManagement", "Blog")}</Link></DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild><Link href="/change-password">{t("auth.changePassword", "Change Password")}</Link></DropdownMenuItem>
                      <DropdownMenuItem onClick={handleLogout}>{t("auth.logout", "Sign out")}</DropdownMenuItem>
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
