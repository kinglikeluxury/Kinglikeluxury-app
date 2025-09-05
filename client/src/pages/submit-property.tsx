import { useAuth } from "@/lib/auth";
import { Redirect, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building, Home, TreePine, Hammer, Users, Phone } from "lucide-react";

const SubmitProperty = () => {
  const { user, isLoading } = useAuth();
  
  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <span className="text-gray-500">Loading...</span>
      </div>
    );
  }
  
  // Redirect to login if not authenticated
  if (!user) {
    return <Redirect to="/login" />;
  }

  const propertyTypes = [
    {
      icon: Building,
      title: "Apartment",
      description: "List your apartment for sale or rent",
      href: "/submit-property/apartment"
    },
    {
      icon: Home,
      title: "Villa",
      description: "List your villa or house for sale or rent",
      href: "/submit-property/villa"
    },
    {
      icon: TreePine,
      title: "Land",
      description: "List your land or plot for sale",
      href: "/submit-property/land"
    },
    {
      icon: Hammer,
      title: "Off Plan Project",
      description: "List your development project",
      href: "/submit-property/project"
    }
  ];

  const otherOptions = [
    {
      icon: Users,
      title: "Multiple Properties",
      description: "List multiple properties at once",
      href: "/submit-property/bulk"
    },
    {
      icon: Phone,
      title: "Need Help?",
      description: "Contact our team for assistance",
      href: "/contact"
    }
  ];
  
  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Upload Your Property</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Choose the type of property you want to list. All submissions require admin approval.
          </p>
        </div>
        
        {/* Property Types */}
        <div className="mb-12">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Select Property Type</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {propertyTypes.map((type) => {
              const IconComponent = type.icon;
              return (
                <Card key={type.title} className="hover:shadow-lg transition-shadow cursor-pointer group">
                  <Link href={type.href}>
                    <CardHeader className="text-center">
                      <div className="mx-auto w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                        <IconComponent className="w-6 h-6 text-primary" />
                      </div>
                      <CardTitle className="text-lg">{type.title}</CardTitle>
                      <CardDescription className="text-sm">
                        {type.description}
                      </CardDescription>
                    </CardHeader>
                  </Link>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Other Options */}
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Other Options</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {otherOptions.map((option) => {
              const IconComponent = option.icon;
              return (
                <Card key={option.title} className="hover:shadow-lg transition-shadow cursor-pointer group">
                  <Link href={option.href}>
                    <CardHeader>
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                          <IconComponent className="w-6 h-6 text-gray-600" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">{option.title}</CardTitle>
                          <CardDescription className="text-sm">
                            {option.description}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                  </Link>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubmitProperty;
