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

  it("supports Baku aliases only within Azerbaijan", () => {
    const filter = buildPropertyLocationFilter("az", "bakı");
    assert.ok(filter);
    assert.equal(propertyLocationMatches("Baku, Azerbaijan", filter), true);
    assert.equal(propertyLocationMatches("Bakı, Azerbaijan", filter), true);
    assert.equal(propertyLocationMatches("Baku, Turkey", filter), false);
    assert.equal(buildPropertyLocationFilter("azerbaijan", "ganja"), undefined);
  });

  it("preserves current Georgia/Tbilisi matching", () => {
    const filter = buildPropertyLocationFilter("georgia", "tbilisi");
    assert.ok(filter);
    assert.equal(propertyLocationMatches("Tbilisi, Georgia", filter), true);
    assert.equal(propertyLocationMatches("Tbilisi, Turkey", filter), false);
  });

  it("preserves existing UAE, Turkey, and Northern Cyprus city matching", () => {
    const dubai = buildPropertyLocationFilter("uae", "dubai");
    const trabzon = buildPropertyLocationFilter("tr", "trabzon");
    const girne = buildPropertyLocationFilter("northern-cyprus", "girne");
    assert.ok(dubai);
    assert.ok(trabzon);
    assert.ok(girne);
    assert.equal(propertyLocationMatches("Dubai, UAE", dubai), true);
    assert.equal(propertyLocationMatches("Trabzon, Turkey", trabzon), true);
    assert.equal(propertyLocationMatches("Girne, Northern Cyprus (TRNC)", girne), true);
    assert.equal(propertyLocationMatches("Girne, Turkey", girne), false);
  });

  it("fails closed for unknown countries and mismatched cities", () => {
    assert.equal(buildPropertyLocationFilter("syria", "batumi"), undefined);
    assert.equal(buildPropertyLocationFilter("unknown", "latakia"), undefined);
  });
});
