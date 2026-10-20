import test from "node:test";
import assert from "node:assert/strict";
import { buildAiBlogDraftPreview, toSafePreviewBlocks } from "./aiBlogDraftPreview";

test("preview maps existing article and SEO values without generating defaults", () => {
  const preview = buildAiBlogDraftPreview({
    title: "عنوان عربي",
    content: "<h2>مقدمة</h2><p>محتوى <strong>محفوظ</strong></p>",
    cover_image: "https://images.example.test/cover.jpg",
    seo_description: "وصف محفوظ لمحركات البحث",
    keywords: ["باكو", "عقار"],
    slug: "baku-guide",
    sources: [{ title: "جهة رسمية", url: "https://example.test/guide", accessedAt: "2026-10-20" }],
  });
  assert.equal(preview.title, "عنوان عربي");
  assert.deepEqual(preview.contentBlocks, [
    { kind: "heading", text: "مقدمة" },
    { kind: "paragraph", text: "محتوى محفوظ" },
  ]);
  assert.equal(preview.coverImage, "https://images.example.test/cover.jpg");
  assert.equal(preview.seoDescription, "وصف محفوظ لمحركات البحث");
  assert.deepEqual(preview.keywords, ["باكو", "عقار"]);
  assert.equal(preview.slug, "baku-guide");
  assert.equal(preview.sources.length, 1);
});

test("missing preview values stay missing and do not invent source links", () => {
  const preview = buildAiBlogDraftPreview({ title: "", content: "", sources: [] });
  assert.equal(preview.title, null);
  assert.deepEqual(preview.contentBlocks, []);
  assert.equal(preview.coverImage, null);
  assert.equal(preview.seoDescription, null);
  assert.deepEqual(preview.keywords, []);
  assert.equal(preview.slug, null);
  assert.deepEqual(preview.sources, []);
});

test("unsafe URLs are not made clickable and cover metadata is not presented as an article source", () => {
  const preview = buildAiBlogDraftPreview({
    cover_image: "javascript:alert(1)",
    sources: [
      { title: "مصدر غير آمن", url: "javascript:alert(1)", accessedAt: "today" },
      { kind: "cover_image", title: "بيانات صورة الغلاف", url: "https://image.example.test/source" },
    ],
  });
  assert.equal(preview.coverImage, null);
  assert.equal(preview.sources.length, 1);
  assert.equal(preview.sources[0].title, "مصدر غير آمن");
  assert.equal(preview.sources[0].url, null);
});

test("content preview renders text only and strips executable markup", () => {
  const blocks = toSafePreviewBlocks("<h2>عنوان</h2><script>alert(1)</script><p>نص &amp; آمن <img src=x onerror=alert(2)>.</p>");
  assert.deepEqual(blocks, [
    { kind: "heading", text: "عنوان" },
    { kind: "paragraph", text: "نص & آمن ." },
  ]);
});
