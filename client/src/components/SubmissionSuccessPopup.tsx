import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, Clock, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";

interface SubmissionSuccessPopupProps {
  open: boolean;
  onClose: () => void;
}

export function SubmissionSuccessPopup({ open, onClose }: SubmissionSuccessPopupProps) {
  const { t, i18n } = useTranslation();
  const isRTL = ['ar', 'he'].includes(i18n.language);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-md mx-auto p-0 overflow-hidden border-0 shadow-2xl"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Header gradient */}
        <div className="bg-gradient-to-br from-[#005476] to-[#003a52] px-6 py-8 text-center">
          {/* Animated checkmark */}
          <div className="relative mx-auto mb-4 w-20 h-20">
            <div className="absolute inset-0 rounded-full bg-[#3bcac4]/20 animate-ping" />
            <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#2aada7] flex items-center justify-center shadow-lg shadow-[#3bcac4]/30">
              <CheckCircle className="w-10 h-10 text-white" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-white mb-2">
            {t('submission.successTitle', 'تم الإرسال بنجاح!')}
          </h2>
          <p className="text-[#3bcac4] text-sm font-medium">
            {t('submission.successSubtitle', 'شكراً لك على ثقتك بـ Kinglike Luxury')}
          </p>
        </div>

        {/* Body */}
        <div className="bg-white px-6 py-6">
          {/* Main message */}
          <div className="flex gap-3 mb-5 p-4 rounded-xl bg-[#005476]/5 border border-[#3bcac4]/30">
            <Clock className="w-5 h-5 text-[#3bcac4] mt-0.5 shrink-0" />
            <p className="text-gray-700 text-sm leading-relaxed font-medium">
              {t('submission.pendingMessage',
                'سيتم نشر العقار قريباً جداً بعد موافقة إدارة التطبيق'
              )}
            </p>
          </div>

          {/* Steps */}
          <div className="space-y-3 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-[#3bcac4]/15 flex items-center justify-center shrink-0">
                <span className="text-[#005476] text-xs font-bold">1</span>
              </div>
              <p className="text-gray-600 text-sm">
                {t('submission.step1', 'سيراجع فريق الإدارة العقار')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-[#3bcac4]/15 flex items-center justify-center shrink-0">
                <span className="text-[#005476] text-xs font-bold">2</span>
              </div>
              <p className="text-gray-600 text-sm">
                {t('submission.step2', 'ستتلقى إشعاراً عند الموافقة')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-[#3bcac4]/15 flex items-center justify-center shrink-0">
                <span className="text-[#005476] text-xs font-bold">3</span>
              </div>
              <p className="text-gray-600 text-sm">
                {t('submission.step3', 'سيظهر عقارك للمشترين المحتملين')}
              </p>
            </div>
          </div>

          {/* Trust badge */}
          <div className="flex items-center gap-2 justify-center mb-6 text-xs text-gray-400">
            <Shield className="w-4 h-4 text-[#3bcac4]" />
            <span>{t('submission.trustBadge', 'مراجعة آمنة وسريعة من قِبل الإدارة')}</span>
          </div>

          {/* CTA Button */}
          <Button
            onClick={onClose}
            className="w-full h-12 bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#2aada7] hover:to-[#003a52] text-white font-semibold rounded-xl text-base shadow-lg shadow-[#3bcac4]/20 transition-all duration-200"
          >
            {t('submission.understood', 'حسناً، شكراً!')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
