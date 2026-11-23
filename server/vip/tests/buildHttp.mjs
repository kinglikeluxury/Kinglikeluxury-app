import {build} from "esbuild";
import {resolve} from "node:path";

// Every entry below is test-only. Bundling never imports the main application
// entrypoint, and the alias prevents any Neon/Railway production DB fallback.
// The second test uses real express-session cookies, not fake request headers.
for(const [entry,outfile] of [
 ["server/vip/tests/httpIntegration.ts",".vip-http-test.mjs"],
 ["server/vip/tests/sessionHttpIntegration.ts",".vip-session-http-test.mjs"]
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
     path:resolve("server/vip/tests/localDbShim.ts")
    }));
   }
  }]
 });
}
