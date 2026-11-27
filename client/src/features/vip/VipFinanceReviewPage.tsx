import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, Receipt, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { getVipFinanceCopy } from "./vipFinanceCopy";

type ReceiptRow = {
  id: string;
  file_name: string;
  upload_source: string;
  review_status: string;
  uploaded_by: number;
  uploaded_by_name: string;
  created_at: string;
  installment_id: string;
  unit_id: string;
  due_date: string;
  installment_amount: string;
  currency: string;
  project_name: string;
  unit_number: string;
};

const inputClass =
  "mt-1 w-full rounded-lg border border-[#cce0e3] bg-white px-3 py-2 text-sm";

export default function VipFinanceReviewPage() {
  const { user, isLoading } = useAuth();
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const text = getVipFinanceCopy(i18n.language);
  const userId = user?.id ?? null;
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const permission = useQuery<{ canApprove: boolean }>({
    queryKey: ["vip", "finance-review", "me", userId],
    queryFn: async () => {
      const response = await fetch("/api/admin/vip/finance/me", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Finance permission unavailable");
      const result: unknown = await response.json();
      if (typeof result !== "object" || result === null ||
          !("canApprove" in result) || typeof result.canApprove !== "boolean") {
        throw new Error("Invalid finance permission response");
      }
      return { canApprove: result.canApprove };
    },
    enabled: userId !== null,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const canReview = permission.data?.canApprove === true && !permission.isFetching;
  const queue = useQuery<{ receipts: ReceiptRow[] }>({
    queryKey: ["vip", "finance-review", "receipts", userId],
    queryFn: async () => {
      const response = await fetch("/api/admin/vip/finance/receipts", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Finance review queue unavailable");
      return response.json();
    },
    // The UI stays hidden while the live permission check refreshes, but the
    // API has its own requireFinance gate before returning any queue rows.
    enabled: userId !== null && permission.data?.canApprove === true,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (userId !== null && !permission.isFetching && permission.data?.canApprove !== true) {
      queryClient.removeQueries({
        queryKey: ["vip", "finance-review", "receipts", userId],
      });
    }
  }, [permission.data?.canApprove, permission.isFetching, queryClient, userId]);

  async function review(receiptId: string, decision: "approve" | "reject") {
    if (busyId || !canReview) return;
    setBusyId(receiptId);
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/vip/receipts/${encodeURIComponent(receiptId)}/review`,
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            verifiedAmount: amounts[receiptId] || "",
            note: reasons[receiptId]?.trim() || "",
          }),
        },
      );
      if (!response.ok) throw new Error("Finance review rejected");
      setNotice(text.saved);
      setAmounts((current) => {
        const next = { ...current };
        delete next[receiptId];
        return next;
      });
      setReasons((current) => {
        const next = { ...current };
        delete next[receiptId];
        return next;
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["vip", "finance-review", "receipts"] }),
        queryClient.invalidateQueries({ queryKey: ["vip", "admin", "receipts"] }),
        queryClient.invalidateQueries({ queryKey: ["vip", "installments"] }),
      ]);
    } catch {
      setNotice(text.error);
    } finally {
      setBusyId(null);
    }
  }

  const rtl = /^(ar|he)(-|$)/i.test(i18n.language);
  return (
    <main dir={rtl ? "rtl" : "ltr"} className="min-h-[80vh] bg-[#f4f8f8] px-4 py-8 text-[#083e56]">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-2xl bg-[#005476] px-5 py-7 text-white">
          <h1 className="flex items-center gap-3 text-2xl font-bold">
            <Receipt className="h-7 w-7 text-[#3bcac4]" />
            {text.title}
          </h1>
          <p className="mt-2 text-sm text-white/80">{text.note}</p>
        </header>

        {isLoading ? (
          <p className="mt-6 rounded-xl bg-white p-5">{text.loading}</p>
        ) : !user ? (
          <p className="mt-6 rounded-xl bg-white p-5">
            <Link href="/login?redirect=%2Fvip%2Ffinance-review" className="font-semibold underline">
              {text.login}
            </Link>
          </p>
        ) : permission.isError ? (
          <p role="alert" className="mt-6 rounded-xl bg-amber-50 p-5 text-amber-900">{text.unavailable}</p>
        ) : permission.isPending || permission.isFetching ? (
          <p className="mt-6 rounded-xl bg-white p-5">{text.loading}</p>
        ) : !permission.data?.canApprove ? (
          <p role="status" className="mt-6 rounded-xl bg-white p-5">
            <ShieldCheck className="me-2 inline h-5 w-5" />{text.restricted}
          </p>
        ) : queue.isError ? (
          <p role="alert" className="mt-6 rounded-xl bg-amber-50 p-5 text-amber-900">{text.unavailable}</p>
        ) : queue.isPending ? (
          <p className="mt-6 rounded-xl bg-white p-5">{text.loading}</p>
        ) : (
          <section className="mt-6 space-y-4">
            {notice && <p role="status" className="rounded-xl bg-white p-4 text-sm">{notice}</p>}
            {queue.data.receipts.length === 0 ? (
              <p role="status" className="rounded-xl bg-white p-5">{text.empty}</p>
            ) : queue.data.receipts.map((receipt) => {
              const isOwnUpload = Number(receipt.uploaded_by) === user.id;
              const pending = receipt.review_status === "pending";
              const canAct = pending && !isOwnUpload;
              const statusText = receipt.review_status === "approved"
                ? text.approved
                : receipt.review_status === "rejected"
                  ? text.rejected
                  : text.pending;
              return (
                <article key={receipt.id} data-receipt-id={receipt.id}
                  className="rounded-2xl border border-[#d7e6e9] bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">{receipt.project_name} · {receipt.unit_number}</h2>
                      <p className="mt-1 text-sm text-[#557989]">
                        {text.uploader}: {receipt.uploaded_by_name} · {receipt.file_name}
                      </p>
                      <p className="mt-1 text-xs text-[#688594]">
                        {text.uploadedAt}: {new Date(receipt.created_at).toLocaleString(i18n.language)}
                      </p>
                      <p className="mt-1 text-xs text-[#688594]">
                        {text.due}: {receipt.due_date} · {receipt.installment_amount} {receipt.currency}
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                      {statusText}
                    </span>
                  </div>

                  <a href={`/api/vip/receipts/${encodeURIComponent(receipt.id)}/download`}
                    className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#005476] underline">
                    <FileDown className="h-4 w-4" />{text.download}
                  </a>

                  {canAct && (
                    <div className="mt-4 grid gap-3 border-t border-[#e0ecee] pt-4 md:grid-cols-2">
                      <label className="text-sm">
                        {text.amount}
                        <input aria-label={text.amount} className={inputClass} type="number"
                          inputMode="decimal" min="0.01" step="0.01" value={amounts[receipt.id] || ""}
                          onChange={(event) => setAmounts((current) => ({
                            ...current, [receipt.id]: event.target.value,
                          }))} />
                      </label>
                      <button type="button" className="self-end rounded-xl bg-[#005476] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={busyId !== null || !amounts[receipt.id]}
                        onClick={() => review(receipt.id, "approve")}>
                        {busyId === receipt.id ? text.loading : text.approve}
                      </button>
                      <label className="text-sm">
                        {text.reason}
                        <input aria-label={text.reason} className={inputClass} maxLength={500}
                          value={reasons[receipt.id] || ""}
                          onChange={(event) => setReasons((current) => ({
                            ...current, [receipt.id]: event.target.value,
                          }))} />
                      </label>
                      <button type="button" className="self-end rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-800 disabled:opacity-50"
                        disabled={busyId !== null || (reasons[receipt.id] || "").trim().length < 5}
                        onClick={() => review(receipt.id, "reject")}>
                        {busyId === receipt.id ? text.loading : text.reject}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
