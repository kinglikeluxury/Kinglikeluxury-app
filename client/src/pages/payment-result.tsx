import { useEffect, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

export function PaymentSuccess() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const ref = new URLSearchParams(searchString).get("ref") || "";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
        <div className="flex justify-center mb-6">
          <CheckCircle className="w-20 h-20 text-green-500" />
        </div>
        <h1 className="text-3xl font-bold text-[#005476] mb-3">
          {t("payment.successTitle", "Payment Successful!")}
        </h1>
        <p className="text-gray-600 mb-2">
          {t("payment.successDesc", "Your featured listing has been activated.")}
        </p>
        {ref && (
          <p className="text-xs text-gray-400 mb-6">Ref: {ref}</p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <Button
            className="flex-1 bg-gradient-to-r from-[#005476] to-[#3bcac4] text-white"
            onClick={() => navigate("/")}
          >
            {t("payment.goHome", "Go to Home")}
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => navigate("/properties")}>
            {t("payment.viewListings", "View Listings")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PaymentFail() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const ref = new URLSearchParams(searchString).get("ref") || "";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
        <div className="flex justify-center mb-6">
          <XCircle className="w-20 h-20 text-red-500" />
        </div>
        <h1 className="text-3xl font-bold text-[#005476] mb-3">
          {t("payment.failTitle", "Payment Failed")}
        </h1>
        <p className="text-gray-600 mb-2">
          {t("payment.failDesc", "Your payment was not completed. Please try again.")}
        </p>
        {ref && (
          <p className="text-xs text-gray-400 mb-6">Ref: {ref}</p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <Button
            className="flex-1 bg-gradient-to-r from-[#005476] to-[#3bcac4] text-white"
            onClick={() => navigate(-1)}
          >
            {t("payment.tryAgain", "Try Again")}
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => navigate("/")}>
            {t("payment.goHome", "Go to Home")}
          </Button>
        </div>
      </div>
    </div>
  );
}
