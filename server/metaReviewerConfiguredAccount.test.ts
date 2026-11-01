import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import test from "node:test";
import {
  authenticateMetaReviewer,
  getMetaReviewerAccount,
} from "./metaReviewerAccessStore";

test("configured reviewer credentials stay disabled unless explicitly enabled", async () => {
  const keys = [
    "META_REVIEW_WA_REVIEWER_ENABLED",
    "META_REVIEW_WA_REVIEWER_EMAIL",
    "META_REVIEW_WA_REVIEWER_PASSWORD_HASH",
  ] as const;
  const previous = keys.map((key) => process.env[key]);
  const candidate = randomBytes(32).toString("base64url");
  try {
    process.env.META_REVIEW_WA_REVIEWER_ENABLED = "false";
    process.env.META_REVIEW_WA_REVIEWER_EMAIL = "meta-reviewer@example.invalid";
    process.env.META_REVIEW_WA_REVIEWER_PASSWORD_HASH = await bcrypt.hash(candidate, 4);
    assert.equal(getMetaReviewerAccount(-1), undefined);
    assert.equal(await authenticateMetaReviewer("meta-reviewer@example.invalid", candidate), undefined);

    process.env.META_REVIEW_WA_REVIEWER_ENABLED = "true";
    const firstRead = getMetaReviewerAccount(-1);
    const secondRead = getMetaReviewerAccount(-1);
    assert.equal(firstRead?.id, -1);
    assert.equal(secondRead?.email, "meta-reviewer@example.invalid");
    assert.equal(
      (await authenticateMetaReviewer("meta-reviewer@example.invalid", candidate))?.role,
      "meta_reviewer",
    );
    assert.equal(
      await authenticateMetaReviewer("meta-reviewer@example.invalid", `${candidate}wrong`),
      undefined,
    );
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index]!;
    });
  }
});
