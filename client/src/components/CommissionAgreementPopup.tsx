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
const CONTACT_NUMBER = "+995 591 000 058";

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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 overflow-hidden border-0 shadow-2xl">

        {/* Header */}
        <div className="bg-gradient-to-r from-[#005476] to-[#007a9e] px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-full p-2">
              <span className="text-2xl">📋</span>
            </div>
            <div>
              <DialogTitle className="text-white text-xl font-bold tracking-tight">
                {t("commission.title")}
              </DialogTitle>
              <p className="text-[#3bcac4] text-sm mt-0.5">Kinglike Luxury Real Estate</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Price Breakdown */}
          <div>
            <p className="text-xs font-bold text-[#005476] uppercase tracking-widest mb-3">
              {t("commission.breakdown")}
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  {t("commission.listedPrice")}
                </p>
                <p className="text-lg font-extrabold text-slate-800">{fmt(price)}</p>
              </div>

              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-2">
                  {t("commission.commission")}
                </p>
                <p className="text-lg font-extrabold text-red-600">{fmt(commission)}</p>
                <p className="text-[10px] text-red-400 mt-1">3%</p>
              </div>

              <div className="bg-gradient-to-b from-[#005476] to-[#003a52] rounded-xl p-4 text-center shadow-lg">
                <p className="text-[10px] font-semibold text-[#3bcac4] uppercase tracking-wide mb-2">
                  {t("commission.youReceive")}
                </p>
                <p className="text-lg font-extrabold text-white">{fmt(netPrice)}</p>
              </div>
            </div>

            <div className="mt-3 bg-[#3bcac4]/10 border border-[#3bcac4]/40 rounded-lg px-4 py-2.5 flex items-start gap-2">
              <span className="text-[#005476] mt-0.5">📞</span>
              <p className="text-xs text-[#005476] font-medium leading-relaxed">
                {t("commission.contactNote")}
              </p>
            </div>
          </div>

          {/* Legal Section */}
          <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm">
            <div className="bg-[#005476] px-4 py-2.5 flex items-center gap-2">
              <span className="text-white text-sm">⚖️</span>
              <p className="text-xs font-bold text-white uppercase tracking-widest">
                {t("commission.legalTitle")}
              </p>
            </div>
            <div className="p-4 max-h-48 overflow-y-auto bg-slate-50">
              <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                {t("commission.legalText")}
              </pre>
            </div>
          </div>

          {/* Agreement Checkbox */}
          <div className={`rounded-xl p-4 border-2 transition-all duration-200 ${agreed ? "bg-green-50 border-green-400" : "bg-amber-50 border-amber-300"}`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-[#005476] flex-shrink-0"
              />
              <span className={`text-sm font-medium leading-relaxed ${agreed ? "text-green-800" : "text-amber-900"}`}>
                {t("commission.agreeText", { name: username, amount: fmt(commission) })}
              </span>
            </label>
            {agreed && (
              <div className="mt-3 pt-3 border-t border-green-300 flex items-center gap-2">
                <span className="text-green-600 text-sm">✅</span>
                <Badge className="bg-green-700 text-white text-xs font-medium">
                  {t("commission.signatureLabel", { name: username, date: now })}
                </Badge>
              </div>
            )}
          </div>

          {/* Contact Info */}
          <div className="bg-gradient-to-r from-[#005476] to-[#007a9e] rounded-xl px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-[#3bcac4] text-xs font-semibold uppercase tracking-wider mb-1">
                للتواصل والاستفسار
              </p>
              <p className="text-white font-bold text-lg tracking-wide">{CONTACT_NUMBER}</p>
            </div>
            <div className="bg-white/20 rounded-full p-3">
              <span className="text-2xl">📱</span>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-slate-300 text-slate-600 hover:bg-slate-100 font-semibold"
          >
            {t("commission.cancel")}
          </Button>
          <Button
            onClick={handleAccept}
            disabled={!agreed}
            className="bg-gradient-to-r from-[#005476] to-[#3bcac4] text-white hover:opacity-90 font-bold px-6 shadow-lg disabled:opacity-40"
          >
            {t("commission.accept")}
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  );
}
