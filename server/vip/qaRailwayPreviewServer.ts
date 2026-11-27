import {access} from "node:fs/promises";
import {resolve} from "node:path";
import {createQaApp} from "./qaPreviewServer";
import {assertQaRailwayDatabaseIdentity} from "./qaRailwayPreviewDb";
import {assertRailwayQaPreviewEnvironment} from "./qaRailwayPreviewRules";

const RAILWAY_QA_HOST="0.0.0.0";
const RAILWAY_QA_STATIC_DIR="dist/qa-vip-railway-build/public";

export async function startQaRailwayPreview():Promise<void>{
  assertRailwayQaPreviewEnvironment(process.env);
  await assertQaRailwayDatabaseIdentity();
  try{
    await access(resolve(process.cwd(),RAILWAY_QA_STATIC_DIR,"index.html"));
  }catch{
    throw new Error("Railway VIP QA web assets are missing");
  }
  const app=createQaApp({
    validateConfiguration:()=>{assertRailwayQaPreviewEnvironment(process.env);},
    minimalPublicHealth:true,
    staticDirectory:RAILWAY_QA_STATIC_DIR,
  });
  await new Promise<void>((resolvePromise,rejectPromise)=>{
    const server=app.listen(Number(process.env.PORT),RAILWAY_QA_HOST,()=>{
      process.stdout.write("Synthetic VIP QA service ready.\n");
      resolvePromise();
    });
    server.once("error",()=>rejectPromise(new Error("Railway VIP QA listener failed")));
  });
}

if(process.env.KINGLIKE_VIP_QA_START==="true"&&
  process.env.KINGLIKE_VIP_QA_RUNTIME==="railway"){
  startQaRailwayPreview().catch(()=>{
    process.stderr.write("Railway VIP QA startup refused; check isolated QA configuration.\n");
    process.exitCode=1;
  });
}
