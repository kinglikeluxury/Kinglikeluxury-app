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
  "KINGLIKE_VIP_QA_LOGIN_ADMIN_PASSWORD",
  "KINGLIKE_VIP_QA_LOGIN_BUYER_PASSWORD",
  "KINGLIKE_VIP_QA_LOGIN_SELLER_PASSWORD",
  "KINGLIKE_VIP_QA_LOGIN_FINANCE_PASSWORD",
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

export type QaBootstrapFailureCategory=
  |"configuration"
  |"configuration_environment"
  |"configuration_environment_npm_metadata"
  |"configuration_environment_build_metadata"
  |"configuration_environment_other"
  |"configuration_environment_npm_build"
  |"configuration_environment_npm_other"
  |"configuration_environment_build_other"
  |"configuration_environment_mixed"
  |"configuration_runtime_mode"
  |"configuration_package_override"
  |"configuration_seed_variables"
  |"configuration_approval_flags"
  |"configuration_external_communications"
  |"configuration_required_fields"
  |"configuration_database_url"
  |"configuration_database_identity"
  |"configuration_credentials"
  |"database_endpoint"
  |"database_connection"
  |"database_authentication"
  |"database_identity"
  |"database_permission"
  |"database_schema"
  |"synthetic_seed"
  |"unknown";

export function classifyQaBootstrapFailure(error:unknown):QaBootstrapFailureCategory{
  const source=error&&typeof error==="object"?error as {code?:unknown;message?:unknown}:{};
  const explicitCategory=(error&&typeof error==="object"&&
    "qaBootstrapCategory" in error&&typeof error.qaBootstrapCategory==="string")?
    error.qaBootstrapCategory:"";
  const configurationCategories=new Set([
    "configuration_environment","configuration_environment_npm_metadata",
    "configuration_environment_build_metadata","configuration_environment_other",
    "configuration_environment_npm_build","configuration_environment_npm_other",
    "configuration_environment_build_other",
    "configuration_environment_mixed","configuration_runtime_mode",
    "configuration_package_override","configuration_seed_variables",
    "configuration_approval_flags","configuration_external_communications",
    "configuration_required_fields","configuration_database_url",
    "configuration_database_identity","configuration_credentials",
  ]);
  if(configurationCategories.has(explicitCategory)){
    return explicitCategory as QaBootstrapFailureCategory;
  }
  const code=typeof source.code==="string"?source.code:"";
  const message=typeof source.message==="string"?source.message.toLowerCase():"";
  if(["ENOTFOUND","EAI_AGAIN","ECONNREFUSED","ECONNRESET","ETIMEDOUT",
    "EHOSTUNREACH","ENETUNREACH","EPIPE"].includes(code)){
    return "database_connection";
  }
  if(["28P01","28000"].includes(code))return "database_authentication";
  if(code==="42501")return "database_permission";
  if(["3D000","42P01","42P07","42704"].includes(code))return "database_schema";
  if(code==="23505")return "synthetic_seed";
  if(/identity|privilege|authority/.test(message))return "database_identity";
  if(/dns|private ipv4|private host/.test(message))return "database_endpoint";
  if(/schema|migration|relation|database is not empty/.test(message))return "database_schema";
  if(/configuration|credential policy|external communication|unapproved environment/.test(message)){
    return "configuration";
  }
  if(error instanceof URIError)return "configuration_database_url";
  return "unknown";
}

function configFailure(
  category:Extract<QaBootstrapFailureCategory,`configuration_${string}`>,
):Error{
  return Object.assign(new Error("Isolated VIP QA configuration was refused"),{
    qaBootstrapCategory:category,
  });
}

export function stripQaBootstrapBuildMetadata(
  env:Record<string,string|undefined>,
):void{
  for(const name of Object.keys(env)){
    if(/^npm_config_/i.test(name)||/^NIXPACKS_[A-Z0-9_]+$/.test(name)||
      name==="CI"||name==="npm_execpath"||name==="npm_node_execpath"){
      delete env[name];
    }
  }
}

