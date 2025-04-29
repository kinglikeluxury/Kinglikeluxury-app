import { useAuth } from "@/lib/auth";
import { Redirect } from "wouter";
import PropertyForm from "@/components/property/PropertyForm";

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
  
  return (
    <div className="bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Submit Property</h1>
          <p className="text-gray-600 mt-1">
            Fill in the details below to list your property. All submissions require admin approval.
          </p>
        </div>
        
        <PropertyForm isAdmin={user.isAdmin} />
      </div>
    </div>
  );
};

export default SubmitProperty;
