import { Link } from "wouter";
import { PROPERTY_TYPES } from "@shared/schema";

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
      name: "Projects",
      image: "https://images.unsplash.com/photo-1553247407-23251f7e13d0?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
      path: `/properties?type=${PROPERTY_TYPES.PROJECT}`,
      count: "42+ Listings",
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h2 className="text-2xl font-bold text-gray-900 mb-8">Browse by category</h2>
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
