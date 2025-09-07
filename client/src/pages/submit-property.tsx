import { useAuth } from "@/lib/auth";
import { Redirect, Link } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PROPERTY_TYPES } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { Building2, Home, Landmark, Store, FileText, AlertCircle } from "lucide-react";

const SubmitProperty = () => {
  const { user, isLoading } = useAuth();
  const { t } = useTranslation();
  
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

  // Check if user can add off-plan projects
  const canAddOffPlan = user.email === "info@kinglikeluxury.com" || user.email === "tarekalimam@gmail.com";

  const propertyTypes = [
    {
      type: PROPERTY_TYPES.APARTMENT,
      title: t('propertyTypes.apartment', 'Apartments'),
      description: "Condos, penthouses, and apartment units",
      icon: <Building2 className="h-8 w-8" />,
      available: true,
      path: `/submit-property/form?type=${PROPERTY_TYPES.APARTMENT}`
    },
    {
      type: PROPERTY_TYPES.VILLA,
      title: t('propertyTypes.villa', 'Villas'),
      description: "Standalone houses, villas, and townhouses",
      icon: <Home className="h-8 w-8" />,
      available: true,
      path: `/submit-property/form?type=${PROPERTY_TYPES.VILLA}`
    },
    {
      type: PROPERTY_TYPES.LAND,
      title: t('propertyTypes.land', 'Land'),
      description: "Empty plots, agricultural land, and lots",
      icon: <Landmark className="h-8 w-8" />,
      available: true,
      path: `/submit-property/form?type=${PROPERTY_TYPES.LAND}`
    },
    {
      type: PROPERTY_TYPES.COMMERCIAL,
      title: t('propertyTypes.commercial', 'Commercial'),
      description: "Offices, retail spaces, and warehouses",
      icon: <Store className="h-8 w-8" />,
      available: true,
      path: `/submit-property/form?type=${PROPERTY_TYPES.COMMERCIAL}`
    },
    {
      type: PROPERTY_TYPES.PROJECT,
      title: t('propertyTypes.project', 'Off-Plan Projects'),
      description: "Pre-construction developments and projects",
      icon: <FileText className="h-8 w-8" />,
      available: canAddOffPlan,
      path: `/submit-property/form?type=${PROPERTY_TYPES.PROJECT}`
    }
  ];
  
  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Choose Property Type</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Select the type of property you want to list. All submissions require admin approval.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {propertyTypes.map((propertyType) => (
            <Card 
              key={propertyType.type} 
              className={`relative cursor-pointer transition-all duration-200 ${
                propertyType.available 
                  ? 'hover:shadow-lg hover:scale-105 border-transparent hover:border-primary-200' 
                  : 'opacity-50 cursor-not-allowed bg-gray-100'
              }`}
            >
              <CardHeader className="text-center">
                <div className={`mx-auto mb-4 p-4 rounded-full ${
                  propertyType.available 
                    ? 'bg-primary-100 text-primary-600' 
                    : 'bg-gray-200 text-gray-400'
                }`}>
                  {propertyType.icon}
                </div>
                <CardTitle className="text-xl mb-2">{propertyType.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-gray-600 mb-6">{propertyType.description}</p>
                
                {propertyType.available ? (
                  <Button asChild className="w-full">
                    <Link href={propertyType.path}>
                      Select {propertyType.title}
                    </Link>
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center space-x-2 text-amber-600">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-sm font-medium">Restricted Access</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      Only authorized admins can add off-plan projects
                    </p>
                    <Button disabled className="w-full">
                      Access Denied
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {!canAddOffPlan && (
          <div className="mt-8 text-center">
            <div className="inline-flex items-center space-x-2 bg-amber-50 text-amber-700 px-4 py-2 rounded-lg">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">
                Need to add off-plan projects? Contact your administrator.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SubmitProperty;
