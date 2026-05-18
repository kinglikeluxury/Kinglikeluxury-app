import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface CommissionAgreementPopupProps {
  open: boolean;
  onClose: () => void;
  onAccept: (signature: string) => void;
  price: number;
  username: string;
}

const COMMISSION_RATE = 0.03;

export function CommissionAgreementPopup({
  open,
  onClose,
  onAccept,
  price,
  username,
}: CommissionAgreementPopupProps) {
  const { t } = useTranslation();
  const [agreed, setAgreed] = useState(false);

  const commission = Math.round(price * COMMISSION_RATE);
  const netPrice = price - commission;

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

  const now = new Date().toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const handleAccept = () => {
    if (!agreed) return;
    onAccept(username);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#005476] text-xl flex items-center gap-2">
            <span className="text-2xl">📋</span>
            {t("commission.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-gradient-to-r from-[#005476]/10 to-[#3bcac4]/10 rounded-xl p-4 border border-[#3bcac4]/30">
            <p className="text-sm font-semibold text-[#005476] mb-3">
              {t("commission.breakdown")}
            </p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <p className="text-xs text-gray-500 mb-1">{t("commission.listedPrice")}</p>
                <p className="text-base font-bold text-gray-800">{fmt(price)}</p>
              </div>
              <div className="bg-white rounded-lg p-3 shadow-sm border border-[#3bcac4]/40">
                <p className="text-xs text-gray-500 mb-1">{t("commission.commission")}</p>
                <p className="text-base font-bold text-[#005476]">{fmt(commission)}</p>
              </div>
              <div className="bg-[#005476] rounded-lg p-3 shadow-sm">
                <p className="text-xs text-[#3bcac4] mb-1">{t("commission.youReceive")}</p>
                <p className="text-base font-bold text-white">{fmt(netPrice)}</p>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-3 text-center">
              {t("commission.contactNote")}
            </p>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-100 px-4 py-2 border-b border-gray-200">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                {t("commission.legalTitle")}
              </p>
            </div>
            <div className="p-4 max-h-52 overflow-y-auto bg-white">
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                {t("commission.legalText")}
              </pre>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-[#005476] flex-shrink-0"
              />
              <span className="text-sm text-amber-900">
                {t("commission.agreeText", { name: username, amount: fmt(commission) })}
              </span>
            </label>
            {agreed && (
              <div className="mt-3 pt-3 border-t border-amber-200">
                <Badge className="bg-[#005476] text-white text-xs">
                  ✓ {t("commission.signatureLabel", { name: username, date: now })}
                </Badge>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("commission.cancel")}
          </Button>
          <Button
            onClick={handleAccept}
            disabled={!agreed}
            className="bg-gradient-to-r from-[#005476] to-[#3bcac4] text-white hover:opacity-90"
          >
            {t("commission.accept")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
