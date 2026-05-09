import { useTranslation } from 'react-i18next';
import { FileText, Home, AlertTriangle, CreditCard, UserX, Gavel, HelpCircle } from 'lucide-react';

export default function TermsPage() {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar' || i18n.language === 'he';

  const sections = [
    {
      icon: Home,
      title: isRTL ? 'استخدام المنصة' : 'Use of the Platform',
      content: isRTL
        ? 'Kinglike Luxury هي منصة إلكترونية لعرض العقارات الفاخرة. يُسمح باستخدام المنصة لأغراض مشروعة فقط، بما في ذلك البحث عن العقارات، نشر الإعلانات العقارية، والتواصل مع المُعلنين. يُحظر أي استخدام مخالف للقانون أو الأخلاق.'
        : 'Kinglike Luxury is an online platform for showcasing luxury real estate. Use of the platform is permitted for lawful purposes only, including property search, listing publication, and communicating with advertisers. Any illegal or unethical use is strictly prohibited.',
    },
    {
      icon: FileText,
      title: isRTL ? 'إعلانات العقارات' : 'Property Listings',
      content: isRTL
        ? 'يلتزم المُعلن بأن تكون المعلومات المقدمة صحيحة ودقيقة وغير مضللة. تخضع جميع الإعلانات لمراجعة إدارية قبل النشر. تحتفظ المنصة بحق رفض أو إزالة أي إعلان يخالف الشروط أو السياسات المعتمدة دون إشعار مسبق.'
        : 'Advertisers are responsible for ensuring all submitted information is accurate, truthful, and not misleading. All listings are subject to administrative review before publication. The platform reserves the right to reject or remove any listing that violates these terms or our policies without prior notice.',
    },
    {
      icon: CreditCard,
      title: isRTL ? 'الاشتراكات والمدفوعات' : 'Subscriptions & Payments',
      content: isRTL
        ? 'تتوفر خطط إعلانية مدفوعة (VIP وSuperVIP) تمنح مزايا إضافية في العرض والترتيب. جميع المدفوعات نهائية وغير قابلة للاسترداد إلا في حالات استثنائية يقررها فريق الدعم. يتم معالجة المدفوعات عبر بوابات آمنة ومرخصة.'
        : 'Paid listing plans (VIP and SuperVIP) are available, offering enhanced visibility and placement. All payments are final and non-refundable except in exceptional cases determined by our support team. Payments are processed via secure, licensed payment gateways.',
    },
    {
      icon: AlertTriangle,
      title: isRTL ? 'إخلاء المسؤولية' : 'Disclaimer',
      content: isRTL
        ? 'تعمل Kinglike Luxury كوسيط إلكتروني فقط بين البائعين والمشترين، ولا تتحمل مسؤولية قانونية عن أي صفقات تتم بين الأطراف. المعلومات المنشورة مقدمة من المُعلنين وقد لا تعكس الواقع الحالي للعقار. يُنصح المستخدمون بالتحقق من المعلومات قبل اتخاذ أي قرار.'
        : 'Kinglike Luxury acts solely as an electronic intermediary between sellers and buyers and bears no legal responsibility for transactions between parties. Published information is provided by advertisers and may not reflect the current state of the property. Users are advised to independently verify all information before making any decision.',
    },
    {
      icon: UserX,
      title: isRTL ? 'تعليق الحسابات' : 'Account Suspension',
      content: isRTL
        ? 'تحتفظ المنصة بحق تعليق أو إنهاء أي حساب في حال انتهاك هذه الشروط، أو نشر محتوى مزيف أو مضلل، أو استخدام المنصة لأغراض احتيالية. يحق للمستخدم الاعتراض عبر القنوات الرسمية للدعم.'
        : 'The platform reserves the right to suspend or terminate any account that violates these terms, publishes false or misleading content, or uses the platform for fraudulent purposes. Users may appeal via official support channels.',
    },
    {
      icon: Gavel,
      title: isRTL ? 'الاختصاص القضائي' : 'Governing Law',
      content: isRTL
        ? 'تخضع هذه الشروط لقوانين دولة الإمارات العربية المتحدة. أي نزاع ينشأ عن استخدام المنصة يُفضَّل حله وداً، وإن تعذر ذلك يخضع لاختصاص المحاكم المختصة في الإمارات.'
        : 'These Terms are governed by the laws of the United Arab Emirates. Any dispute arising from use of the platform shall preferably be resolved amicably; otherwise it shall be subject to the jurisdiction of the competent courts in the UAE.',
    },
    {
      icon: HelpCircle,
      title: isRTL ? 'التحديثات والتعديلات' : 'Updates & Amendments',
      content: isRTL
        ? 'تحتفظ Kinglike Luxury بحق تعديل هذه الشروط في أي وقت. سيتم إشعار المستخدمين بأي تغييرات جوهرية عبر البريد الإلكتروني أو الإشعارات داخل التطبيق. الاستمرار في استخدام المنصة بعد التعديلات يعني قبول الشروط الجديدة.'
        : 'Kinglike Luxury reserves the right to amend these Terms at any time. Users will be notified of any material changes via email or in-app notifications. Continued use of the platform after amendments constitutes acceptance of the revised Terms.',
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
            <FileText className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            {isRTL ? 'الشروط والأحكام' : 'Terms & Conditions'}
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
              ? 'يُرجى قراءة هذه الشروط والأحكام بعناية قبل استخدام منصة Kinglike Luxury. باستخدامك للمنصة، فإنك توافق على الالتزام بجميع الشروط الواردة في هذه الوثيقة.'
              : 'Please read these Terms and Conditions carefully before using the Kinglike Luxury platform. By using the platform, you agree to be bound by all the terms described in this document.'}
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
