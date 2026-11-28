import {access} from "node:fs/promises";
import {resolve} from "node:path";
import {createQaApp} from "./qaPreviewServer";
import {assertQaRailwayDatabaseIdentity} from "./qaRailwayPreviewDb";
import {assertRailwayQaPreviewEnvironment} from "./qaRailwayPreviewRules";

const RAILWAY_QA_HOST="0.0.0.0";
const RAILWAY_QA_STATIC_DIR="dist/qa-vip-railway-build/public";

export async function startQaRailwayPreview():Promise<void>{
  let stage="environment";
  try{
  assertRailwayQaPreviewEnvironment(process.env);
  stage="database_identity";
  await assertQaRailwayDatabaseIdentity();
  stage="static_assets";
  try{
    await access(resolve(process.cwd(),RAILWAY_QA_STATIC_DIR,"index.html"));
  }catch{
    throw new Error("Railway VIP QA web assets are missing");
  }
  stage="app_configuration";
  const app=createQaApp({
    validateConfiguration:()=>{assertRailwayQaPreviewEnvironment(process.env);},
    staticDirectory:RAILWAY_QA_STATIC_DIR,
  });
  stage="listener";
  await new Promise<void>((resolvePromise,rejectPromise)=>{
    const server=app.listen(Number(process.env.PORT),RAILWAY_QA_HOST,()=>{
      process.stdout.write("Synthetic VIP QA service ready.\n");
      resolvePromise();
    });
    server.once("error",()=>rejectPromise(new Error("Railway VIP QA listener failed")));
  });
  }catch{
    process.stderr.write(`Railway VIP QA startup refused stage=${stage}.\n`);
    process.exitCode=1;
  }
}

if(process.env.KINGLIKE_VIP_QA_START==="true"&&
  process.env.KINGLIKE_VIP_QA_RUNTIME==="railway"){
  startQaRailwayPreview();
}
