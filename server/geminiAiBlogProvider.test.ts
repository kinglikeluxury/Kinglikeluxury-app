import test from "node:test";
import assert from "node:assert/strict";
import {
  GeminiArabicArticleProvider,
  getGeminiAiBlogReadiness,
  geminiAiBlogConfigKeys,
} from "./geminiAiBlogProvider";
import type { ArabicArticleRequest } from "./aiBlogProviderPorts";

const source = {
  url: "https://example.gov/property-guide",
  title: "Official property guide",
  accessedAt: "2026-10-20",
  excerpt: "Official guidance about the property registration process.",
};
const request: ArabicArticleRequest = {
  country: "azerbaijan",
  topic: "إرشادات عامة لشراء عقار في باكو",
  sources: [source],
};
const enabledEnv: NodeJS.ProcessEnv = {
  [geminiAiBlogConfigKeys.key]: "unit-test-only-not-a-real-key",
  [geminiAiBlogConfigKeys.model]: "test-configurable-model",
  [geminiAiBlogConfigKeys.enabled]: "true",
  [geminiAiBlogConfigKeys.freeTier]: "true",
  [geminiAiBlogConfigKeys.billingDisabled]: "true",
  [geminiAiBlogConfigKeys.quotaConfirmed]: "true",
};

test("Gemini is blocked by default and never assumes a model or free quota", () => {
  const readiness = getGeminiAiBlogReadiness({});
  assert.equal(readiness.configured, false);
  assert.equal(readiness.model, null);
  assert.equal(readiness.keyPresent, false);
  assert.equal(readiness.blockers.length, 6);
});

test("missing free-tier, billing, quota, or explicit-enable confirmation blocks the adapter", async () => {
  for (const key of [
    geminiAiBlogConfigKeys.freeTier,
    geminiAiBlogConfigKeys.billingDisabled,
    geminiAiBlogConfigKeys.quotaConfirmed,
    geminiAiBlogConfigKeys.enabled,
  ]) {
    const env = { ...enabledEnv, [key]: "false" };
    assert.equal(getGeminiAiBlogReadiness(env).configured, false);
    let called = false;
    const provider = new GeminiArabicArticleProvider(env, async () => {
      called = true;
      throw new Error("transport must not be called");
    });
    await assert.rejects(provider.write(request), /AI_BLOG_PROVIDER_NOT_READY/);
    assert.equal(called, false);
  }
});

test("invalid market or absent verified sources is rejected before transport", async () => {
  let calls = 0;
  const provider = new GeminiArabicArticleProvider(enabledEnv, async () => {
    calls++;
    throw new Error("unexpected transport");
  });
  await assert.rejects(provider.write({ ...request, country: "baku" }), /AI_BLOG_MARKET_NOT_ALLOWED/);
  await assert.rejects(provider.write({ ...request, sources: [] }), /AI_BLOG_VERIFIED_SOURCES_REQUIRED/);
  await assert.rejects(provider.write({ ...request, sources: [{ ...source, url: "http://example.gov" }] }), /AI_BLOG_SOURCE_INVALID/);
  assert.equal(calls, 0);
});

test("mock transport returns structured Arabic draft and only caller-supplied sources", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const modelOutput = {
    title: "دليل عقاري عام في باكو",
    content: `<h2>معلومات عامة</h2><p>${"توضح الإرشادات الرسمية المتاحة بعض الخطوات العامة، وينبغي مراجعة الجهة المختصة للحصول على التفاصيل المحدثة. ".repeat(2)}</p>`,
    keywords: ["عقار باكو", "شراء عقار", "إرشادات عقارية"],
    seoDescription: "دليل عام باللغة العربية يشرح معلومات عقارية أساسية في باكو بالاستناد إلى المصدر المقدم.",
    slug: "baku-property-guide",
    suggestedImage: "صورة عامة واقعية لمدينة باكو دون نسبة إلى مشروع محدد",
  };
  const provider = new GeminiArabicArticleProvider(enabledEnv, async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(modelOutput) }] } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const result = await provider.write(request);
  assert.equal(result.country, "azerbaijan");
  assert.equal(result.title, modelOutput.title);
  assert.deepEqual(result.sources, [source]);
  assert.deepEqual(Object.keys(result.sources[0]).sort(), ["accessedAt", "excerpt", "title", "url"]);
  assert.match(capturedUrl, /test-configurable-model:generateContent$/);
  assert.equal(capturedUrl.includes("unit-test-only-not-a-real-key"), false);
  assert.equal((capturedInit?.headers as Record<string, string>)["x-goog-api-key"], "unit-test-only-not-a-real-key");
  assert.equal(JSON.parse(String(capturedInit?.body)).tools, undefined);
});

test("model response cannot add fabricated source references or non-Arabic content", async () => {
  const provider = new GeminiArabicArticleProvider(enabledEnv, async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      title: "A property article",
      content: "English-only content ".repeat(10),
      keywords: ["one", "two", "three"],
      seoDescription: "A long enough description that is certainly more than forty characters.",
      slug: "article",
      suggestedImage: "A realistic city scene",
      sources: [{ url: "https://invented.example", title: "Fake source" }],
    }) }] } }],
  }), { status: 200 }));
  await assert.rejects(provider.write(request));
});
