import test from "node:test";
import assert from "node:assert/strict";
import { insertBlogPostSchema } from "./schema";
import { BLOG_COUNTRY_OPTIONS, filterBlogPostsByCountry, getBlogCountryOption } from "./blogCountries";

test("Azerbaijan is accepted by blog post validation and existing country values remain unchanged", () => {
  const existing = ["georgia", "uae", "turkey", "northern-cyprus"];
  assert.deepEqual(BLOG_COUNTRY_OPTIONS.slice(0, 4).map((option) => option.value), existing);
  assert.equal(BLOG_COUNTRY_OPTIONS[4].value, "azerbaijan");
  const result = insertBlogPostSchema.safeParse({
    title: "Synthetic Azerbaijan article",
    slug: "synthetic-azerbaijan-article",
    content: "Test content",
    excerpt: "Test excerpt",
    coverImage: "",
    authorId: 1,
    categories: [],
    country: "azerbaijan",
  });
  assert.equal(result.success, true);
  if (result.success) {
    const savedMock = { ...result.data, id: 9001 };
    const readBack = filterBlogPostsByCountry([savedMock], "azerbaijan");
    assert.equal(readBack[0]?.id, 9001);
    assert.equal(readBack[0]?.country, "azerbaijan");
  }
});

test("blog country filters return Azerbaijan without changing other country results", () => {
  const posts = [
    { id: 1, country: "georgia" },
    { id: 2, country: "uae" },
    { id: 3, country: "turkey" },
    { id: 4, country: "northern-cyprus" },
    { id: 5, country: "azerbaijan" },
  ];
  assert.deepEqual(filterBlogPostsByCountry(posts, "azerbaijan"), [posts[4]]);
  for (const country of posts.slice(0, 4).map((post) => post.country)) {
    assert.deepEqual(filterBlogPostsByCountry(posts, country), posts.filter((post) => post.country === country));
  }
  assert.deepEqual(filterBlogPostsByCountry(posts, "all"), posts);
  assert.equal(getBlogCountryOption("azerbaijan").flag, "🇦🇿");
});
