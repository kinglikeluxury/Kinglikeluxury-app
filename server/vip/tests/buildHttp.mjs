import {build} from "esbuild";
import {resolve} from "node:path";

// Every entry below is test-only. Bundling never imports the main application
// entrypoint, and the alias prevents any Neon/Railway production DB fallback.
// The second test uses real express-session cookies, not fake request headers.
for(const [entry,outfile,dbModule] of [
 ["server/vip/tests/httpIntegration.ts",".vip-http-test.mjs","server/vip/tests/localDbShim.ts"],
 ["server/vip/tests/sessionHttpIntegration.ts",".vip-session-http-test.mjs","server/vip/tests/localDbShim.ts"],
 ["server/vip/tests/qaPreviewIntegration.ts",".vip-qa-preview-http-test.mjs","server/vip/qaPreviewDb.ts"]
]){
 await build({
  entryPoints:[entry],
  bundle:true,
  platform:"node",
  format:"esm",
  packages:"external",
  outfile,
  plugins:[{
   name:"vip-local-db-test-only",
   setup(builder){
    builder.onResolve({filter:/^\.\.\/db$/},()=>({
     path:resolve(dbModule)
    }));
    // Only the fixture-header HTTP suite uses synthetic file bytes. The
    // genuine QA preview and production builds use the private GCS adapter.
    if(entry==="server/vip/tests/httpIntegration.ts"){
     builder.onResolve({filter:/^\.\/vipPrivateReceiptStorage$/},()=>({
      path:resolve("server/vip/tests/privateStorageShim.ts")
     }));
    }
   }
  }]
 });
}
