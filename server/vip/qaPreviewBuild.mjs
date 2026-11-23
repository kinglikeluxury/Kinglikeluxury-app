import {build} from "esbuild";
import {resolve} from "node:path";

// Dedicated QA entrypoint only. Never bundles or starts server/index.ts.
// Production database imports in the VIP route modules are redirected to an
// isolated, explicitly configured Railway private PostgreSQL adapter.
await build({
 entryPoints:["server/vip/qaPreviewServer.ts"],
 bundle:true,
 platform:"node",
 format:"esm",
 packages:"external",
 outfile:"dist/vip-qa.mjs",
 plugins:[{
  name:"vip-qa-db-isolation",
  setup(builder){
   builder.onResolve({filter:/^\.\.\/db$/},()=>({
    path:resolve("server/vip/qaPreviewDb.ts")
   }));
  }
 }]
});
