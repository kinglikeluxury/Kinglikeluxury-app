import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
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
import ProjectOffer from "@/pages/admin/project-offer";
import AdminNotificationsPage from "@/pages/admin/notifications";
import EmailCampaignPage from "@/pages/admin/email-campaign";
import ConsultationBooking from "@/pages/consultation-booking";
import AdminConsultations from "@/pages/admin/consultations";
import UserNotificationsPage from "@/pages/notifications";
import NotFound from "@/pages/not-found";
import Blog from "@/pages/blog";
import BlogPost from "@/pages/blog-post";
import BlogPostLang from "@/pages/blog-post-lang";
import Favorites from "@/pages/favorites";
import MapView from "@/pages/map-view";
import { PaymentSuccess, PaymentFail } from "@/pages/payment-result";
import ChangePassword from "@/pages/change-password";
import ForgotPassword from "@/pages/forgot-password";
import PrivacyPolicy from "@/pages/privacy-policy";
import Terms from "@/pages/terms";
import PrivacyTerms from "@/pages/privacy-terms";
import AiAdvisorPage from "@/pages/ai-advisor";
import AiLeadsPage from "@/pages/admin/ai-leads";
import InstallPWA from "@/components/InstallPWA";
import SplashScreen from "@/components/SplashScreen";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
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
          <Route path="/:lang/blog/:slug" component={BlogPostLang} />
          <Route path="/property/:slug" component={PropertyDetail} />
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
          <Route path="/admin/project-offer" component={ProjectOffer} />
          <Route path="/admin/notifications" component={AdminNotificationsPage} />
          <Route path="/admin/email-campaign" component={EmailCampaignPage} />
          <Route path="/admin/consultations" component={AdminConsultations} />
          <Route path="/admin/ai-leads" component={AiLeadsPage} />
          <Route path="/ai-advisor" component={AiAdvisorPage} />
          <Route path="/consultation" component={ConsultationBooking} />
          <Route path="/notifications" component={UserNotificationsPage} />
          <Route path="/favorites" component={Favorites} />
          <Route path="/map" component={MapView} />
          <Route path="/payment/success" component={PaymentSuccess} />
          <Route path="/payment/fail" component={PaymentFail} />
          <Route path="/change-password" component={ChangePassword} />
          <Route path="/forgot-password" component={ForgotPassword} />
          <Route path="/privacy-policy" component={PrivacyTerms} />
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
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    document.documentElement.dir = getLanguageDirection(i18n.language);
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <InstallPWA />
            {!splashDone && <SplashScreen onComplete={() => setSplashDone(true)} />}
            <div
              style={{
                opacity: splashDone ? 1 : 0,
                transition: "opacity 0.5s ease-in-out",
                pointerEvents: splashDone ? "auto" : "none",
              }}
            >
              <Router />
            </div>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

export default App;
