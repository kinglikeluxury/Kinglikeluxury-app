import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPropertyLocationFilter,
  propertyLocationMatches,
} from "./propertyLocationFilter";

describe("property country and city filtering", () => {
  it("matches Syrian cities only within Syria", () => {
    const filter = buildPropertyLocationFilter("syria", "latakia");
    assert.ok(filter);
    assert.equal(propertyLocationMatches("Latakia, Syria", filter), true);
    assert.equal(propertyLocationMatches("Latakia, Turkey", filter), false);
  });

  it("limits Azerbaijan filtering to Baku", () => {
    const filter = buildPropertyLocationFilter("azerbaijan", "baku");
    assert.ok(filter);
    assert.equal(propertyLocationMatches("Baku, Azerbaijan", filter), true);
    assert.equal(propertyLocationMatches("Batumi, Azerbaijan", filter), false);
    assert.equal(buildPropertyLocationFilter("azerbaijan", "ganja"), undefined);
  });

  it("preserves current Georgia/Tbilisi matching", () => {
    const filter = buildPropertyLocationFilter("georgia", "tbilisi");
    assert.ok(filter);
    assert.equal(propertyLocationMatches("Tbilisi, Georgia", filter), true);
    assert.equal(propertyLocationMatches("Tbilisi, Turkey", filter), false);
  });

  it("fails closed for unknown countries and mismatched cities", () => {
    assert.equal(buildPropertyLocationFilter("syria", "batumi"), undefined);
    assert.equal(buildPropertyLocationFilter("unknown", "latakia"), undefined);
  });
});
