import React from "react";

export type LocalArchiveReviewData = {
  mode: "synthetic_local_review";
  employee: { id: "synthetic-101"; label: string };
  conversations: Array<{
    id: string;
    label: string;
    messages: Array<{ id: string; kind: string; direction: string; text: string; receivedAt: string }>;
  }>;
};

export default function LocalSyntheticArchiveReview({
  enabled,
  loading,
  error,
  data,
  onLoad,
}: {
  enabled: boolean;
  loading: boolean;
  error: string | null;
  data: LocalArchiveReviewData | null;
  onLoad: () => void;
}) {
  if (!enabled) return null;
  return (
    <section className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label="Local synthetic archive review">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-amber-950">Local synthetic archive review</h2>
          <p className="text-sm text-amber-900">This endpoint is available only in explicitly enabled local test mode. No live messages or sends.</p>
        </div>
        <button type="button" disabled={loading} onClick={onLoad} className="rounded-md bg-[#005476] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {loading ? "Loading local fixtures…" : "Load synthetic archive"}
        </button>
      </div>
      <p className="mt-2 text-xs text-amber-900">Live monitoring remains unavailable until verified company-number ownership, active per-phone consent, Meta verification, and separate activation are reviewed.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
      {data && (
        <div className="mt-4 space-y-3" data-mode={data.mode}>
          <p className="text-sm font-medium text-slate-800">{data.employee.label}</p>
          {data.conversations.map(conversation => (
            <article key={conversation.id} className="rounded-lg border border-amber-200 bg-white p-3">
              <h3 className="text-sm font-semibold text-slate-900">{conversation.label}</h3>
              <ul className="mt-2 space-y-2">
                {conversation.messages.map(message => (
                  <li key={message.id} className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <span className="me-2 text-xs text-slate-400">{message.direction}</span>
                    {message.kind === "revoke" ? "Synthetic message removed" : message.text}
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {!data.conversations.length && <p className="text-sm text-slate-600">No consented synthetic conversations.</p>}
        </div>
      )}
    </section>
  );
}
