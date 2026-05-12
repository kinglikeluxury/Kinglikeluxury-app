import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import BottomNav from "@/components/layout/BottomNav";
import Home from "@/pages/home";
import Properties from "@/pages/properties";
import PropertyDetail from "@/pages/property-detail";
import SubmitProperty from "@/pages/submit-property";
import PropertyForm from "@/pages/property-form";
import Projects from "@/pages/projects";
import Login from "@/pages/login";
import Register from "@/pages/register";
import AdminDashboard from "@/pages/admin/dashboard";
import Approvals from "@/pages/admin/approvals";
import AddProject from "@/pages/admin/add-project";
import BlogManagement from "@/pages/admin/blog-management";
import LeadsPage from "@/pages/admin/leads";
import NotFound from "@/pages/not-found";
import Blog from "@/pages/blog";
import BlogPost from "@/pages/blog-post";
import Favorites from "@/pages/favorites";
import MapView from "@/pages/map-view";
import { PaymentSuccess, PaymentFail } from "@/pages/payment-result";
import ChangePassword from "@/pages/change-password";
import ForgotPassword from "@/pages/forgot-password";
import PrivacyPolicy from "@/pages/privacy-policy";
import Terms from "@/pages/terms";
import PrivacyTerms from "@/pages/privacy-terms";
import InstallPWA from "@/components/InstallPWA";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { getLanguageDirection } from "./lib/i18n";

function Router() {
  const [location] = useLocation();

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-grow pb-16 md:pb-0 page-transition">
        <Switch key={location}>
          <Route path="/" component={Home} />
          <Route path="/properties" component={Properties} />
          <Route path="/projects" component={Projects} />
          <Route path="/blog" component={Blog} />
          <Route path="/blog/:slug" component={BlogPost} />
          <Route path="/property/:id" component={PropertyDetail} />
          <Route path="/submit-property" component={SubmitProperty} />
          <Route path="/submit-property/form" component={PropertyForm} />
          <Route path="/property/:id/edit" component={PropertyForm} />
          <Route path="/login" component={Login} />
          <Route path="/register" component={Register} />
          <Route path="/admin/dashboard" component={AdminDashboard} />
          <Route path="/admin/approvals" component={Approvals} />
          <Route path="/admin/add-project" component={AddProject} />
          <Route path="/admin/blog" component={BlogManagement} />
          <Route path="/admin/leads" component={LeadsPage} />
          <Route path="/favorites" component={Favorites} />
          <Route path="/map" component={MapView} />
          <Route path="/payment/success" component={PaymentSuccess} />
          <Route path="/payment/fail" component={PaymentFail} />
          <Route path="/change-password" component={ChangePassword} />
          <Route path="/forgot-password" component={ForgotPassword} />
          <Route path="/privacy-policy" component={PrivacyPolicy} />
          <Route path="/terms" component={Terms} />
          <Route path="/privacy-terms" component={PrivacyTerms} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <div className="hidden md:block">
        <Footer />
      </div>
      <BottomNav />
    </div>
  );
}

function App() {
  const { i18n } = useTranslation();
  
  useEffect(() => {
    document.documentElement.dir = getLanguageDirection(i18n.language);
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <InstallPWA />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
