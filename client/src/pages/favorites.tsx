import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Heart, ArrowRight, Trash2 } from "lucide-react";
import { useFavorites } from "@/hooks/use-favorites";
import { slugifyProperty } from "@/lib/slugify";

function getPriceRange(price: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(price);
}

const Favorites = () => {
  const { t } = useTranslation();
  const { favorites, removeFromFavorites } = useFavorites();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Heart className="h-8 w-8 text-[#3bcac4] fill-[#3bcac4]" />
          <h1 className="text-3xl font-bold text-gray-900">
            {t("favorites.title", "Favorites")}
          </h1>
          <span className="text-lg text-gray-500">({favorites.length})</span>
        </div>

        {favorites.length === 0 ? (
          <Card className="max-w-lg mx-auto">
            <CardContent className="pt-8 pb-8 text-center">
              <Heart className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-700 mb-2">
                {t("favorites.empty", "No favorites yet")}
              </h2>
              <p className="text-gray-500 mb-6">
                {t("favorites.emptyMessage", "Browse properties and click the heart icon to add them to your favorites.")}
              </p>
              <Button className="bg-[#3bcac4] hover:bg-[#3bcac4]/90 text-white" asChild>
                <Link href="/properties">
                  {t("favorites.browseProperties", "Browse Properties")}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {favorites.map((property) => (
              <Card key={property.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                <CardContent className="p-6">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-semibold text-gray-900 truncate">
                        {property.title}
                      </h3>
                      <p className="text-sm text-gray-500 capitalize">{property.type}</p>
                    </div>
                    <button
                      onClick={() => removeFromFavorites(property.id)}
                      className="p-2 rounded-full hover:bg-gray-100 transition-colors ml-2 flex-shrink-0"
                      aria-label={t("favorites.remove", "Remove from favorites")}
                    >
                      <Trash2 className="h-5 w-5 text-gray-400 hover:text-[#3bcac4]" />
                    </button>
                  </div>

                  <div className="mb-4">
                    <span className="text-xl font-bold text-[#005476]">
                      {getPriceRange(property.price)}
                    </span>
                  </div>

                  <Button
                    className="w-full bg-[#3bcac4] hover:bg-[#3bcac4]/90 text-white"
                    asChild
                  >
                    <Link href={`/property/${slugifyProperty(property.title, property.location ?? "", property.id)}`}>
                      <span className="flex items-center justify-center">
                        {t("property.viewDetails", "View Details")}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </span>
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Favorites;
