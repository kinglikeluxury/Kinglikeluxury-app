import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Sparkles, ArrowRight } from "lucide-react";

export default function AiAdvisorCTA() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();

  return (
    <section className="px-4 py-10">
      <div
        className="max-w-4xl mx-auto rounded-3xl overflow-hidden relative cursor-pointer group"
        onClick={() => navigate("/ai-advisor")}
        style={{ background: "linear-gradient(135deg, #005476 0%, #3bcac4 100%)" }}
      >
        {/* Subtle pattern */}
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 50%, white 1px, transparent 1px)",
          backgroundSize: "60px 60px"
        }} />

        <div className="relative px-8 py-10 flex flex-col sm:flex-row items-center gap-6">
          {/* Icon */}
          <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-8 h-8 text-white" />
          </div>

          {/* Text */}
          <div className="flex-1 text-center sm:text-left">
            <h2 className="text-2xl font-bold text-white mb-2">
              {t("aiAdvisor.homeCta.title", "Find the best property for your goals")}
            </h2>
            <p className="text-white/80 text-sm leading-relaxed">
              {t("aiAdvisor.homeCta.subtitle", "Our AI advisor will understand your investment goals, budget, and preferences — then our team prepares personalized opportunities for you.")}
            </p>
          </div>

          {/* Button */}
          <div className="flex-shrink-0">
            <div className="inline-flex items-center gap-2 bg-white text-[#005476] font-semibold px-6 py-3 rounded-2xl text-sm group-hover:shadow-lg transition-shadow">
              {t("aiAdvisor.homeCta.button", "Start Now")}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
