import assert from "node:assert/strict";
import test from "node:test";
import { insertPropertySchema } from "./schema";
import { getReadyStatusLabel, RENOVATED_WITHOUT_EQUIPMENT_FURNITURE } from "./ready-status";

test("the new ready status retains its exact English option text", () => {
  assert.equal(
    RENOVATED_WITHOUT_EQUIPMENT_FURNITURE.labels.en,
    "Renovated without equipments & Furniture",
  );
  assert.equal(getReadyStatusLabel("en-US"), "Renovated without equipments & Furniture");
  assert.equal(getReadyStatusLabel("ar"), "تم تجديدها دون معدات أو أثاث");
});

test("the existing property schema accepts and round-trips the new ready status", () => {
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
  });

  assert.equal(created.readyStatus, status);
  const reopenedForEdit = insertPropertySchema.parse({
    ...created,
    readyStatus: created.readyStatus,
  });
  assert.equal(reopenedForEdit.readyStatus, status);
});
