import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const CallToAction = () => {
  return (
    <div className="bg-white py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-primary-700 rounded-lg shadow-xl overflow-hidden">
          <div className="px-6 py-12 md:py-16 md:px-12 lg:flex lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                <span className="block">Have a property to sell or rent?</span>
                <span className="block text-primary-200">List it on our platform for free.</span>
              </h2>
              <p className="mt-3 max-w-md text-lg text-primary-200">
                Reach thousands of potential buyers and tenants by uploading your property today.
              </p>
            </div>
            <div className="mt-8 flex lg:mt-0 lg:flex-shrink-0">
              <div className="inline-flex rounded-md shadow">
                <Button variant="secondary" size="lg" asChild>
                  <Link href="/submit-property">
                    Upload Property
                  </Link>
                </Button>
              </div>
              <div className="ml-3 inline-flex rounded-md shadow">
                <Button variant="default" size="lg" asChild>
                  <Link href="/properties">
                    Browse Listings
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CallToAction;