function required(env:Record<string,string|undefined>,name:string):string{
  const value=env[name];
  if(typeof value!=="string"||value.length===0){
    throw configFailure("configuration_required_fields");
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
  const unexpectedNames=Object.keys(env).filter(name=>
    env[name]!==undefined&&!allowedNames.has(name)&&!/^RAILWAY_[A-Z0-9_]+$/.test(name));
  if(unexpectedNames.length){
    const families=new Set(unexpectedNames.map(name=>
      /^npm_/i.test(name)?"npm_metadata":
      /^NIXPACKS_/i.test(name)?"build_metadata":"other"));
    const hasNpm=families.has("npm_metadata");
    const hasBuild=families.has("build_metadata");
    const hasOther=families.has("other");
    const category=(hasNpm&&hasBuild&&hasOther?"configuration_environment_mixed":
      hasNpm&&hasBuild?"configuration_environment_npm_build":
      hasNpm&&hasOther?"configuration_environment_npm_other":
      hasBuild&&hasOther?"configuration_environment_build_other":
      families.has("npm_metadata")?"configuration_environment_npm_metadata":
      families.has("build_metadata")?"configuration_environment_build_metadata":
      "configuration_environment_other") as Extract<
        QaBootstrapFailureCategory,`configuration_${string}`
      >;
    throw configFailure(category);
  }
  if(env.NODE_ENV!=="production"){
    throw configFailure("configuration_runtime_mode");
  }
  if(env.RAILPACK_INSTALL_CMD!==undefined&&env.RAILPACK_INSTALL_CMD!==""){
    throw configFailure("configuration_package_override");
  }
  if(["KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD",
      "KINGLIKE_VIP_QA_PROVISION_BUYER_PASSWORD",
      "KINGLIKE_VIP_QA_PROVISION_SELLER_PASSWORD",
      "KINGLIKE_VIP_QA_PROVISION_FINANCE_PASSWORD",
    ].some(name=>env[name]!==undefined&&env[name]!=="")){
    throw configFailure("configuration_seed_variables");
  }
  if(
    env.KINGLIKE_VIP_QA_BOOTSTRAP_EXECUTE!=="true"||
    env.KINGLIKE_VIP_QA_BOOTSTRAP_APPROVED!=="true"||
    env.KINGLIKE_VIP_QA_PREVIEW!=="true"||
    env.KINGLIKE_VIP_ENABLED!=="true"||
    (env.VITE_KINGLIKE_VIP_ENABLED!==undefined&&env.VITE_KINGLIKE_VIP_ENABLED!=="true")){
    throw configFailure("configuration_approval_flags");
  }
  if((env.KINGLIKE_VIP_EMAIL_ENABLED!==undefined&&env.KINGLIKE_VIP_EMAIL_ENABLED!=="false")||
    (env.KINGLIKE_VIP_EMAIL_LIVE_APPROVED!==undefined&&env.KINGLIKE_VIP_EMAIL_LIVE_APPROVED!=="false")){
    throw configFailure("configuration_external_communications");
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
    admin:required(env,"KINGLIKE_VIP_QA_LOGIN_ADMIN_PASSWORD"),
    buyer:required(env,"KINGLIKE_VIP_QA_LOGIN_BUYER_PASSWORD"),
    seller:required(env,"KINGLIKE_VIP_QA_LOGIN_SELLER_PASSWORD"),
    finance:required(env,"KINGLIKE_VIP_QA_LOGIN_FINANCE_PASSWORD"),
  };

  let admin:URL,runtime:URL;
  try{
    admin=new URL(adminDatabaseUrl);
    runtime=new URL(runtimeDatabaseUrl);
  }catch{
    throw configFailure("configuration_database_url");
  }
  let adminRole:string,runtimeUsername:string,runtimePassword:string,runtimeDatabase:string;
  try{
    adminRole=decodeURIComponent(admin.username);
    runtimeUsername=decodeURIComponent(runtime.username);
    runtimePassword=decodeURIComponent(runtime.password);
    runtimeDatabase=decodeURIComponent(runtime.pathname.replace(/^\/+/,""));
  }catch{
    throw configFailure("configuration_database_url");
  }
  if(!["postgres:","postgresql:"].includes(admin.protocol)||
    !admin.password||admin.hostname.toLowerCase()!==host||
    (admin.port&&Number(admin.port)!==5432)||admin.search||admin.hash||
    !["postgres:","postgresql:"].includes(runtime.protocol)||
    runtime.hostname.toLowerCase()!==host||
    (runtime.port&&Number(runtime.port)!==5432)||runtime.search||runtime.hash||
    runtimeUsername!==runtimeRole||runtimeDatabase!==database||
    !/^[a-z0-9.-]+\.railway\.internal$/.test(host)||
    !/^vipqa_[a-z0-9_]{2,32}$/.test(database)||
    !/^vipqa_[a-z0-9_]{2,32}$/.test(runtimeRole)||
    runtimeRole==="vipqa_migrator"||
    env.KINGLIKE_VIP_QA_EXPECTED_DB_ADDRESS!=="auto"||
    !isUuid(environmentId)||
    (env.RAILWAY_ENVIRONMENT_ID!==undefined&&env.RAILWAY_ENVIRONMENT_ID!==environmentId)){
    throw configFailure("configuration_database_identity");
  }
  if(/^vipqa_[a-z0-9_]{2,32}$/.test(adminRole)||
    !strongSecret(runtimePassword)||
    gateUser.length<4||gatePassword.length<20||sessionSecret.length<48||
    !strongSecret(migratorPassword)||
    new Set(Object.values(accountPasswords)).size!==4||
    Object.entries(accountPasswords).some(([role,password])=>
      !validateQaBootstrapIdentity(
        `qa_preview_${role}`,
        `qa_preview_${role}@vipqa.test`,
        password,
      ))){
    throw configFailure("configuration_credentials");
  }

  return Object.freeze({
    adminDatabaseUrl,runtimeDatabaseUrl,host,database,runtimeRole,
    migratorRole:"vipqa_migrator",
    expectedEnvironmentId:environmentId,
    migratorPassword,
    accountPasswords:Object.freeze(accountPasswords),
  });
}
