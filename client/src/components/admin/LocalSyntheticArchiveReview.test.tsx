import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LocalSyntheticArchiveReview from "./LocalSyntheticArchiveReview";

test("synthetic archive review renders only when explicitly enabled and exposes no live/send controls", () => {
  const disabled = renderToStaticMarkup(
    <LocalSyntheticArchiveReview enabled={false} loading={false} error={null} data={null} onLoad={() => {}} />,
  );
  assert.equal(disabled, "");

  const rendered = renderToStaticMarkup(
    <LocalSyntheticArchiveReview
      enabled
      loading={false}
      error={null}
      onLoad={() => {}}
      data={{
        mode: "synthetic_local_review",
        employee: { id: "synthetic-101", label: "Synthetic employee 101" },
        conversations: [{
          id: "1",
          label: "Synthetic conversation 1",
          messages: [{
            id: "1", kind: "text", direction: "inbound",
            text: "Synthetic review fixture only", receivedAt: "2026-11-07T12:00:00.000Z",
          }],
        }],
      }}
    />,
  );
  assert.match(rendered, /Synthetic employee 101/);
  assert.match(rendered, /Synthetic review fixture only/);
  assert.match(rendered, /Live monitoring remains unavailable/);
  assert.doesNotMatch(rendered, /Send|15550000005|whatsapp\\.com/);
});
