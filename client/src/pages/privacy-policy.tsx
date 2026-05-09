import { useTranslation } from 'react-i18next';
import { Shield, Lock, Eye, Database, Mail, Globe, ChevronRight } from 'lucide-react';

export default function PrivacyPolicyPage() {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar' || i18n.language === 'he';

  const sections = [
    {
      icon: Database,
      title: isRTL ? 'البيانات التي نجمعها' : 'Information We Collect',
      content: isRTL
        ? 'نجمع المعلومات التي تقدمها مباشرةً عند التسجيل أو نشر عقار أو التواصل معنا، وتشمل: الاسم، رقم الهاتف، البريد الإلكتروني، ومعلومات العقار. كما قد نجمع بيانات الاستخدام تلقائياً مثل عنوان IP ونوع المتصفح ووقت الزيارة.'
        : 'We collect information you provide directly when registering, listing a property, or contacting us — including name, phone number, email address, and property details. We may also collect usage data automatically such as IP address, browser type, and visit timestamps.',
    },
    {
      icon: Eye,
      title: isRTL ? 'كيف نستخدم بياناتك' : 'How We Use Your Data',
      content: isRTL
        ? 'نستخدم معلوماتك لتفعيل حسابك، عرض عقاراتك، التواصل معك بشأن خدماتنا، تحسين منصتنا، وإرسال إشعارات متعلقة بحسابك. لا نبيع بياناتك الشخصية لأي طرف ثالث.'
        : 'We use your information to activate your account, display your listings, communicate about our services, improve our platform, and send account-related notifications. We do not sell your personal data to any third party.',
    },
    {
      icon: Lock,
      title: isRTL ? 'حماية بياناتك' : 'Data Security',
      content: isRTL
        ? 'نطبق تدابير أمنية قياسية في الصناعة لحماية بياناتك، تشمل التشفير أثناء النقل (HTTPS) وتشفير كلمات المرور وقواعد بيانات محمية. رغم ذلك، لا يمكن ضمان أمان مطلق عبر الإنترنت.'
        : 'We implement industry-standard security measures to protect your data, including HTTPS encryption in transit, password hashing, and secured databases. However, no method of transmission over the Internet can be guaranteed 100% secure.',
    },
    {
      icon: Globe,
      title: isRTL ? 'ملفات الارتباط (Cookies)' : 'Cookies',
      content: isRTL
        ? 'نستخدم ملفات الارتباط للحفاظ على جلسة تسجيل الدخول، وتذكر تفضيلات اللغة، وتحليل استخدام المنصة. يمكنك إيقاف ملفات الارتباط من إعدادات متصفحك، لكن ذلك قد يؤثر على بعض وظائف الموقع.'
        : 'We use cookies to maintain your login session, remember language preferences, and analyze platform usage. You may disable cookies via your browser settings, though this may affect some site functionality.',
    },
    {
      icon: Shield,
      title: isRTL ? 'حقوقك' : 'Your Rights',
      content: isRTL
        ? 'يحق لك في أي وقت: الاطلاع على بياناتك الشخصية المحفوظة، طلب تصحيحها أو حذفها، سحب موافقتك على معالجة بياناتك. للاستفسار، تواصل معنا عبر البريد الإلكتروني أو أرقام التواصل المدرجة في الموقع.'
        : 'You have the right at any time to: access your personal data we hold, request correction or deletion, and withdraw your consent to data processing. To exercise these rights, contact us via the email or phone numbers listed on our platform.',
    },
    {
      icon: Mail,
      title: isRTL ? 'التواصل معنا' : 'Contact Us',
      content: isRTL
        ? 'إذا كانت لديك أسئلة حول سياسة الخصوصية هذه، يمكنك التواصل مع فريق Kinglike Luxury عبر القنوات الرسمية المتاحة في الموقع. نلتزم بالرد خلال 48 ساعة عمل.'
        : 'If you have any questions about this Privacy Policy, please reach out to the Kinglike Luxury team via the official channels available on the platform. We commit to responding within 48 business hours.',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Hero Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#005476] to-[#3bcac4] py-16 px-4">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-40 h-40 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-10 right-10 w-60 h-60 rounded-full bg-white blur-3xl" />
        </div>
        <div className="relative max-w-3xl mx-auto text-center text-white">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm mb-4">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            {isRTL ? 'سياسة الخصوصية' : 'Privacy Policy'}
          </h1>
          <p className="text-white/80 text-sm">
            {isRTL
              ? 'آخر تحديث: يناير 2025 • Kinglike Luxury Real Estate'
              : 'Last updated: January 2025 • Kinglike Luxury Real Estate'}
          </p>
        </div>
      </div>

      {/* Intro */}
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="bg-[#3bcac4]/10 border border-[#3bcac4]/30 rounded-2xl p-5 mb-8">
          <p className="text-gray-700 leading-relaxed text-sm">
            {isRTL
              ? 'تصف هذه السياسة كيفية جمع Kinglike Luxury للمعلومات الشخصية واستخدامها وحمايتها عند استخدامك لمنصتنا. باستخدامك للموقع، فإنك توافق على الشروط الواردة في هذه الوثيقة.'
              : 'This policy describes how Kinglike Luxury collects, uses, and protects personal information when you use our platform. By using our site, you agree to the practices described in this document.'}
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-5">
          {sections.map((section, index) => (
            <div key={index} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="flex items-center gap-4 px-5 py-4 border-b border-gray-50">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #3bcac4, #005476)' }}>
                  <section.icon className="w-5 h-5 text-white" />
                </div>
                <h2 className="font-semibold text-gray-900 text-[15px]">{section.title}</h2>
              </div>
              <div className="px-5 py-4">
                <p className="text-gray-600 text-sm leading-relaxed">{section.content}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <div className="mt-8 text-center text-xs text-gray-400 pb-8">
          © 2025 Kinglike Luxury Real Estate. {isRTL ? 'جميع الحقوق محفوظة.' : 'All rights reserved.'}
        </div>
      </div>
    </div>
  );
}
