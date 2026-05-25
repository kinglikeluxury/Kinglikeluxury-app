import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Heart, ArrowRight, Trash2 } from "lucide-react";
import { useFavorites } from "@/hooks/use-favorites";

const PRICE_RANGES: { [key: number]: string } = {
  25000: "$0 - $25,000",
  50000: "$25,000 - $50,000",
  75000: "$50,000 - $75,000",
  100000: "$75,000 - $100,000",
  125000: "$100,000 - $125,000",
  150000: "$125,000 - $150,000",
  175000: "$150,000 - $175,000",
  200000: "$175,000 - $200,000",
  225000: "$200,000 - $225,000",
  250000: "$225,000 - $250,000",
  275000: "$250,000 - $275,000",
  300000: "$275,000 - $300,000",
  325000: "$300,000 - $325,000",
  350000: "$325,000 - $350,000",
  375000: "$350,000 - $375,000",
  400000: "$375,000 - $400,000",
  425000: "$400,000 - $425,000",
  450000: "$425,000 - $450,000",
  475000: "$450,000 - $475,000",
  500000: "$475,000 - $500,000",
  600000: "$500,000 - $600,000",
  700000: "$600,000 - $700,000",
  800000: "$700,000 - $800,000",
  900000: "$800,000 - $900,000",
  1000000: "$900,000 - $1,000,000",
  1100000: "$1,000,000 - $1,100,000",
  1200000: "$1,100,000 - $1,200,000",
  1300000: "$1,200,000 - $1,300,000",
  1400000: "$1,300,000 - $1,400,000",
  1500000: "$1,400,000 - $1,500,000",
  1600000: "$1,500,000 - $1,600,000",
  1700000: "$1,600,000 - $1,700,000",
  1800000: "$1,700,000 - $1,800,000",
  1900000: "$1,800,000 - $1,900,000",
  2000000: "$1,900,000 - $2,000,000",
};

function getPriceRange(price: number) {
  return PRICE_RANGES[price] || new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(price);
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
                    <Link href={`/property/${property.id}`}>
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
