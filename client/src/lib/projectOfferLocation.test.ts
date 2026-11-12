import assert from "node:assert/strict";
import test from "node:test";
import {
  formatProjectOfferLocation,
  PROJECT_OFFER_FLAG_CODES,
  resolveProjectOfferLocation,
} from "./projectOfferFilters";

const labels: Record<string, string> = {
  "ar.cities.baku": "باكو",
  "ar.countries.azerbaijan": "أذربيجان",
  "ar.cities.batumi": "باتومي",
  "ar.countries.georgia": "جورجيا",
  "az.cities.baku": "Bakı",
  "az.countries.azerbaijan": "Azərbaycan",
  "en.cities.batumi": "Batumi",
  "en.countries.georgia": "Georgia",
  "tr.cities.istanbul": "İstanbul",
  "tr.countries.turkey": "Türkiye",
  "de.cities.dubai": "Dubai",
  "de.countries.uae": "Vereinigte Arabische Emirate",
};

const translate = (category: "countries" | "cities", name: string, lang: string) =>
  labels[`${lang}.${category}.${name.toLowerCase()}`] ?? name;

test("formats selected Baku and Batumi locations in the PDF language", () => {
  const baku = resolveProjectOfferLocation("Azerbaijan", "Baku", "Sabunchu Raion", "Location: Baku, Azerbaijan");
  assert.deepEqual(baku, { country: "Azerbaijan", city: "Baku" });
  assert.equal(formatProjectOfferLocation(baku, "ar", translate), "باكو - أذربيجان");
  assert.equal(formatProjectOfferLocation(baku, "az", translate), "Bakı - Azərbaycan");

  const batumi = resolveProjectOfferLocation("Georgia", "Batumi", "Batumi, Georgia");
  assert.equal(formatProjectOfferLocation(batumi, "ar", translate), "باتومي - جورجيا");
  assert.equal(formatProjectOfferLocation(batumi, "en", translate), "Batumi - Georgia");
});

test("recognizes Azerbaijani and Arabic names stored in project locations", () => {
  assert.deepEqual(
    resolveProjectOfferLocation("", "", "Bakı, Azərbaycan"),
    { country: "Azerbaijan", city: "Baku" },
  );
  assert.deepEqual(
    resolveProjectOfferLocation("", "", "باكو، أذربيجان"),
    { country: "Azerbaijan", city: "Baku" },
  );
  assert.deepEqual(
    resolveProjectOfferLocation("أذربيجان", "باكو", ""),
    { country: "Azerbaijan", city: "Baku" },
  );
  assert.deepEqual(
    resolveProjectOfferLocation("", "", "باتومي، جورجيا"),
    { country: "Georgia", city: "Batumi" },
  );
});

test("resolves project location when selectors are missing and never invents Batumi", () => {
  const istanbul = resolveProjectOfferLocation("", "", "Istanbul, Turkey");
  assert.deepEqual(istanbul, { country: "Turkey", city: "İstanbul" });
  assert.equal(formatProjectOfferLocation(istanbul, "tr", translate), "İstanbul - Türkiye");

  const dubai = resolveProjectOfferLocation("", "", "Dubai, UAE");
  assert.equal(formatProjectOfferLocation(dubai, "de", translate), "Dubai - Vereinigte Arabische Emirate");

  const unknown = resolveProjectOfferLocation("", "", "Sabunchu Raion");
  assert.deepEqual(unknown, { country: "", city: "" });
  assert.equal(formatProjectOfferLocation(unknown, "ar", translate), "");
});

test("uses a flag matching the resolved country", () => {
  assert.equal(PROJECT_OFFER_FLAG_CODES.Georgia, "GE");
  assert.equal(PROJECT_OFFER_FLAG_CODES.Azerbaijan, "AZ");
  assert.equal(PROJECT_OFFER_FLAG_CODES.Turkey, "TR");
  assert.equal(PROJECT_OFFER_FLAG_CODES.UAE, "AE");
});
