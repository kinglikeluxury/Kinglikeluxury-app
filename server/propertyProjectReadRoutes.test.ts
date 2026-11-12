import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { getTableColumns } from "drizzle-orm";
import { properties, insertPropertySchema } from "@shared/schema";
import { registerPropertyProjectReadRoutes } from "./propertyProjectReadRoutes";

const createdAt = new Date("2026-01-01T00:00:00Z");

function property(id: number, title: string, location: string, propertyType: string) {
  return {
    id,
    title,
    description: `${title} in ${location}`,
    price: 150000,
    location,
    latitude: null,
    longitude: null,
    area: "90",
    bedrooms: 2,
    bathrooms: 1,
    floorNumber: null,
    propertyType,
    images: [],
    videos: [],
    features: [],
    amenities: [],
    locationScore: 70,
    valueScore: 65,
    amenitiesScore: 60,
    conditionScore: 75,
    investmentScore: 68,
    overallScore: 70,
    status: "approved",
    ownerId: 1,
    createdAt,
    updatedAt: createdAt,
    listingType: "regular",
    listingExpiresAt: null,
    readyStatus: null,
    topRated: false,
    bestPrice: false,
    acceptablePrice: false,
    highPrice: false,
    isSold: false,
    priceMax: null,
    landType: null,
    landFeatures: [],
    paymentMethod: null,
    downPaymentPercent: null,
    installmentDuration: null,
    monthlyInstallment: null,
    remainingBalance: null,
    paymentNotes: null,
    titleEn: null,
    descriptionEn: null,
    liveEnabled: false,
    liveTitle: null,
    liveEmbedUrl: null,
    liveSourceType: "iframe",
    liveStatus: "active",
    liveThumbnail: null,
    liveCountry: null,
    liveCity: null,
    liveUpdatedAt: null,
  };
}

async function withReadRoutes(
  fakeStorage: Record<string, (...args: any[]) => Promise<any>>,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use((_req, _res, next) => {
    next();
  });
  registerPropertyProjectReadRoutes(app as any, fakeStorage as any, () => null);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("property schema no longer selects or accepts unavailable manual-price columns", () => {
  const columns = getTableColumns(properties);
  assert.equal("pricePerMeterMin" in columns, false);
  assert.equal("pricePerMeterMax" in columns, false);
  const parsed = insertPropertySchema.safeParse({
    ...property(1, "Apartment", "Tbilisi, Georgia", "apartment"),
    pricePerMeterMin: 1000,
    pricePerMeterMax: 1500,
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal("pricePerMeterMin" in parsed.data, false);
    assert.equal("pricePerMeterMax" in parsed.data, false);
  }
});

test("GET /api/properties returns the default approved apartment collection without database access", async () => {
  const apartments = [
    property(1, "Apartment One", "Tbilisi, Georgia", "apartment"),
    property(2, "Apartment Two", "Batumi, Georgia", "apartment"),
  ];
  let capturedFilters: unknown;
  await withReadRoutes({
    getProperties: async (filters) => {
      capturedFilters = filters;
      return apartments;
    },
    getProjects: async () => [],
    getPropertiesByType: async () => [],
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/properties`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).map((item: any) => item.id), [1, 2]);
  });
  assert.deepEqual(capturedFilters, { status: "approved" });
});

test("GET /api/projects includes both approved Baku projects and deduplicates their project properties", async () => {
  const panorama = property(142, "Panorama by Elie Saab", "Sabunchu Raion", "project");
  panorama.description = "Location: Baku, Azerbaijan";
  const reportage = property(143, "Reportage Hights", "Sabunchu Raion", "project");
  reportage.description = "REPORTAGE HEIGHTS | BAKU";
  const projects = [
    { id: 55, propertyId: 142, developer: panorama.title, completionDate: "Q3 2029", projectStatus: "Now Selling", createdAt, property: panorama },
    { id: 56, propertyId: 143, developer: reportage.title, completionDate: "Q3 2030", projectStatus: "Now Selling", createdAt, property: reportage },
  ];

  await withReadRoutes({
    getProperties: async () => [],
    getProjects: async () => projects,
    getPropertiesByType: async () => [panorama, reportage],
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects`);
    assert.equal(response.status, 200);
    const results = await response.json();
    assert.deepEqual(results.map((item: any) => item.propertyId), [142, 143]);
    assert.deepEqual(results.map((item: any) => item.property.status), ["approved", "approved"]);
    assert.deepEqual(results.map((item: any) => item.property.location), ["Sabunchu Raion", "Sabunchu Raion"]);
  });
});
