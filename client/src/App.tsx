import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
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
import NotFound from "@/pages/not-found";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { getLanguageDirection } from "./lib/i18n";
import { TestI18n } from "@/components/TestI18n";

function Router() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-grow">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/properties" component={Properties} />
          <Route path="/projects" component={Projects} />
          <Route path="/property/:id" component={PropertyDetail} />
          <Route path="/submit-property" component={SubmitProperty} />
          <Route path="/submit-property/form" component={PropertyForm} />
          <Route path="/login" component={Login} />
          <Route path="/register" component={Register} />
          <Route path="/admin/dashboard" component={AdminDashboard} />
          <Route path="/admin/approvals" component={Approvals} />
          <Route path="/admin/add-project" component={AddProject} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <Footer />
    </div>
  );
}

function App() {
  const { i18n } = useTranslation();
  
  // Set document direction based on language (RTL for Arabic and Hebrew)
  useEffect(() => {
    document.documentElement.dir = getLanguageDirection(i18n.language);
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
          <TestI18n />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
