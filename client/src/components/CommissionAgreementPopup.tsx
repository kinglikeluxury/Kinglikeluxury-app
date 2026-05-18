import { useState } from "react";
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

const LEGAL_TEXT = `COMMISSION AGREEMENT — Kinglike Luxury Real Estate Platform

This Commission Agreement ("Agreement") is entered into between:

• PLATFORM: Kinglike Luxury Real Estate, hereinafter referred to as "the Platform"
• PROPERTY OWNER: The registered user submitting this property listing, hereinafter referred to as "the Owner"

1. COMMISSION OBLIGATION
The Owner agrees that upon the successful sale, lease, or transfer of the listed property facilitated through the Platform, the Owner shall pay to the Platform a commission fee equal to three percent (3%) of the final agreed transaction price.

2. PAYMENT TERMS
The commission shall be payable within seven (7) business days of the completion of the transaction. Failure to pay within this period may result in legal action.

3. PLATFORM SERVICES
In consideration of the commission, the Platform agrees to:
- Display the property listing to prospective buyers and investors
- Facilitate communication between the Owner and interested parties
- Provide marketing and promotional services through the Platform channels

4. BINDING NATURE
By electronically accepting this Agreement (by checking the acceptance box and submitting the listing), the Owner acknowledges that this Agreement is legally binding and enforceable.

5. GOVERNING LAW
This Agreement shall be governed by applicable laws. Any disputes arising from this Agreement shall be resolved through competent courts.

6. ELECTRONIC SIGNATURE
The Owner's electronic signature (username and timestamp recorded at the time of acceptance) shall have the same legal effect as a handwritten signature.

Kinglike Luxury Real Estate Platform
Authorized Representative: Management Team
Pre-signed electronically on behalf of Kinglike Luxury Real Estate`;

export function CommissionAgreementPopup({
  open,
  onClose,
  onAccept,
  price,
  username,
}: CommissionAgreementPopupProps) {
  const [agreed, setAgreed] = useState(false);

  const commission = Math.round(price * COMMISSION_RATE);
  const netPrice = price - commission;

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

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
            Commission Agreement — 3% Platform Fee
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-gradient-to-r from-[#005476]/10 to-[#3bcac4]/10 rounded-xl p-4 border border-[#3bcac4]/30">
            <p className="text-sm font-semibold text-[#005476] mb-3">
              Commission Breakdown (automatically calculated):
            </p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <p className="text-xs text-gray-500 mb-1">Your Listed Price</p>
                <p className="text-base font-bold text-gray-800">{fmt(price)}</p>
              </div>
              <div className="bg-white rounded-lg p-3 shadow-sm border border-[#3bcac4]/40">
                <p className="text-xs text-gray-500 mb-1">Platform Commission (3%)</p>
                <p className="text-base font-bold text-[#005476]">{fmt(commission)}</p>
              </div>
              <div className="bg-[#005476] rounded-lg p-3 shadow-sm">
                <p className="text-xs text-[#3bcac4] mb-1">You Receive</p>
                <p className="text-base font-bold text-white">{fmt(netPrice)}</p>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-3 text-center">
              Any contact from prospective clients will be provided to you along with full transaction details.
            </p>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-100 px-4 py-2 border-b border-gray-200">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Legal Agreement — Please Read Carefully
              </p>
            </div>
            <div className="p-4 max-h-52 overflow-y-auto bg-white">
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                {LEGAL_TEXT}
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
                I, <strong>{username}</strong>, hereby agree to the terms of this Commission Agreement and acknowledge that a 3% platform commission ({fmt(commission)}) will be deducted from the sale proceeds of this property. I understand this agreement is legally binding.
              </span>
            </label>
            {agreed && (
              <div className="mt-3 pt-3 border-t border-amber-200">
                <Badge className="bg-[#005476] text-white text-xs">
                  ✓ Electronic Signature: {username} — {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </Badge>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleAccept}
            disabled={!agreed}
            className="bg-gradient-to-r from-[#005476] to-[#3bcac4] text-white hover:opacity-90"
          >
            Accept & Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
