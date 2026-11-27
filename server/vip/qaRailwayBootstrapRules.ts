import {isIP} from "node:net";
import {validateQaBootstrapIdentity} from "./qaBootstrapRules";

const allowedNames=new Set([
  "PATH","HOME","TMPDIR","LANG","LC_ALL","TZ","NODE_ENV","PORT","PWD","SHLVL",
  "RAILPACK_INSTALL_CMD",
  "KINGLIKE_VIP_QA_BOOTSTRAP_EXECUTE","KINGLIKE_VIP_QA_BOOTSTRAP_APPROVED",
  "KINGLIKE_VIP_QA_BOOTSTRAP_ADMIN_DATABASE_URL",
  "KINGLIKE_VIP_QA_PREVIEW","KINGLIKE_VIP_ENABLED","VITE_KINGLIKE_VIP_ENABLED",
  "KINGLIKE_VIP_EMAIL_ENABLED","KINGLIKE_VIP_EMAIL_LIVE_APPROVED",
  "KINGLIKE_VIP_QA_DATABASE_URL","KINGLIKE_VIP_QA_EXPECTED_DB_HOST",
  "KINGLIKE_VIP_QA_EXPECTED_DB_NAME","KINGLIKE_VIP_QA_EXPECTED_DB_ROLE",
  "KINGLIKE_VIP_QA_EXPECTED_DB_ADDRESS","KINGLIKE_VIP_QA_ENVIRONMENT_ID",
  "KINGLIKE_VIP_QA_GATE_USER","KINGLIKE_VIP_QA_GATE_PASSWORD",
  "KINGLIKE_VIP_QA_SESSION_SECRET",
  "KINGLIKE_VIP_QA_PROVISION_MIGRATOR_PASSWORD",
  "KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD",
  "KINGLIKE_VIP_QA_PROVISION_BUYER_PASSWORD",
  "KINGLIKE_VIP_QA_PROVISION_SELLER_PASSWORD",
  "KINGLIKE_VIP_QA_PROVISION_FINANCE_PASSWORD",
]);

export type RailwayBootstrapConfig=Readonly<{
  adminDatabaseUrl:string;
  runtimeDatabaseUrl:string;
  host:string;
  database:string;
  runtimeRole:string;
  migratorRole:"vipqa_migrator";
  expectedEnvironmentId:string;
  migratorPassword:string;
  accountPasswords:Readonly<{admin:string;buyer:string;seller:string;finance:string}>;
}>;

function required(env:Record<string,string|undefined>,name:string):string{
  const value=env[name];
  if(typeof value!=="string"||value.length===0){
    throw new Error("Isolated VIP QA bootstrap configuration is incomplete");
  }
  return value;
}

