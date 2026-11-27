import {build as bundleServer} from "esbuild";
import {mkdir,readFile,readdir,unlink,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {build as buildClient} from "vite";
import {createQaLocalFontFaceCss,sanitizeQaPreviewCss} from "./qaPreviewHtml.mjs";

const allowedBuildEnv=new Set(["PATH","HOME","TMPDIR","LANG","LC_ALL","TZ","NODE_ENV","PWD","SHLVL","KINGLIKE_VIP_QA_UI_ENABLED"]);
const unexpectedEnv=Object.keys(process.env).filter((name)=>!allowedBuildEnv.has(name));
if(unexpectedEnv.length||process.env.NODE_ENV!=="production"){
  throw new Error("VIP QA build requires a clean, allowlisted local build environment");
}
if(process.env.KINGLIKE_VIP_QA_UI_ENABLED!==undefined&&
   !["true","false"].includes(process.env.KINGLIKE_VIP_QA_UI_ENABLED)){
  throw new Error("VIP QA UI flag must be explicitly true or false");
}

const root=process.cwd();
const output=resolve(root,".local/qa-vip-build");
const emptyEnv=resolve(root,".local/qa-vip-empty-env");
await mkdir(emptyEnv,{recursive:true});
await mkdir(output,{recursive:true});

// Build the current frontend only. The QA Vite config uses an empty env folder,
// enables VIP only in this output, and removes external HTML resources.
await buildClient({
  configFile:resolve(root,"vite.vip-qa.config.ts"),
  mode:"qa",
});

async function sanitizeCssFiles(directory,localFontCss){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=resolve(directory,entry.name);
    if(entry.isDirectory())await sanitizeCssFiles(path,localFontCss);
    else if(entry.isFile()&&entry.name.endsWith(".css")){
      await writeFile(
        path,
        `${sanitizeQaPreviewCss(await readFile(path,"utf8"))}\n${localFontCss}\n`,
      );
    }
  }
}
async function removeAudioAssets(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=resolve(directory,entry.name);
    if(entry.isDirectory())await removeAudioAssets(path);
    else if(entry.isFile()&&/\.(?:wav|mp3|m4a|ogg|flac)$/i.test(entry.name)){
      await unlink(path);
    }
  }
}
const publicAssets=resolve(output,"public/assets");
const localFontCss=createQaLocalFontFaceCss(await readdir(publicAssets));
await sanitizeCssFiles(resolve(output,"public"),localFontCss);
// Audio is unrelated to VIP flows and can contain voice recordings. Keep it out
// of the synthetic preview artifact rather than copying it from app assets.
await removeAudioAssets(resolve(output,"public"));

// Local-only QA entrypoint. Never bundles or starts server/index.ts.
// External service adapters are replaced before the bundle is emitted.
await bundleServer({
  absWorkingDir:root,
  entryPoints:["server/vip/qaPreviewServer.ts"],
  bundle:true,
  platform:"node",
  format:"esm",
  packages:"external",
  outfile:resolve(output,"server.mjs"),
  sourcemap:false,
  plugins:[{
    name:"vip-qa-isolation",
    setup(builder){
      builder.onResolve({filter:/^\.\.\/db$/},()=>({
        path:resolve(root,"server/vip/qaPreviewDb.ts"),
      }));
      builder.onResolve({filter:/^\.\.\/notificationService$/},()=>({
        path:resolve(root,"server/vip/qaPreviewEmail.ts"),
      }));
      builder.onResolve({filter:/^\.\/vipPrivateReceiptStorage$/},()=>({
        path:resolve(root,"server/vip/qaPreviewStorage.ts"),
      }));
      builder.onResolve({filter:/^\.\/vipCrmBridgeRoutes$/},()=>({
        path:resolve(root,"server/vip/qaPreviewCrmBridge.ts"),
      }));
      builder.onResolve({
        filter:/^(?:@google-cloud\/storage|@neondatabase\/serverless|resend|nodemailer|twilio)$/,
      },(args)=>{
        throw new Error(`External service package blocked from local VIP QA: ${args.path}`);
      });
    },
  }],
});

// When someone explicitly starts this QA bundle later, install the outbound
// network guard before loading Express, route modules, or database adapters.
const launcher=resolve(output,"start-local-only.mjs");
await writeFile(
  launcher,
  `import ${JSON.stringify(resolve(root,"server/vip/qaNetworkGuard.mjs"))};\n`+
  `process.env.KINGLIKE_VIP_QA_RUNTIME="local";\n`+
  `process.env.KINGLIKE_VIP_QA_START="true";\n`+
  `await import(${JSON.stringify(resolve(output,"server.mjs"))});\n`,
  {mode:0o600},
);
await writeFile(
  resolve(output,"BUILD-NOTES.txt"),
  "Local synthetic VIP QA build only. No server was started.\n"+
  "Frontend: public/; QA API bundle: server.mjs; guarded launcher: start-local-only.mjs\\n",
  {mode:0o600},
);

process.stdout.write("VIP QA frontend and isolated server bundle built locally; no server started.\n");
