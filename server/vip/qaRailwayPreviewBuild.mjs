import {build as bundleServer} from "esbuild";
import {copyFile,mkdir,readFile,readdir,unlink,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {build as buildClient} from "vite";
import {createQaLocalFontFaceCss,sanitizeQaPreviewCss} from "./qaPreviewHtml.mjs";

const allowedBuildEnv=new Set([
  "PATH","HOME","TMPDIR","LANG","LC_ALL","TZ","NODE_ENV","PWD","SHLVL",
  "KINGLIKE_VIP_QA_UI_ENABLED",
]);
if(Object.keys(process.env).some(name=>!allowedBuildEnv.has(name))||
  process.env.NODE_ENV!=="production"||
  process.env.KINGLIKE_VIP_QA_UI_ENABLED!=="true"){
  throw new Error("Railway VIP QA build requires a clean environment and an explicit UI flag");
}

const root=process.cwd();
const output=resolve(root,"dist/qa-vip-railway-build");
const publicDir=resolve(output,"public");
const emptyEnv=resolve(root,".local/qa-vip-empty-env");
await mkdir(emptyEnv,{recursive:true});
await mkdir(output,{recursive:true});

await buildClient({
  configFile:resolve(root,"vite.vip-qa.config.ts"),
  mode:"qa",
  build:{outDir:publicDir,emptyOutDir:true},
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
const publicAssets=resolve(publicDir,"assets");
await mkdir(publicAssets,{recursive:true});
for(const weight of ["Regular","Medium","Bold"]){
  await copyFile(
    resolve(root,`client/src/assets/fonts/tajawal/Tajawal-${weight}.woff2`),
    resolve(publicAssets,`Tajawal-${weight}-local.woff2`),
  );
}
const localFontCss=createQaLocalFontFaceCss(await readdir(publicAssets));
await sanitizeCssFiles(publicDir,localFontCss);
await removeAudioAssets(publicDir);

await bundleServer({
  absWorkingDir:root,
  entryPoints:["server/vip/qaRailwayPreviewServer.ts"],
  bundle:true,
  platform:"node",
  format:"esm",
  packages:"external",
  outfile:resolve(output,"server.mjs"),
  sourcemap:false,
  plugins:[{
    name:"vip-railway-qa-isolation",
    setup(builder){
      builder.onResolve({filter:/^\.\.\/db$/},()=>({
        path:resolve(root,"server/vip/qaRailwayPreviewDb.ts"),
      }));
      builder.onResolve({filter:/^\.\/qaPreviewDb$/},()=>({
        path:resolve(root,"server/vip/qaRailwayPreviewDb.ts"),
      }));
      builder.onResolve({filter:/^\.\.\/notificationService$/},()=>({
        path:resolve(root,"server/vip/qaPreviewEmail.ts"),
      }));
      builder.onResolve({filter:/^\.\/vipPrivateReceiptStorage$/},()=>({
        path:resolve(root,"server/vip/qaRailwayPreviewStorage.ts"),
      }));
      builder.onResolve({filter:/^\.\/vipCrmBridgeRoutes$/},()=>({
        path:resolve(root,"server/vip/qaPreviewCrmBridge.ts"),
      }));
      builder.onResolve({
        filter:/^(?:@google-cloud\/storage|@neondatabase\/serverless|resend|nodemailer|twilio|cloudinary|@aws-sdk\/client-s3|@aws-sdk\/s3-request-presigner)$/,
      },(args)=>{
        throw new Error(`External provider package blocked from Railway VIP QA build: ${args.path}`);
      });
    },
  }],
});

await bundleServer({
  absWorkingDir:root,
  entryPoints:["server/vip/qaRailwayBootstrap.ts"],
  bundle:true,
  platform:"node",
  format:"esm",
  packages:"external",
  outfile:resolve(output,"qaRailwayBootstrap.mjs"),
  sourcemap:false,
});

const launcher=resolve(output,"start-railway-qa.mjs");
await copyFile(
  resolve(root,"server/vip/qaRailwayNetworkGuard.mjs"),
  resolve(output,"qaRailwayNetworkGuard.mjs"),
);
await copyFile(
  resolve(root,"server/vip/qaRailwayDnsPin.mjs"),
  resolve(output,"qaRailwayDnsPin.mjs"),
);
await writeFile(
  launcher,
  `const runtimeNames=new Set(["PATH","HOME","TMPDIR","LANG","LC_ALL","TZ","NODE_ENV","PORT","PWD","SHLVL","HOSTNAME","TERM","KINGLIKE_VIP_QA_PREVIEW","KINGLIKE_VIP_ENABLED","VITE_KINGLIKE_VIP_ENABLED","KINGLIKE_VIP_EMAIL_ENABLED","KINGLIKE_VIP_EMAIL_LIVE_APPROVED","KINGLIKE_VIP_QA_DATABASE_URL","KINGLIKE_VIP_QA_EXPECTED_DB_HOST","KINGLIKE_VIP_QA_EXPECTED_DB_NAME","KINGLIKE_VIP_QA_EXPECTED_DB_ROLE","KINGLIKE_VIP_QA_EXPECTED_DB_ADDRESS","KINGLIKE_VIP_QA_ENVIRONMENT_ID","KINGLIKE_VIP_QA_GATE_USER","KINGLIKE_VIP_QA_GATE_PASSWORD","KINGLIKE_VIP_QA_SESSION_SECRET","KINGLIKE_VIP_QA_STATIC_DIR","KINGLIKE_VIP_QA_RUNTIME","KINGLIKE_VIP_QA_START"]);\n`+
  `for(const name of Object.keys(process.env)){if(!runtimeNames.has(name)&&!/^RAILWAY_[A-Z0-9_]+$/.test(name))delete process.env[name];}\n`+
  `process.env.KINGLIKE_VIP_QA_RUNTIME="railway";\n`+
  `process.env.KINGLIKE_VIP_QA_START="true";\n`+
  `await import("./qaRailwayNetworkGuard.mjs");\n`+
  `await import("./server.mjs");\n`,
  {mode:0o600},
);
await writeFile(
  resolve(output,"BUILD-NOTES.txt"),
  "Railway VIP QA bundle only. No app server was started.\n"+
  "The database guard permits one pinned private QA database; all mail, CRM, and object-storage adapters are synthetic.\n",
  {mode:0o600},
);
process.stdout.write("Isolated Railway VIP QA bundle built; no service was started.\n");
