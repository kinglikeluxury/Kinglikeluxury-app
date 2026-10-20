import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const TARGET_WIDTH = 1200;
const TARGET_HEIGHT = 630;

type Args = {
  input: string;
  output: string;
  sourceUrl: string;
  license: string;
  attribution: string;
};

function parseArgs(argv: string[]): Args {
  const [input, output, ...options] = argv;
  if (!input || !output || options.length === 0) {
    throw new Error(
      'Usage: npm run ai-blog:cover -- <input-image> <output.jpg|webp> --source-url <https-url> --license "<license>" [--attribution "<credit>"]',
    );
  }
  const values = new Map<string, string>();
  for (let i = 0; i < options.length; i += 1) {
    const key = options[i];
    if (!["--source-url", "--license", "--attribution"].includes(key)) {
      throw new Error(`Unknown option: ${key}`);
    }
    const value = options[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    values.set(key, value);
    i += 1;
  }
  const sourceUrl = values.get("--source-url") || "";
  const license = values.get("--license")?.trim() || "";
  const attribution = values.get("--attribution")?.trim() || "";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new Error("--source-url must be a valid HTTPS URL.");
  }
  if (parsedUrl.protocol !== "https:") throw new Error("--source-url must use HTTPS.");
  if (!license) throw new Error("--license is required.");
  if (/pexels/i.test(license) && !attribution) {
    throw new Error("Pexels API artwork requires a photographer/Pexels attribution record.");
  }
  if (![".jpg", ".jpeg", ".webp"].includes(path.extname(output).toLowerCase())) {
    throw new Error("Output must end in .jpg, .jpeg, or .webp.");
  }
  return { input: path.resolve(input), output: path.resolve(output), sourceUrl, license, attribution };
}

async function sha256(filePath: string) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  await access(args.input);
  const safeOutputRoot = path.resolve("generated-artifacts/ai-blog-covers");
  await mkdir(safeOutputRoot, { recursive: true });
  const actualOutputRoot = await realpath(safeOutputRoot);
  if (actualOutputRoot !== safeOutputRoot || path.dirname(args.output) !== safeOutputRoot) {
    throw new Error("Output must be saved directly in the ignored generated-artifacts/ai-blog-covers directory.");
  }

  const { stdout: sourceFormat } = await execFileAsync("identify", ["-quiet", "-format", "%m", args.input], {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  if (!["JPEG", "JPG", "PNG", "WEBP"].includes(sourceFormat.trim().toUpperCase())) {
    throw new Error("Input must be an existing JPEG, PNG, or WEBP image.");
  }

  const extension = path.extname(args.output).toLowerCase();
  const formatArgs = extension === ".webp" ? ["-quality", "84", "-define", "webp:method=5"] : ["-quality", "88", "-sampling-factor", "4:2:0"];
  await execFileAsync("magick", [
    "-limit", "memory", "256MiB",
    "-limit", "map", "512MiB",
    args.input,
    "-auto-orient",
    "-resize", `${TARGET_WIDTH}x${TARGET_HEIGHT}`,
    "-background", "#f4f3f0",
    "-gravity", "center",
    "-extent", `${TARGET_WIDTH}x${TARGET_HEIGHT}`,
    ...formatArgs,
    args.output,
  ], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });

  const { stdout: outputInfo } = await execFileAsync(
    "identify",
    ["-quiet", "-format", "%m %w %h", args.output],
    { timeout: 10_000, maxBuffer: 1024 * 1024 },
  );
  const [format, widthText, heightText] = outputInfo.trim().split(/\s+/);
  const outputStat = await stat(args.output);
  const expectedFormat = extension === ".webp" ? "WEBP" : "JPEG";
  if (
    format.toUpperCase() !== expectedFormat ||
    Number(widthText) !== TARGET_WIDTH ||
    Number(heightText) !== TARGET_HEIGHT ||
    outputStat.size >= MAX_OUTPUT_BYTES
  ) {
    throw new Error("Prepared cover failed format, dimensions, or under-10MB validation.");
  }

  const provenancePath = `${args.output}.provenance.json`;
  const provenance = {
    sourceUrl: args.sourceUrl,
    license: args.license,
    attribution: args.attribution || null,
    originalSha256: await sha256(args.input),
    outputSha256: await sha256(args.output),
    outputFormat: format.toUpperCase(),
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    bytes: outputStat.size,
    preparedAt: new Date().toISOString(),
    processing: "Local ImageMagick; contain-and-pad; no upload; no watermark added or removed.",
  };
  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ output: args.output, provenance: provenancePath, ...provenance }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Cover preparation failed.");
  process.exitCode = 1;
});
