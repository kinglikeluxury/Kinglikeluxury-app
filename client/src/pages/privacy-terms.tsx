import { useTranslation } from "react-i18next";
import { Shield, Mail, Globe } from "lucide-react";

export default function PrivacyTerms() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="py-12 px-4" style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}>
        <div className="max-w-3xl mx-auto text-center">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center">
              <Shield className="w-7 h-7 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
          <p className="mt-2 text-white/80 text-base">Kinglike Luxury</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">

        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <p className="text-gray-700 leading-relaxed">
            At <strong>Kinglike Luxury</strong>, we respect your privacy and are committed to protecting your personal information.
          </p>
          <p className="text-gray-700 leading-relaxed mt-3">
            By submitting your information through our website, Facebook Lead Forms, WhatsApp, or any of our advertisements, you agree to the collection and use of your information in accordance with this Privacy Policy.
          </p>
        </div>

        <Section title="Information We Collect">
          <ul className="space-y-2 mt-3">
            {["Full name", "Phone number", "Email address (if provided)", "Investment preferences and budget information"].map((item) => (
              <li key={item} className="flex items-start gap-2 text-gray-700">
                <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#3bcac4" }} />
                {item}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="How We Use Your Information">
          <ul className="space-y-2 mt-3">
            {[
              "Contacting you regarding real estate investment opportunities",
              "Providing project details, prices, and payment plans",
              "Customer support and follow-up communication",
              "Improving our services and advertising performance",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-gray-700">
                <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#3bcac4" }} />
                {item}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Data Protection">
          <p className="text-gray-700 mt-3 leading-relaxed">
            Kinglike Luxury does not sell, rent, or share your personal information with unauthorized third parties.
          </p>
          <p className="text-gray-700 mt-2 leading-relaxed">
            Your information is stored securely and accessed only by authorized representatives of our company.
          </p>
        </Section>

        <Section title="Communication">
          <p className="text-gray-700 mt-3 leading-relaxed">By submitting your information, you agree that our team may contact you via:</p>
          <ul className="space-y-2 mt-3">
            {["Phone calls", "WhatsApp", "SMS", "Email communication"].map((item) => (
              <li key={item} className="flex items-start gap-2 text-gray-700">
                <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#3bcac4" }} />
                {item}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Third-Party Platforms">
          <p className="text-gray-700 mt-3 leading-relaxed">
            Some lead forms and advertisements may be operated through third-party platforms such as Meta (Facebook & Instagram). These platforms may also process your data according to their own privacy policies.
          </p>
        </Section>

        <Section title="Your Rights">
          <p className="text-gray-700 mt-3 leading-relaxed">You may request:</p>
          <ul className="space-y-2 mt-3">
            {[
              "Access to your personal information",
              "Correction of inaccurate information",
              "Deletion of your data from our records",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-gray-700">
                <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#3bcac4" }} />
                {item}
              </li>
            ))}
          </ul>
          <p className="text-gray-700 mt-3 leading-relaxed">
            To request data removal or for any privacy-related inquiry, please contact us directly.
          </p>
        </Section>

        {/* Contact */}
        <div className="rounded-2xl p-6 text-white" style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}>
          <h2 className="text-xl font-bold mb-4">Contact Information</h2>
          <p className="font-semibold text-lg mb-3">Kinglike Luxury</p>
          <div className="space-y-2">
            <a href="https://kinglikeluxury.app" className="flex items-center gap-2 text-white/90 hover:text-white">
              <Globe className="w-4 h-4 flex-shrink-0" />
              kinglikeluxury.app
            </a>
            <a href="mailto:info@kinglikeluxury.app" className="flex items-center gap-2 text-white/90 hover:text-white">
              <Mail className="w-4 h-4 flex-shrink-0" />
              info@kinglikeluxury.app
            </a>
          </div>
        </div>

      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm">
      <h2 className="text-lg font-bold" style={{ color: "#005476" }}>{title}</h2>
      {children}
    </div>
  );
}
