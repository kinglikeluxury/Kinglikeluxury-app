import { build } from "esbuild";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const testDirectory = resolve("server/vip/tests");
const outfile = resolve(testDirectory, ".vip-receipt-http-test.mjs");
if (!outfile.startsWith(testDirectory + "/")) {
  throw new Error("Receipt integration bundle must stay in the VIP test directory");
}

const result = await build({
  entryPoints: ["server/vip/tests/receiptHttpIntegration.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile,
  metafile: true,
  plugins: [{
    name: "vip-local-only-receipt-adapters",
    setup(builder) {
      builder.onResolve({ filter: /^\.\.\/db$/ }, (args) => {
        if (args.importer.endsWith("/server/vip/vipReceiptRoutes.ts")) {
          return { path: resolve("server/vip/tests/localDbShim.ts") };
        }
      });
      builder.onResolve({ filter: /^\.\/vipPrivateReceiptStorage$/ }, (args) => {
        if (args.importer.endsWith("/server/vip/vipReceiptRoutes.ts")) {
          return { path: resolve("server/vip/tests/privateFileStorageShim.ts") };
        }
      });
    },
  }],
});

const inputs = Object.keys(result.metafile.inputs);
if (
  !inputs.some((input) => input.endsWith("server/vip/tests/localDbShim.ts")) ||
  !inputs.some((input) => input.endsWith("server/vip/tests/privateFileStorageShim.ts")) ||
  inputs.some((input) => input.endsWith("server/index.ts")) ||
  inputs.some((input) => input.endsWith("server/routes.ts")) ||
  inputs.some((input) => input.endsWith("server/db.ts")) ||
  inputs.some((input) => input.endsWith("server/vip/vipPrivateReceiptStorage.ts")) ||
  inputs.some((input) => input.endsWith("server/vip/vipNeonS3Storage.ts"))
) {
  await (await import("node:fs/promises")).unlink(outfile).catch(() => {});
  throw new Error("Receipt test bundle did not prove local DB/file adapter aliases");
}
if (!existsSync(outfile)) throw new Error("Receipt test bundle missing");
console.log("receipt_test_bundle=local_db_and_file_adapters_only");
