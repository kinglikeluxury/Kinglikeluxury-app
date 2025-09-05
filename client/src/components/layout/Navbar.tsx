import { useState, useEffect } from "react";
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
import { Menu, X, User, Heart } from "lucide-react";
import logoPath from "@assets/LUXURY_20230822_234540_0000-removebg.png";
import LanguageSwitcher from "./LanguageSwitcher";
import { useTranslation } from "react-i18next";

type FavoriteProperty = {
  id: number;
  title: string;
  price: number;
  type: string;
};

const Navbar = () => {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteProperty[]>([]);
  const { t } = useTranslation();

  // Load favorites from localStorage on component mount
  useEffect(() => {
    const storedFavorites = localStorage.getItem('favorites');
    if (storedFavorites) {
      try {
        setFavorites(JSON.parse(storedFavorites));
      } catch (error) {
        console.error('Error parsing favorites from localStorage:', error);
        localStorage.removeItem('favorites');
      }
    }
  }, []);
  
  // Save favorites to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('favorites', JSON.stringify(favorites));
  }, [favorites]);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const handleLogout = async () => {
    await logout();
  };
  
  // Add a property to favorites
  const addToFavorites = (property: FavoriteProperty) => {
    if (!favorites.some(fav => fav.id === property.id)) {
      setFavorites([...favorites, property]);
    }
  };
  
  // Remove a property from favorites
  const removeFromFavorites = (propertyId: number) => {
    setFavorites(favorites.filter(fav => fav.id !== propertyId));
  };

  const navLinks = [
    { name: t('nav.home', 'Home'), path: "/" },
    { name: t('propertyTypes.apartment', 'Apartments'), path: "/properties?type=apartment" },
    { name: t('propertyTypes.villa', 'Villas'), path: "/properties?type=villa" },
    { name: t('propertyTypes.land', 'Lands'), path: "/properties?type=land" },
    { name: t('propertyTypes.project', 'Off Plan Projects'), path: "/properties?type=project" },
  ];

  return (
    <nav className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/">
                <img src={logoPath} alt="Kinglike Luxury" className="h-10 w-auto" />
              </Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navLinks.map((link) => (
                <Link key={link.path} href={link.path}>
                  <a
                    className={`${
                      location === link.path
                        ? "border-primary-500 text-gray-900"
                        : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                    } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                  >
                    {link.name}
                  </a>
                </Link>
              ))}
            </div>
          </div>
          <div className="hidden sm:ml-6 sm:flex sm:items-center">
            <div className="flex items-center space-x-4 mr-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="p-2 rounded-full hover:bg-gray-100 transition-colors focus:outline-none"
                    aria-label={t('favorites.title', 'Favorites')}
                  >
                    <Heart
                      className={`h-5 w-5 ${favorites.length > 0 ? 'text-red-500 fill-red-500' : 'text-gray-400'}`}
                    />
                    {favorites.length > 0 && (
                      <span className="absolute -top-1 -right-1 bg-primary-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                        {favorites.length}
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>{t('favorites.title', 'Favorites')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {favorites.length === 0 ? (
                    <div className="px-2 py-4 text-center text-sm text-gray-500">
                      {t('favorites.empty', 'No favorites yet')}
                    </div>
                  ) : (
                    favorites.map((property) => (
                      <DropdownMenuItem key={property.id} className="flex justify-between items-center">
                        <div className="flex-1 truncate">
                          <div className="font-medium truncate">{property.title}</div>
                          <div className="text-sm text-gray-500">
                            {property.type} · ${property.price.toLocaleString()}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeFromFavorites(property.id);
                          }}
                          className="ml-2 text-gray-400 hover:text-red-500"
                          aria-label={t('favorites.remove', 'Remove from favorites')}
                        >
                          <Heart className="h-4 w-4 fill-current" />
                        </button>
                      </DropdownMenuItem>
                    ))
                  )}
                  {favorites.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <Link href="/favorites" className="w-full">
                        <DropdownMenuItem className="cursor-pointer text-center">
                          {t('favorites.viewAll', 'View all favorites')}
                        </DropdownMenuItem>
                      </Link>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <LanguageSwitcher />
            </div>
            {user ? (
              <>
                <Button asChild variant="default" className="mr-2">
                  <Link href="/submit-property">{t('property.submit', 'Add Property')}</Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                      <span className="text-xs font-medium">
                        {user.username.substring(0, 2).toUpperCase()}
                      </span>
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>
                      <span className="font-medium">{user.username}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <span className="text-sm text-gray-500">{user.email}</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/properties?myProperties=true">
                        {t('property.myProperties', 'My Properties')}
                      </Link>
                    </DropdownMenuItem>
                    {user.isAdmin && (
                      <>
                        <DropdownMenuItem asChild>
                          <Link href="/admin/dashboard">{t('admin.dashboard', 'Admin Dashboard')}</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href="/admin/approvals">{t('admin.approvals', 'Property Approvals')}</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href="/admin/add-project">{t('admin.createProject', 'Add Project')}</Link>
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout}>
                      {t('auth.logout', 'Sign out')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                <Button variant="outline" className="mr-2" asChild>
                  <Link href="/login">{t('auth.login', 'Login')}</Link>
                </Button>
                <Button asChild>
                  <Link href="/register">{t('auth.register', 'Sign Up')}</Link>
                </Button>
              </>
            )}
          </div>
          <div className="-mr-2 flex items-center sm:hidden">
            <Button
              variant="ghost"
              onClick={toggleMenu}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none"
            >
              {isMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <div className={`${isMenuOpen ? "block" : "hidden"} sm:hidden`}>
        <div className="pt-2 pb-3 space-y-1">
          {navLinks.map((link) => (
            <Link key={link.path} href={link.path}>
              <a
                className={`${
                  location === link.path
                    ? "bg-primary-50 border-primary-500 text-primary-700"
                    : "border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700"
                } block pl-3 pr-4 py-2 border-l-4 text-base font-medium`}
              >
                {link.name}
              </a>
            </Link>
          ))}
        </div>
        {user ? (
          <div className="pt-4 pb-3 border-t border-gray-200">
            <div className="flex items-center px-4">
              <div className="flex-shrink-0">
                <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                  <span className="text-sm font-medium">
                    {user.username.substring(0, 2).toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="ml-3">
                <div className="text-base font-medium text-gray-800">
                  {user.username}
                </div>
                <div className="text-sm font-medium text-gray-500">
                  {user.email}
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-1">
              <div className="flex items-center px-4 py-2">
                <button
                  className="p-2 mr-2 rounded-full hover:bg-gray-100 transition-colors focus:outline-none relative"
                  aria-label={t('favorites.title', 'Favorites')}
                >
                  <Heart
                    className={`h-5 w-5 ${favorites.length > 0 ? 'text-red-500 fill-red-500' : 'text-gray-400'}`}
                  />
                  {favorites.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-primary-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                      {favorites.length}
                    </span>
                  )}
                </button>
                <span className="text-base font-medium text-gray-500">
                  {t('favorites.title', 'Favorites')} ({favorites.length})
                </span>
              </div>
              <Link href="/submit-property">
                <a className="block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100">
                  {t('property.submit', 'Add Property')}
                </a>
              </Link>
              <Link href="/properties?myProperties=true">
                <a className="block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100">
                  {t('property.myProperties', 'My Properties')}
                </a>
              </Link>
              {user.isAdmin && (
                <>
                  <Link href="/admin/dashboard">
                    <a className="block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100">
                      {t('admin.dashboard', 'Admin Dashboard')}
                    </a>
                  </Link>
                  <Link href="/admin/approvals">
                    <a className="block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100">
                      {t('admin.approvals', 'Property Approvals')}
                    </a>
                  </Link>
                  <Link href="/admin/add-project">
                    <a className="block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100">
                      {t('admin.createProject', 'Add Project')}
                    </a>
                  </Link>
                </>
              )}
              <button
                onClick={handleLogout}
                className="block w-full text-left px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100"
              >
                {t('auth.logout', 'Sign out')}
              </button>
            </div>
          </div>
        ) : (
          <div className="pt-4 pb-3 border-t border-gray-200 px-4 space-y-2">
            <div className="mb-3 flex justify-center space-x-4">
              <button
                className="p-2 rounded-full hover:bg-gray-100 transition-colors focus:outline-none relative"
                aria-label={t('favorites.title', 'Favorites')}
                onClick={() => {}}
              >
                <Heart
                  className={`h-5 w-5 ${favorites.length > 0 ? 'text-red-500 fill-red-500' : 'text-gray-400'}`}
                />
                {favorites.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-primary-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                    {favorites.length}
                  </span>
                )}
              </button>
              <LanguageSwitcher />
            </div>
            <Button variant="outline" className="w-full" asChild>
              <Link href="/login">{t('auth.login', 'Login')}</Link>
            </Button>
            <Button className="w-full" asChild>
              <Link href="/register">{t('auth.register', 'Sign Up')}</Link>
            </Button>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
