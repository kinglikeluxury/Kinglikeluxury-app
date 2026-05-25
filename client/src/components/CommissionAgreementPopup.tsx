import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent } from "@/components/ui/dialog";

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
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);

  const now = new Date().toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const handleAccept = () => {
    if (!agreed) return;
    onAccept(username);
    setAgreed(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl p-0 border-0 shadow-2xl rounded-2xl overflow-hidden max-h-[95vh] overflow-y-auto bg-white">

        {/* ═══ HEADER ═══ */}
        <div className="relative overflow-hidden" style={{ background: "linear-gradient(135deg, #002f45 0%, #005476 50%, #0077a8 100%)" }}>
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 20px, rgba(255,255,255,0.15) 20px, rgba(255,255,255,0.15) 22px)" }} />
          <div className="relative px-7 py-6">
            <div className="flex items-center gap-1 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[#3bcac4]" />
              <div className="w-1.5 h-1.5 rounded-full bg-[#3bcac4]/60" />
              <div className="w-1.5 h-1.5 rounded-full bg-[#3bcac4]/30" />
            </div>
            <h2 className="text-white text-2xl font-black tracking-tight leading-tight">
              {t("commission.title")}
            </h2>
            <p className="text-[#3bcac4] text-sm font-semibold mt-1 tracking-wide">
              KINGLIKE LUXURY REAL ESTATE
            </p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* ═══ PRICE BREAKDOWN ═══ */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full bg-[#005476]" />
              <p className="text-xs font-black text-[#005476] uppercase tracking-[0.15em]">
                {t("commission.breakdown")}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {/* Listed Price */}
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-center shadow-sm">
                <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center mx-auto mb-2">
                  <span className="text-base">🏷️</span>
                </div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider leading-tight mb-1">
                  {t("commission.listedPrice")}
                </p>
                <p className="text-base font-black text-slate-900">{fmt(price)}</p>
              </div>

              {/* Commission */}
              <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-center shadow-sm">
                <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center mx-auto mb-2">
                  <span className="text-base">💼</span>
                </div>
                <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider leading-tight mb-1">
                  {t("commission.commission")}
                </p>
                <p className="text-base font-black text-red-600">{fmt(commission)}</p>
                <p className="text-[10px] font-bold text-red-400 mt-0.5">3%</p>
              </div>

              {/* Net */}
              <div className="rounded-xl p-3.5 text-center shadow-md"
                style={{ background: "linear-gradient(145deg, #005476, #003852)" }}>
                <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center mx-auto mb-2">
                  <span className="text-base">✅</span>
                </div>
                <p className="text-[10px] font-bold text-[#3bcac4] uppercase tracking-wider leading-tight mb-1">
                  {t("commission.youReceive")}
                </p>
                <p className="text-base font-black text-white">{fmt(netPrice)}</p>
              </div>
            </div>

            {/* Contact note */}
            <div className="mt-3 flex items-start gap-2.5 bg-[#005476]/8 border border-[#005476]/20 rounded-xl px-4 py-3">
              <span className="text-[#005476] text-base mt-0.5 flex-shrink-0">ℹ️</span>
              <p className="text-sm text-[#005476] font-medium leading-relaxed">
                {t("commission.contactNote")}
              </p>
            </div>
          </div>

          {/* ═══ DIVIDER ═══ */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">⚖️ {t("commission.legalTitle")}</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* ═══ LEGAL TEXT ═══ */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="max-h-44 overflow-y-auto px-5 py-4 bg-slate-50/80">
              <p className="text-sm text-slate-800 whitespace-pre-line leading-7">
                {t("commission.legalText")}
              </p>
            </div>
          </div>

          {/* ═══ AGREEMENT ═══ */}
          <div
            className={`rounded-xl border-2 p-4 transition-all duration-300 ${
              agreed
                ? "bg-emerald-50 border-emerald-400 shadow-emerald-100 shadow-md"
                : "bg-amber-50 border-amber-300"
            }`}
          >
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-all duration-200 ${
                agreed ? "bg-emerald-500 border-emerald-500" : "bg-white border-amber-400"
              }`}>
                {agreed && <span className="text-white text-xs font-black">✓</span>}
              </div>
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="sr-only"
              />
              <span className={`text-sm leading-relaxed font-medium ${agreed ? "text-emerald-900" : "text-amber-900"}`}>
                {t("commission.agreeText", { name: username, amount: fmt(commission) })}
              </span>
            </label>

            {agreed && (
              <div className="mt-3 pt-3 border-t border-emerald-300 flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[10px] font-black">✓</span>
                </div>
                <p className="text-xs text-emerald-800 font-semibold">
                  {t("commission.signatureLabel", { name: username, date: now })}
                </p>
              </div>
            )}
          </div>

          {/* ═══ CONTACT BAR ═══ */}
          <div
            className="rounded-xl px-5 py-4 flex items-center justify-between shadow-lg"
            style={{ background: "linear-gradient(135deg, #002f45, #005476, #0077a8)" }}
          >
            <div>
              <p className="text-[10px] font-black text-[#3bcac4] uppercase tracking-[0.2em] mb-1">
                للتواصل والاستفسار
              </p>
              <p className="text-white font-black text-xl tracking-widest" style={{ direction: "ltr" }}>
                {CONTACT_NUMBER}
              </p>
            </div>
            <div className="w-12 h-12 rounded-full bg-white/15 border border-white/25 flex items-center justify-center">
              <span className="text-2xl">📱</span>
            </div>
          </div>

          {/* ═══ FOOTER BUTTONS ═══ */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border-2 border-slate-300 text-slate-600 font-bold text-sm hover:bg-slate-50 hover:border-slate-400 transition-all duration-200"
            >
              {t("commission.cancel")}
            </button>
            <button
              onClick={handleAccept}
              disabled={!agreed}
              className="flex-2 flex-[2] py-3 rounded-xl font-black text-sm text-white shadow-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: agreed
                  ? "linear-gradient(135deg, #005476, #3bcac4)"
                  : "#94a3b8",
              }}
            >
              {t("commission.accept")}
            </button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
