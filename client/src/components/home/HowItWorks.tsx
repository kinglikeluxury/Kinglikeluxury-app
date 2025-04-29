import { PenLine, Upload, CheckCircle } from "lucide-react";

const HowItWorks = () => {
  const steps = [
    {
      icon: <PenLine className="h-8 w-8" />,
      title: "1. Create Account",
      description: "Sign up for a free account to access all our platform features.",
    },
    {
      icon: <Upload className="h-8 w-8" />,
      title: "2. Submit Property",
      description: "Fill out the property details form and upload high-quality photos.",
    },
    {
      icon: <CheckCircle className="h-8 w-8" />,
      title: "3. Get Approved",
      description: "Once reviewed and approved, your property will be listed on our platform.",
    },
  ];

  return (
    <div className="bg-white py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900">How It Works</h2>
          <p className="mt-4 max-w-2xl mx-auto text-xl text-gray-500">
            Easy steps to list your property on our platform
          </p>
        </div>

        <div className="mt-16">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {steps.map((step, index) => (
              <div key={index} className="text-center">
                <div className="flex items-center justify-center h-16 w-16 rounded-full bg-primary-100 text-primary-600 mx-auto">
                  {step.icon}
                </div>
                <h3 className="mt-6 text-xl font-medium text-gray-900">{step.title}</h3>
                <p className="mt-2 text-base text-gray-500">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HowItWorks;
