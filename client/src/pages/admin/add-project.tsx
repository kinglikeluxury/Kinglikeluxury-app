import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import PropertyForm from "@/components/property/PropertyForm";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

const AddProject = () => {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  // Redirect if not admin
  useEffect(() => {
    if (!authLoading && (!user || !user.isAdmin)) {
      navigate("/");
    }
  }, [user, authLoading, navigate]);

  if (authLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <span className="text-gray-500">Loading...</span>
      </div>
    );
  }

  if (!user?.isAdmin) {
    return null; // Will redirect due to useEffect
  }

  return (
    <div className="bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-4">
          <Button variant="outline" onClick={() => navigate("/admin/dashboard")} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
          
          <h1 className="text-2xl font-bold text-gray-900">Add Construction Project</h1>
          <p className="text-gray-600 mt-1">
            Add a new construction project that will be immediately visible to users without requiring approval
          </p>
        </div>
        
        <PropertyForm isAdmin={true} />
      </div>
    </div>
  );
};

export default AddProject;
