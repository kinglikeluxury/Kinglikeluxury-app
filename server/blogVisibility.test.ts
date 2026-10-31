import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canReadBlogPost } from "./blogVisibility";

describe("blog visibility", () => {
  it("hides unpublished posts from visitors", () => {
    assert.equal(canReadBlogPost(false, false), false);
  });

  it("allows administrators to inspect unpublished posts", () => {
    assert.equal(canReadBlogPost(false, true), true);
  });

  it("keeps published posts publicly visible", () => {
    assert.equal(canReadBlogPost(true, false), true);
  });
});
