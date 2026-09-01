import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ONE_PENINSULA_IMAGE_HEIGHT,
  ONE_PENINSULA_IMAGE_WIDTH,
  ONE_PENINSULA_UNIT_POLYGONS,
  validateOnePeninsulaFloorPlan,
} from "../client/src/lib/floorPlans/onePeninsula";

const sourceImage = resolve(
  "client/public/one-peninsula-tier-1-3-floor-plan.jpeg",
);
const outputDirectory = resolve(
  "artifacts/one-peninsula-floor-plan-verification",
);
const temporaryDirectory = resolve("/tmp/one-peninsula-floor-plan-verification");
const individualUnits = ["101", "104", "106", "112", "120", "126"] as const;

mkdirSync(outputDirectory, { recursive: true });
mkdirSync(temporaryDirectory, { recursive: true });

function polygonPoints(unitId: string): string {
  const polygon =
    ONE_PENINSULA_UNIT_POLYGONS[
      unitId as keyof typeof ONE_PENINSULA_UNIT_POLYGONS
    ];
  if (!polygon) throw new Error(`Unknown One Peninsula unit: ${unitId}`);
  return polygon.map(([x, y]) => `${x},${y}`).join(" ");
}

function polygonCenter(unitId: string): readonly [number, number] {
  const polygon =
    ONE_PENINSULA_UNIT_POLYGONS[
      unitId as keyof typeof ONE_PENINSULA_UNIT_POLYGONS
    ];
  const x = polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length;
  const y = polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length;
  return [Math.round(x), Math.round(y)];
}

function renderSvg(svg: string, outputPath: string): void {
  const svgPath = resolve(
    temporaryDirectory,
    `${outputPath.split("/").at(-1)}.svg`,
  );
  const overlayPath = resolve(
    temporaryDirectory,
    `${outputPath.split("/").at(-1)}.overlay.png`,
  );
  writeFileSync(svgPath, svg);
  execFileSync("convert", [
    "-background",
    "none",
    svgPath,
    overlayPath,
  ]);
  execFileSync("convert", [
    sourceImage,
    overlayPath,
    "-composite",
    "-quality",
    "96",
    outputPath,
  ]);
  rmSync(svgPath, { force: true });
  rmSync(overlayPath, { force: true });
}

function baseSvg(content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ONE_PENINSULA_IMAGE_WIDTH}" height="${ONE_PENINSULA_IMAGE_HEIGHT}" viewBox="0 0 ${ONE_PENINSULA_IMAGE_WIDTH} ${ONE_PENINSULA_IMAGE_HEIGHT}">
  ${content}
</svg>`;
}

for (const unitId of individualUnits) {
  const [centerX, centerY] = polygonCenter(unitId);
  const svg = baseSvg(`
    <polygon points="${polygonPoints(unitId)}" fill="rgba(59,202,196,0.27)" stroke="#005476" stroke-width="7" stroke-linejoin="round"/>
    <text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="middle" font-family="DejaVu Sans, sans-serif" font-size="28" font-weight="700" fill="#005476" stroke="white" stroke-width="5" paint-order="stroke">${unitId}</text>
  `);
  renderSvg(svg, resolve(outputDirectory, `unit-${unitId}.png`));
}

const masterShapes = Object.keys(ONE_PENINSULA_UNIT_POLYGONS)
  .sort((a, b) => Number(a) - Number(b))
  .map((unitId) => {
    const [centerX, centerY] = polygonCenter(unitId);
    return `
      <polygon points="${polygonPoints(unitId)}" fill="rgba(59,202,196,0.08)" stroke="#005476" stroke-width="4" stroke-linejoin="round"/>
      <text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="middle" font-family="DejaVu Sans, sans-serif" font-size="18" font-weight="700" fill="#005476" stroke="white" stroke-width="4" paint-order="stroke">${unitId}</text>
    `;
  })
  .join("\n");

renderSvg(
  baseSvg(masterShapes),
  resolve(outputDirectory, "master-all-26-units.png"),
);

const validation = validateOnePeninsulaFloorPlan();
console.log(JSON.stringify(validation, null, 2));
if (!validation.valid) process.exitCode = 1;