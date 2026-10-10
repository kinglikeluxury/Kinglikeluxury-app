import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPropertyLocationFilter,
  propertyLocationMatches,
} from "./propertyLocationFilter";

describe("property country and city filtering", () => {
  it("returns no Syria/Latakia match for a listing from another market", () => {
    const filter = buildPropertyLocationFilter("syria", "latakia");
    assert.ok(filter);
    assert.equal(propertyLocationMatches("Latakia, Syria", filter), true);
    const listings = [
      { location: "Batumi, Georgia" },
      { location: "Latakia, Turkey" },
    ];
    assert.deepEqual(
      listings.filter(({ location }) => propertyLocationMatches(location, filter)),
      [],
    );
  });

  it("preserves a current Georgia/Tbilisi match", () => {
    const filter = buildPropertyLocationFilter("georgia", "tbilisi");
    assert.ok(filter);
    assert.equal(propertyLocationMatches("Tbilisi, Georgia", filter), true);
    assert.equal(propertyLocationMatches("Tbilisi", filter), false);
    assert.equal(propertyLocationMatches("Tbilisi, Turkey", filter), false);
  });

  it("fails closed for an unknown or country-mismatched city", () => {
    assert.equal(buildPropertyLocationFilter("syria", "batumi"), undefined);
    assert.equal(buildPropertyLocationFilter("unknown", "latakia"), undefined);
  });
});
