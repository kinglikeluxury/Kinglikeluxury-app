import { build } from "esbuild";
import { resolve } from "node:path";

const outfile = process.argv[2];
if (
  !outfile ||
  !outfile.startsWith(resolve("server/vip/tests") + "/") ||
  !/\.auth-database-integration-[A-Za-z0-9_-]+\.mjs$/.test(outfile)
) {
  throw new Error("Auth database integration bundle must stay in its temporary test-only worktree path");
}

const result = await build({
  entryPoints: ["server/vip/tests/authDatabaseIntegration.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile,
  metafile: true,
  tsconfig: "tsconfig.json",
  plugins: [{
    name: "vip-test-local-database-and-files-only",
    setup(builder) {
      builder.onResolve({ filter: /^\.\.?\/db$/ }, (args) => {
        if (
          args.importer.endsWith("/server/database-storage.ts") ||
          args.importer.startsWith(resolve("server/vip/"))
        ) {
          return { path: resolve("server/vip/tests/localDatabaseStorageShim.ts") };
        }
      });
      builder.onResolve({ filter: /^\.\/vipPrivateReceiptStorage$/ }, () => {
        return { path: resolve("server/vip/tests/localPrivateVipStorageShim.ts") };
      });
      builder.onResolve({ filter: /^\.\/kayService$/ }, (args) => {
        if (args.importer.endsWith("/server/database-storage.ts")) {
          return { path: resolve("server/vip/tests/localKayImportShim.ts") };
        }
      });
    },
  }],
});

const inputs = Object.keys(result.metafile.inputs);
const forbiddenSources = [
  "server/index.ts",
  "server/routes.ts",
  "server/db.ts",
  "server/vip/registerVipRoutes.ts",
  "server/vip/vipPrivateReceiptStorage.ts",
  "server/vip/vipNeonS3Storage.ts",
];
const bundleChecks = {
  databaseStorage: inputs.some((input) => input.endsWith("server/database-storage.ts")),
  localDatabaseShim: inputs.some((input) => input.endsWith("server/vip/tests/localDatabaseStorageShim.ts")),
  isolatedOptionalObserver: inputs.some((input) => input.endsWith("server/vip/tests/localKayImportShim.ts")),
  localPrivateStorageShim: inputs.some((input) => input.endsWith("server/vip/tests/localPrivateVipStorageShim.ts")),
  localFileShim: inputs.some((input) => input.endsWith("server/vip/tests/privateFileStorageShim.ts")),
  vipCoreRoutes: inputs.some((input) => input.endsWith("server/vip/vipCoreRoutes.ts")),
  vipReceiptRoutes: inputs.some((input) => input.endsWith("server/vip/vipReceiptRoutes.ts")),
  vipSellerRoutes: inputs.some((input) => input.endsWith("server/vip/vipSellerRoutes.ts")),
  forbiddenSourcesPresent: forbiddenSources.filter((source) =>
    inputs.some((input) => input.endsWith(source)),
  ),
};
if (
  !bundleChecks.databaseStorage ||
  !bundleChecks.localDatabaseShim ||
  !bundleChecks.isolatedOptionalObserver ||
  !bundleChecks.localPrivateStorageShim ||
  !bundleChecks.localFileShim ||
  !bundleChecks.vipCoreRoutes ||
  !bundleChecks.vipReceiptRoutes ||
  !bundleChecks.vipSellerRoutes ||
  bundleChecks.forbiddenSourcesPresent.length > 0
) {
  await (await import("node:fs/promises")).unlink(outfile).catch(() => {});
  throw new Error(`Integration bundle failed its local-only source checks: ${JSON.stringify(bundleChecks)}`);
}

const forbiddenImports = Object.entries(result.metafile.inputs)
  .flatMap(([source, input]) => input.imports
    .filter((item) => item.external)
    .map((item) => ({ source, path: item.path }))
    .filter((item) => /(?:neon|twilio|resend|google-cloud|aws-sdk|cloudinary|stripe|paypal|nodemailer|web-push)/i.test(item.path)));
if (forbiddenImports.length > 0) {
  await (await import("node:fs/promises")).unlink(outfile).catch(() => {});
  const safeSources = forbiddenImports.map((item) => ({
    source: item.source.replace(`${process.cwd()}/`, ""),
    package: item.path,
  }));
  throw new Error(`External provider packages entered the integration bundle: ${JSON.stringify(safeSources)}`);
}

console.log("auth_db_bundle=real_DatabaseStorage_local_pg_local_receipt_files_no_bootstrap_or_provider_packages");
