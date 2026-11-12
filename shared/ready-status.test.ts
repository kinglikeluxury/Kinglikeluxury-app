import assert from "node:assert/strict";
import test from "node:test";
import { insertPropertySchema } from "./schema";
import { getReadyStatusLabel, RENOVATED_WITHOUT_EQUIPMENT_FURNITURE } from "./ready-status";
import { formatPricePerMeterRange, getPricePerMeterLabels, isValidPricePerMeterRange } from "./price-per-meter";

test("the new ready status retains its exact English option text", () => {
  assert.equal(
    RENOVATED_WITHOUT_EQUIPMENT_FURNITURE.labels.en,
    "Renovated without equipments & Furniture",
  );
  assert.equal(getReadyStatusLabel("en-US"), "Renovated without equipments & Furniture");
  assert.equal(getReadyStatusLabel("ar"), "تشطيب كامل بدون أثاث وكهربائيات");
});

test("the existing property schema accepts ready status and strips unavailable price-range fields", () => {
  const status = RENOVATED_WITHOUT_EQUIPMENT_FURNITURE.value;
  const created = insertPropertySchema.parse({
    title: "Sample project",
    description: "Local schema test only; no database write.",
    price: 100,
    location: "Baku",
    area: "80",
    propertyType: "project",
    images: [],
    features: [],
    ownerId: 1,
    readyStatus: status,
    pricePerMeterMin: 1700,
    pricePerMeterMax: 2100,
  });

  assert.equal(created.readyStatus, status);
  assert.equal("pricePerMeterMin" in created, false);
  assert.equal("pricePerMeterMax" in created, false);
  const reopenedForEdit = insertPropertySchema.parse({
    ...created,
    readyStatus: created.readyStatus,
  });
  assert.equal(reopenedForEdit.readyStatus, status);
  assert.equal("pricePerMeterMin" in reopenedForEdit, false);
  assert.equal("pricePerMeterMax" in reopenedForEdit, false);
});

test("manual price-per-meter ranges validate and never calculate from totals or area", () => {
  assert.equal(isValidPricePerMeterRange(1700, 2100), true);
  assert.equal(isValidPricePerMeterRange(2100, 1700), false);
  assert.equal(formatPricePerMeterRange(1700, 2100, "en"), "$1,700 – $2,100 / m²");
  assert.equal(formatPricePerMeterRange(1700, null), null);
  assert.equal(getPricePerMeterLabels("ar-EG").min, "الحد الأدنى لسعر المتر المربع");
});
