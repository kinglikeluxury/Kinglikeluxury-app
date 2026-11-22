import {build} from "esbuild";
import {resolve} from "node:path";

// Only used by the isolated GitHub test job. The production server's database
// module is never imported; this bundle is never deployed.
await build({
 entryPoints:["server/vip/tests/httpIntegration.ts"],
 bundle:true,
 platform:"node",
 format:"esm",
 packages:"external",
 outfile:".vip-http-test.mjs",
 plugins:[{
  name:"vip-local-db-test-only",
  setup(builder){
   builder.onResolve({filter:/^\.\.\/db$/},()=>({
    path:resolve("server/vip/tests/localDbShim.ts")
   }));
  }
 }]
});
