import assert from "node:assert/strict";
import test from "node:test";
import { combineLocationParts, getSyriaCityDisplayName } from "./property-location";

test("combines a pinned address with the selected Syrian city and country", () => {
  const cityName = getSyriaCityDisplayName("damascus");
  assert.equal(cityName, "Damascus");

  const location = combineLocationParts([
    "Dummar Gharbiya Neighborhood, Dummar Municipality",
    cityName,
    "Syria",
  ]);

  assert.equal(
    location,
    "Dummar Gharbiya Neighborhood, Dummar Municipality, Damascus, Syria",
  );
  assert.match(location.toLowerCase(), /syria/);
});

test("does not duplicate city or country already present in the pinned address", () => {
  const cityName = getSyriaCityDisplayName("damascus");
  const location = combineLocationParts([
    "Dummar, Damascus, Syria",
    cityName,
    "Syria",
  ]);

  assert.equal(location, "Dummar, Damascus, Syria");
});
