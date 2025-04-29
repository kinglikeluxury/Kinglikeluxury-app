import { Link } from "wouter";
import { PROPERTY_TYPES } from "@shared/schema";
import luxuryLogoPath from "@assets/LUXURY_20230822_234540_0000-removebg.png";
import constructionImagePath from "@assets/1702663538423.jfif";

const CategorySection = () => {
  const categories = [
    {
      name: "Apartments",
      image: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
      path: `/properties?type=${PROPERTY_TYPES.APARTMENT}`,
      count: "120+ Listings",
    },
    {
      name: "Villas",
      image: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
      path: `/properties?type=${PROPERTY_TYPES.VILLA}`,
      count: "85+ Listings",
    },
    {
      name: "Lands",
      image: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
      path: `/properties?type=${PROPERTY_TYPES.LAND}`,
      count: "63+ Listings",
    },
    {
      name: "Under Construction Projects",
      image: constructionImagePath,
      path: `/properties?type=${PROPERTY_TYPES.PROJECT}`,
      count: "42+ Listings",
      isProject: true,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-gray-900">Browse by category</h2>
        <div className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white text-xs font-medium px-3 py-1 rounded-full shadow-md">
          KINGLIKE EXCLUSIVE
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {categories.map((category, index) => (
          <Link key={index} href={category.path}>
            <a className="relative rounded-lg overflow-hidden group h-48">
              <img
                src={category.image}
                alt={`${category.name} category`}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent"></div>
              
              {category.isProject && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-black/60">
                  <div className="flex flex-col items-center mb-4">
                    <div className="text-[#3bcac4] font-bold text-lg mb-1">KINGLIKE</div>
                    <div className="text-[#3bcac4] font-bold text-lg">LUXURY</div>
                  </div>
                  <div className="bg-[#3bcac4]/90 px-3 py-1 rounded-full mb-2 rotate-[-5deg] shadow-lg">
                    <span className="text-white font-bold text-sm">Coming Soon</span>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 rounded-full bg-[#005476] animate-pulse"></div>
                    <div className="w-5 h-5 rounded-full bg-[#3bcac4] animate-pulse delay-100"></div>
                    <div className="w-5 h-5 rounded-full bg-[#005476] animate-pulse delay-200"></div>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="h-5 w-5 bg-yellow-400 rounded-sm flex items-center justify-center">
                      <span className="text-black text-xs font-bold">!</span>
                    </div>
                    <p className="text-white text-xs">Admin-only listings</p>
                  </div>
                </div>
              )}
              
              <div className="absolute bottom-0 left-0 p-4">
                <h3 className="text-xl font-bold text-white">{category.name}</h3>
                <p className="text-sm text-white/80">{category.count}</p>
              </div>
            </a>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default CategorySection;
