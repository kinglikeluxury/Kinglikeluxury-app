import {access} from "node:fs/promises";
import {resolve} from "node:path";
import {createQaApp} from "./qaPreviewServer";
import {assertQaRailwayDatabaseIdentity} from "./qaRailwayPreviewDb";
import {assertRailwayQaPreviewEnvironment} from "./qaRailwayPreviewRules";

const RAILWAY_QA_HOST="0.0.0.0";
const RAILWAY_QA_STATIC_DIR="dist/qa-vip-railway-build/public";

export async function startQaRailwayPreview():Promise<void>{
  let stage="environment";
  let listenerErrorCode="not_available";
  let listenerPortClass="invalid";
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
  const port=Number(process.env.PORT);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid Railway QA port");
  listenerPortClass=port<1024?"privileged":"unprivileged";
  const processClass=typeof process.getuid==="function"
    ?(process.getuid()===0?"root":"nonroot")
    :"unknown";
  process.stdout.write(`qa_listener_attempt host=${RAILWAY_QA_HOST} port=${port} process=${processClass}\n`);
  await new Promise<void>((resolvePromise,rejectPromise)=>{
    const server=app.listen(port,RAILWAY_QA_HOST,()=>{
      process.stdout.write("Synthetic VIP QA service ready.\n");
      resolvePromise();
    });
    server.once("error",(error:NodeJS.ErrnoException)=>{
      const code=error?.code||"";
      listenerErrorCode=["EADDRINUSE","EACCES","EINVAL","EADDRNOTAVAIL"].includes(code)
        ?code:"other";
      rejectPromise(new Error("Railway VIP QA listener failed"));
    });
  });
  }catch{
    const portState=process.env.PORT?"set":"missing";
    const listenerState=stage==="listener"
      ?` listener_code=${listenerErrorCode} port=${portState} port_class=${listenerPortClass}`
      :"";
    process.stderr.write(`Railway VIP QA startup refused stage=${stage}${listenerState}.\n`);
    process.exitCode=1;
  }
}

if(process.env.KINGLIKE_VIP_QA_START==="true"&&
  process.env.KINGLIKE_VIP_QA_RUNTIME==="railway"){
  startQaRailwayPreview();
}
