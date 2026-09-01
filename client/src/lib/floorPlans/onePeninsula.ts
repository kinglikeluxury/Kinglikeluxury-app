export type FloorPlanPoint = readonly [x: number, y: number];

export const ONE_PENINSULA_PROPERTY_ID = 136;
export const ONE_PENINSULA_PROJECT_NAME = "One Peninsula";
export const ONE_PENINSULA_PLAN_ID = "typical-tier-1-3";
export const ONE_PENINSULA_IMAGE_WIDTH = 1439;
export const ONE_PENINSULA_IMAGE_HEIGHT = 492;
export const ONE_PENINSULA_IMAGE_PATH =
  "/one-peninsula-tier-1-3-floor-plan.jpeg";

export const ONE_PENINSULA_UNIT_POLYGONS = {
  "101": [[747,74],[954,74],[954,226],[934,226],[934,208],[871,208],[871,226],[747,226]],
  "102": [[955,74],[1013,74],[1013,226],[955,226]],
  "103": [[1014,74],[1073,74],[1073,226],[1014,226]],
  "104": [[1085,74],[1289,74],[1312,80],[1331,94],[1344,116],[1351,142],[1351,194],[1262,194],[1262,218],[1195,218],[1195,102],[1085,102]],
  "105": [[1237,194],[1324,194],[1324,307],[1237,307]],
  "106": [[1195,307],[1351,307],[1351,350],[1345,376],[1331,397],[1311,411],[1287,418],[1195,418]],
  "107": [[1074,286],[1130,286],[1130,319],[1194,319],[1194,418],[1074,418]],
  "108": [[1014,286],[1073,286],[1073,418],[1014,418]],
  "109": [[955,286],[1013,286],[1013,418],[955,418]],
  "110": [[896,286],[954,286],[954,418],[896,418]],
  "111": [[746,320],[872,320],[872,286],[895,286],[895,418],[746,418]],
  "112": [[600,286],[624,286],[624,320],[746,320],[746,418],[600,418]],
  "113": [[540,286],[599,286],[599,418],[540,418]],
  "114": [[420,286],[480,286],[480,320],[539,320],[539,418],[420,418]],
  "115": [[360,286],[419,286],[419,418],[360,418]],
  "116": [[300,286],[359,286],[359,418],[300,418]],
  "117": [[240,286],[299,286],[299,418],[240,418]],
  "118": [[82,282],[240,282],[240,418],[145,418],[121,412],[101,399],[88,380],[82,355]],
  "119": [[82,212],[216,212],[216,282],[82,282]],
  "120": [[145,74],[240,74],[240,230],[216,230],[216,212],[82,212],[82,134],[88,111],[101,92],[121,80]],
  "121": [[241,74],[299,74],[299,226],[241,226]],
  "122": [[300,74],[359,74],[359,226],[300,226]],
  "123": [[360,74],[419,74],[419,226],[360,226]],
  "124": [[420,74],[478,74],[478,226],[420,226]],
  "125": [[479,74],[538,74],[538,226],[479,226]],
  "126": [[539,74],[746,74],[746,226],[620,226],[620,208],[539,208]],
} as const satisfies Record<string, readonly FloorPlanPoint[]>;

export const ONE_PENINSULA_EXPECTED_UNIT_IDS = Array.from(
  { length: 26 },
  (_, index) => String(101 + index),
);

export interface OnePeninsulaMappingValidation {
  valid: boolean;
  unitCount: number;
  polygonCount: number;
  duplicateIds: string[];
  missingIds: string[];
  unexpectedIds: string[];
  invalidPolygons: string[];
  outOfBoundsPoints: Array<{ unitId: string; point: FloorPlanPoint }>;
}

export function validateOnePeninsulaFloorPlan(): OnePeninsulaMappingValidation {
  const unitIds = Object.keys(ONE_PENINSULA_UNIT_POLYGONS);
  const duplicateIds = unitIds.filter(
    (unitId, index) => unitIds.indexOf(unitId) !== index,
  );
  const missingIds = ONE_PENINSULA_EXPECTED_UNIT_IDS.filter(
    (unitId) => !unitIds.includes(unitId),
  );
  const unexpectedIds = unitIds.filter(
    (unitId) => !ONE_PENINSULA_EXPECTED_UNIT_IDS.includes(unitId),
  );
  const invalidPolygons: string[] = [];
  const outOfBoundsPoints: Array<{
    unitId: string;
    point: FloorPlanPoint;
  }> = [];

  for (const [unitId, polygon] of Object.entries(
    ONE_PENINSULA_UNIT_POLYGONS,
  )) {
    if (polygon.length < 3) invalidPolygons.push(unitId);

    for (const point of polygon) {
      const [x, y] = point;
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x >= ONE_PENINSULA_IMAGE_WIDTH ||
        y >= ONE_PENINSULA_IMAGE_HEIGHT
      ) {
        outOfBoundsPoints.push({ unitId, point });
      }
    }
  }

  return {
    valid:
      unitIds.length === 26 &&
      duplicateIds.length === 0 &&
      missingIds.length === 0 &&
      unexpectedIds.length === 0 &&
      invalidPolygons.length === 0 &&
      outOfBoundsPoints.length === 0,
    unitCount: unitIds.length,
    polygonCount: unitIds.length,
    duplicateIds,
    missingIds,
    unexpectedIds,
    invalidPolygons,
    outOfBoundsPoints,
  };
}