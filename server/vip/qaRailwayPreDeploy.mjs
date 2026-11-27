import {access} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const bootstrapEnabled=process.env.KINGLIKE_VIP_QA_BOOTSTRAP_EXECUTE==="true";
const approved=process.env.KINGLIKE_VIP_QA_BOOTSTRAP_APPROVED==="true";
const productionEnv=process.env.NODE_ENV==="production";
process.stdout.write(
  `qa_predeploy=entered node=${process.versions.node} `+
  `production=${productionEnv} bootstrap_enabled=${bootstrapEnabled} approved=${approved}\n`,
);

let stage="configuration";
try{
  if(!productionEnv||!bootstrapEnabled||!approved){
    throw new Error("QA bootstrap gates are closed");
  }
  stage="bundle_presence";
  const bundlePath=resolve(
    process.cwd(),"dist/qa-vip-railway-build/qaRailwayBootstrap.mjs",
  );
  await access(bundlePath);
  process.stdout.write("qa_predeploy=bootstrap_bundle_present\n");
  stage="bootstrap_execution";
  await import(pathToFileURL(bundlePath).href);
  if(process.exitCode===1){
    throw new Error("QA bootstrap reported a refused initialization");
  }
  process.stdout.write("qa_predeploy=complete\n");
}catch(error){
  const maybeCode=error&&typeof error==="object"&&"code" in error?
    error.code:"";
  const code=typeof maybeCode==="string"?maybeCode:"";
  const category=code==="ENOENT"?"missing_bundle":
    stage==="configuration"?"configuration_gate":
    stage==="bootstrap_execution"?"bootstrap_failed":"entrypoint_failed";
  process.stderr.write(
    `qa_predeploy=failed stage=${stage} category=${category}; no credentials logged\n`,
  );
  process.exitCode=1;
}