function isUuid(value:string):boolean{
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function strongSecret(value:string):boolean{
  return value.length>=24&&value.length<=128&&
    /[a-z]/.test(value)&&/[A-Z]/.test(value)&&/[0-9]/.test(value)&&
    /[^a-zA-Z0-9]/.test(value);
}

export function isPrivateRailwayBootstrapIpv4(value:string):boolean{
  if(isIP(value)!==4)return false;
  const [a,b]=value.split(".").map(Number);
  return a===10||(a===172&&b>=16&&b<=31)||
    (a===192&&b===168)||(a===100&&b>=64&&b<=127);
}

export function validateRailwayBootstrapEnvironment(
  env:Record<string,string|undefined>,
):RailwayBootstrapConfig{
  if(Object.entries(env).some(([name,value])=>
    value!==undefined&&!allowedNames.has(name)&&!/^RAILWAY_[A-Z0-9_]+$/.test(name))){
    throw new Error("Isolated VIP QA bootstrap rejected an unapproved environment");
  }
  if(env.NODE_ENV!=="production"||
    (env.RAILPACK_INSTALL_CMD!==undefined&&env.RAILPACK_INSTALL_CMD!=="npm ci --include=dev")||
    env.KINGLIKE_VIP_QA_BOOTSTRAP_EXECUTE!=="true"||
    env.KINGLIKE_VIP_QA_BOOTSTRAP_APPROVED!=="true"||
    env.KINGLIKE_VIP_QA_PREVIEW!=="true"||
    env.KINGLIKE_VIP_ENABLED!=="true"||
    (env.KINGLIKE_VIP_EMAIL_ENABLED!==undefined&&env.KINGLIKE_VIP_EMAIL_ENABLED!=="false")||
    (env.KINGLIKE_VIP_EMAIL_LIVE_APPROVED!==undefined&&env.KINGLIKE_VIP_EMAIL_LIVE_APPROVED!=="false")||
    (env.VITE_KINGLIKE_VIP_ENABLED!==undefined&&env.VITE_KINGLIKE_VIP_ENABLED!=="true")){
    throw new Error("Isolated VIP QA bootstrap requires closed external communications");
  }

  const host=required(env,"KINGLIKE_VIP_QA_EXPECTED_DB_HOST").toLowerCase();
  const database=required(env,"KINGLIKE_VIP_QA_EXPECTED_DB_NAME");
  const runtimeRole=required(env,"KINGLIKE_VIP_QA_EXPECTED_DB_ROLE");
  const environmentId=required(env,"KINGLIKE_VIP_QA_ENVIRONMENT_ID").toLowerCase();
  const adminDatabaseUrl=required(env,"KINGLIKE_VIP_QA_BOOTSTRAP_ADMIN_DATABASE_URL");
  const runtimeDatabaseUrl=required(env,"KINGLIKE_VIP_QA_DATABASE_URL");
  const gateUser=required(env,"KINGLIKE_VIP_QA_GATE_USER");
  const gatePassword=required(env,"KINGLIKE_VIP_QA_GATE_PASSWORD");
  const sessionSecret=required(env,"KINGLIKE_VIP_QA_SESSION_SECRET");
  const migratorPassword=required(env,"KINGLIKE_VIP_QA_PROVISION_MIGRATOR_PASSWORD");
  const accountPasswords={
    admin:required(env,"KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD"),
    buyer:required(env,"KINGLIKE_VIP_QA_PROVISION_BUYER_PASSWORD"),
    seller:required(env,"KINGLIKE_VIP_QA_PROVISION_SELLER_PASSWORD"),
    finance:required(env,"KINGLIKE_VIP_QA_PROVISION_FINANCE_PASSWORD"),
  };

  let admin:URL,runtime:URL;
  try{
    admin=new URL(adminDatabaseUrl);
    runtime=new URL(runtimeDatabaseUrl);
  }catch{
    throw new Error("Isolated VIP QA database URL is invalid");
  }
  const adminRole=decodeURIComponent(admin.username);
  const runtimeUsername=decodeURIComponent(runtime.username);
  const runtimePassword=decodeURIComponent(runtime.password);
  const runtimeDatabase=decodeURIComponent(runtime.pathname.replace(/^\/+/,""));
  if(!["postgres:","postgresql:"].includes(admin.protocol)||
    !admin.password||admin.hostname.toLowerCase()!==host||
    (admin.port&&Number(admin.port)!==5432)||admin.search||admin.hash||
    /^vipqa_[a-z0-9_]{2,32}$/.test(adminRole)||
    !["postgres:","postgresql:"].includes(runtime.protocol)||
    !strongSecret(runtimePassword)||runtime.hostname.toLowerCase()!==host||
    (runtime.port&&Number(runtime.port)!==5432)||runtime.search||runtime.hash||
    runtimeUsername!==runtimeRole||runtimeDatabase!==database||
    !/^[a-z0-9.-]+\.railway\.internal$/.test(host)||
    !/^vipqa_[a-z0-9_]{2,32}$/.test(database)||
    !/^vipqa_[a-z0-9_]{2,32}$/.test(runtimeRole)||
    runtimeRole==="vipqa_migrator"||
    env.KINGLIKE_VIP_QA_EXPECTED_DB_ADDRESS!=="auto"||
    !isUuid(environmentId)||
    (env.RAILWAY_ENVIRONMENT_ID!==undefined&&env.RAILWAY_ENVIRONMENT_ID!==environmentId)||
    gateUser.length<4||gatePassword.length<20||sessionSecret.length<48||
    !strongSecret(migratorPassword)||
    new Set(Object.values(accountPasswords)).size!==4||
    Object.entries(accountPasswords).some(([role,password])=>
      !validateQaBootstrapIdentity(
        `qa_preview_${role}`,
        `qa_preview_${role}@vipqa.test`,
        password,
      ))){
    throw new Error("Isolated VIP QA bootstrap identity or credential policy failed");
  }

  return Object.freeze({
    adminDatabaseUrl,runtimeDatabaseUrl,host,database,runtimeRole,
    migratorRole:"vipqa_migrator",
    expectedEnvironmentId:environmentId,
    migratorPassword,
    accountPasswords:Object.freeze(accountPasswords),
  });
}
