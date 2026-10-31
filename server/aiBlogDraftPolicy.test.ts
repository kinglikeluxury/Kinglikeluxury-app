import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AI_BLOG_MARKETS, getAiBlogProviderReadiness, isAllowedAiBlogMarket,
  isPublishableAiDraft, normalizeAiDraftUpdate,
} from "./aiBlogDraftPolicy";

test("only the five approved editorial markets are allowed", () => {
  assert.equal(AI_BLOG_MARKETS.length, 5);
  assert.equal(isAllowedAiBlogMarket("azerbaijan"), true);
  assert.equal(isAllowedAiBlogMarket("baku"), false);
  assert.equal(isAllowedAiBlogMarket("dubai"), false);
});

test("provider generation and scheduling fail closed by default", () => {
  const readiness = getAiBlogProviderReadiness({});
  assert.equal(readiness.generationEnabled, false);
  assert.equal(readiness.schedulerEnabled, false);
  assert.equal(getAiBlogProviderReadiness({ KINGLIKE_AI_BLOG_ENABLED: "true", KINGLIKE_AI_BLOG_SCHEDULER_ENABLED: "true" }).schedulerEnabled, false);
});

test("publishing requires ready-for-review and complete manual-review fields", () => {
  const draft = { status: "ready_for_review", title: "عنوان", content: "محتوى", slug: "slug", coverImage: "https://res.cloudinary.com/image", sources: [{ url: "https://example.com" }] };
  assert.equal(isPublishableAiDraft(draft), true);
  assert.equal(isPublishableAiDraft({ ...draft, status: "waiting" }), false);
  assert.equal(isPublishableAiDraft({ ...draft, coverImage: "javascript:alert(1)" }), false);
  assert.equal(isPublishableAiDraft({ ...draft, sources: [] }), false);
});

test("updates constrain fields and source URLs", () => {
  const normalized = normalizeAiDraftUpdate({
    status: "published",
    slug: " عنوان / safe ",
    sources: [{ url: "javascript:alert(1)", title: "bad", accessedAt: "today" }],
  });
  assert.equal(normalized.status, undefined);
  assert.equal(normalized.sources?.length, 0);
});

test("additive migration enforces one draft per market per Georgia business date", () => {
  const migration = readFileSync(resolve("server/migrations/2026-10-20-ai-blog-drafts.sql"), "utf8");
  assert.match(migration, /UNIQUE\s*\(business_date\s*,\s*country\)/i);
  assert.match(migration, /ON CONFLICT \(id\) DO NOTHING/i);
});
