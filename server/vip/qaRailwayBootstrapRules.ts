import {isIP} from "node:net";
import {validateQaBootstrapIdentity} from "./qaBootstrapRules";
import {
  assertRailwayQaPreviewEnvironment,
  RAILWAY_QA_RUNTIME_ENV_ALLOWLIST,
} from "./qaRailwayPreviewRules";

const allowedNames=new Set([
  "PATH","HOME","TMPDIR","LANG","LC_ALL","TZ","NODE_ENV","PORT","PWD","SHLVL",
  "LD_LIBRARY_PATH",
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
const seedLoginNames=Object.freeze([
  "KINGLIKE_VIP_QA_LOGIN_ADMIN_PASSWORD",
  "KINGLIKE_VIP_QA_LOGIN_BUYER_PASSWORD",
  "KINGLIKE_VIP_QA_LOGIN_SELLER_PASSWORD",
  "KINGLIKE_VIP_QA_LOGIN_FINANCE_PASSWORD",
]);
const setupOnlyNames=Object.freeze([
  "KINGLIKE_VIP_QA_BOOTSTRAP_ADMIN_DATABASE_URL",
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

export type QaBootstrapFailureCategory=
  |"configuration"
  |"configuration_environment"
  |"configuration_environment_npm_metadata"
  |"configuration_environment_build_metadata"
  |"configuration_environment_other"
  |"configuration_environment_npm_build"
  |"configuration_environment_npm_other"
  |"configuration_environment_build_other"
  |"configuration_environment_sensitive_name"
  |"configuration_environment_mixed"
  |"configuration_bootstrap_privileges_present"
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
    "configuration_environment_sensitive_name",
    "configuration_environment_mixed","configuration_runtime_mode",
    "configuration_bootstrap_privileges_present",
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
  variableNames:readonly string[]=[],
):Error{
  const safeNames=Array.from(new Set(variableNames.filter(name=>
    /^[A-Z][A-Z0-9_]{1,127}$/.test(name)))).slice(0,12);
  return Object.assign(new Error("Isolated VIP QA configuration was refused"),{
    qaBootstrapCategory:category,
    qaBootstrapVariableNames:safeNames,
  });
}

export function getQaBootstrapRejectedVariableNames(error:unknown):string[]{
  if(!error||typeof error!=="object"||!("qaBootstrapVariableNames" in error)||
    !Array.isArray(error.qaBootstrapVariableNames))return [];
  return error.qaBootstrapVariableNames.filter((name):name is string=>
    typeof name==="string"&&/^[A-Z][A-Z0-9_]{1,127}$/.test(name)).slice(0,12);
}

export type QaBootstrapAdminIdentity=Readonly<{
  database:string;
  role:string;
  serverAddress:string|null;
  serverPort:number;
  superuser:boolean;
  createdb:boolean;
  createrole:boolean;
}>;

export function getQaBootstrapAdminIdentityFailures(
  row:QaBootstrapAdminIdentity|undefined,
  expected:{database:string;address:string;adminRole:string},
):string[]{
  if(!row)return ["identity_row_present"];
  const checks:ReadonlyArray<[string,boolean]>=[
    ["role_matches",expected.adminRole.length>0&&row.role===expected.adminRole],
    ["admin_database_is_separate",row.database!==expected.database],
    ["private_address_is_private",
      isPrivateRailwayBootstrapIpv4(expected.address)&&
      isPrivateRailwayBootstrapIpv4(row.serverAddress||"")],
    ["port_is_5432",Number(row.serverPort)===5432],
    ["setup_superuser",row.superuser],
    ["setup_createdb",row.createdb],
    ["setup_createrole",row.createrole],
  ];
  return checks.filter(([,passed])=>!passed).map(([name])=>name);
}

export function getQaBootstrapIdentityFailureChecks(error:unknown):string[]{
  if(!error||typeof error!=="object"||
    !("qaBootstrapIdentityFailures" in error)||
    !Array.isArray(error.qaBootstrapIdentityFailures))return [];
  return error.qaBootstrapIdentityFailures.filter((name):name is string=>
    typeof name==="string"&&[
      "identity_row_present","role_matches","admin_database_is_separate",
      "private_address_is_private","port_is_5432","setup_superuser",
      "setup_createdb","setup_createrole",
    ].includes(name));
}

export function sanitizeQaBootstrapEnvironment(
  env:Record<string,string|undefined>,
):void{
  const shellMetadata=new Set([
    "BASH_ENV","BASHOPTS","BASH_VERSION","INIT_CWD","LOGNAME",
    "OLDPWD","SHELL","SHELLOPTS","USER",
  ]);
  for(const name of Object.keys(env)){
    if(/^NIXPACKS_METADATA$/i.test(name)){
      delete env[name];
      continue;
    }
    if(allowedNames.has(name)||/^RAILWAY_[A-Z0-9_]+$/.test(name))continue;
    if(/(?:DATABASE|(?:^|_)DB(?:_|$)|PASSWORD|SECRET|TOKEN|API.?KEY|PRIVATE.?KEY|CREDENTIAL|AUTH|EMAIL|SMS|WHATSAPP|CRM|META|CLOUDINARY|NEON|(?:^|_)S3(?:_|$)|STORAGE|PAYMENT|PUSH|WEBHOOK|OAUTH|TURNSTILE|NODE_OPTIONS|NODE_PATH|LD_PRELOAD|LD_LIBRARY_PATH|ENABLED|APPROVED|(?:^|_)MODE(?:_|$))/i.test(name)){
      continue;
    }
    if(/^npm_/i.test(name)||/^NIXPACKS_[A-Z0-9_]+$/i.test(name)||name==="CI"||
      shellMetadata.has(name)){
      delete env[name];
      continue;
    }
    delete env[name];
  }
}

export function validateRailwayQaRuntimeOnlyEnvironment(
  env:Record<string,string|undefined>,
):void{
  const bootstrapFlags=[
    "KINGLIKE_VIP_QA_BOOTSTRAP_EXECUTE",
    "KINGLIKE_VIP_QA_BOOTSTRAP_APPROVED",
  ];
  const runtimeEnv={...env};
  for(const name of [
    ...bootstrapFlags,...setupOnlyNames,...seedLoginNames,"RAILPACK_INSTALL_CMD",
  ]){
    delete runtimeEnv[name];
  }
  sanitizeQaBootstrapEnvironment(runtimeEnv);
  const unexpectedNames=Object.keys(runtimeEnv).filter(name=>
    !RAILWAY_QA_RUNTIME_ENV_ALLOWLIST.has(name)&&
    !/^RAILWAY_[A-Z0-9_]+$/.test(name));
  if(unexpectedNames.length){
    throw configFailure("configuration_environment_sensitive_name",unexpectedNames);
  }
  const activeFlags=bootstrapFlags.filter(name=>env[name]==="true");
  if(activeFlags.length){
    throw configFailure("configuration_bootstrap_privileges_present",activeFlags);
  }
  if(bootstrapFlags.some(name=>env[name]!==undefined&&
    env[name]!==""&&env[name]!=="false")){
    throw configFailure("configuration_approval_flags",bootstrapFlags);
  }
  const presentSetupCredentials=setupOnlyNames.filter(name=>
    env[name]!==undefined&&env[name]!=="");
  if(presentSetupCredentials.length){
    throw configFailure(
      "configuration_bootstrap_privileges_present",presentSetupCredentials,
    );
  }
  if(env.NODE_ENV!=="production"){
    throw configFailure("configuration_runtime_mode");
  }
  if(env.RAILPACK_INSTALL_CMD!==undefined&&env.RAILPACK_INSTALL_CMD!==""){
    throw configFailure("configuration_package_override",["RAILPACK_INSTALL_CMD"]);
  }
  runtimeEnv.KINGLIKE_VIP_QA_RUNTIME="railway";
  runtimeEnv.KINGLIKE_VIP_QA_START="true";
  assertRailwayQaPreviewEnvironment(runtimeEnv);
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

export function isAllowedRailwayQaServerAddress(
  actual:string|null,
  expectedAddress:string,
  resolvedAddress:string,
):boolean{
  if(!actual||!isPrivateRailwayBootstrapIpv4(actual)||
    !isPrivateRailwayBootstrapIpv4(resolvedAddress))return false;
  return expectedAddress==="auto"||
    (isPrivateRailwayBootstrapIpv4(expectedAddress)&&expectedAddress===resolvedAddress);
}

export function validateRailwayBootstrapEnvironment(
  env:Record<string,string|undefined>,
):RailwayBootstrapConfig{
  const unexpectedNames=Object.keys(env).filter(name=>
    env[name]!==undefined&&!allowedNames.has(name)&&!/^RAILWAY_[A-Z0-9_]+$/.test(name));
  if(unexpectedNames.length){
    if(unexpectedNames.some(name=>
      /(?:DATABASE|(?:^|_)DB(?:_|$)|PASSWORD|SECRET|TOKEN|API.?KEY|PRIVATE.?KEY|CREDENTIAL|AUTH|EMAIL|SMS|WHATSAPP|CRM|META|CLOUDINARY|NEON|(?:^|_)S3(?:_|$)|STORAGE|PAYMENT|PUSH|WEBHOOK|OAUTH|TURNSTILE|NODE_OPTIONS|NODE_PATH|LD_PRELOAD|LD_LIBRARY_PATH|ENABLED|APPROVED|(?:^|_)MODE(?:_|$))/i.test(name))){
      throw configFailure("configuration_environment_sensitive_name",unexpectedNames);
    }
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
