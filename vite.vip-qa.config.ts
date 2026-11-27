import path from "node:path";
import {fileURLToPath} from "node:url";
import react from "@vitejs/plugin-react";
import {defineConfig, type Plugin} from "vite";
import {sanitizeQaPreviewHtml} from "./server/vip/qaPreviewHtml.mjs";
import {transformQaLoginSource} from "./server/vip/qaLoginRedirectTransform.mjs";
import {transformQaEntryWithoutServiceWorker} from "./server/vip/qaServiceWorkerTransform.mjs";

const projectRoot=path.dirname(fileURLToPath(import.meta.url));
const qaOutput=path.resolve(projectRoot,".local/qa-vip-build/public");
const emptyEnv=path.resolve(projectRoot,".local/qa-vip-empty-env");
const vipUiEnabled=process.env.KINGLIKE_VIP_QA_UI_ENABLED??"true";
if(!["true","false"].includes(vipUiEnabled)){
  throw new Error("VIP QA UI flag must be explicitly true or false");
}

const localHtmlOnly:Plugin={
  name:"kinglike-vip-local-qa-html",
  transformIndexHtml(html){
    return sanitizeQaPreviewHtml(html);
  },
};

const qaLoginRedirect:Plugin={
  name:"kinglike-vip-qa-login-redirect",
  enforce:"pre",
  transform(code,id){
    return transformQaLoginSource(
      code,
      id,
      path.resolve(projectRoot,"client/src/pages/login.tsx"),
    );
  },
};

const qaDisableServiceWorker:Plugin={
  name:"kinglike-vip-qa-disable-service-worker",
  enforce:"pre",
  transform(code,id){
    return transformQaEntryWithoutServiceWorker(
      code,
      id,
      path.resolve(projectRoot,"client/src/main.tsx"),
    );
  },
};

export default defineConfig({
  mode:"qa",
  envDir:emptyEnv,
  envPrefix:"VITE_",
  define:{
    "import.meta.env.VITE_KINGLIKE_VIP_ENABLED":JSON.stringify(vipUiEnabled),
    "import.meta.env.VITE_KINGLIKE_VIP_QA":JSON.stringify("true"),
  },
  plugins:[qaLoginRedirect,qaDisableServiceWorker,react(),localHtmlOnly],
  resolve:{alias:{
    "@":path.resolve(projectRoot,"client/src"),
    "@shared":path.resolve(projectRoot,"shared"),
    "@assets":path.resolve(projectRoot,"attached_assets"),
  }},
  root:path.resolve(projectRoot,"client"),
  build:{
    outDir:qaOutput,
    emptyOutDir:true,
    sourcemap:false,
  },
});
