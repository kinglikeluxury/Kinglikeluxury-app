import {isIP} from "node:net";
import {validateQaBootstrapIdentity} from "./qaBootstrapRules";
import {
  RAILWAY_QA_PUBLIC_TABLES,
  RAILWAY_QA_RUNTIME_TABLE_PRIVILEGES,
} from "./qaRailwayPreviewRules";

const baselineEnv=new Set([
  "PATH","HOME","TMPDIR","LANG","LC_ALL","TZ","NODE_ENV","PWD","SHLVL",
  "HOSTNAME","TERM",
]);
const provisionEnv=new Set([
  "KINGLIKE_VIP_QA_PROVISION_MODE","KINGLIKE_VIP_QA_PROVISION_APPROVED",
  "KINGLIKE_VIP_QA_PROVISION_EXECUTE",
  "KINGLIKE_VIP_QA_MIGRATION_DATABASE_URL","KINGLIKE_VIP_QA_PROVISION_HOST",
  "KINGLIKE_VIP_QA_PROVISION_DATABASE","KINGLIKE_VIP_QA_PROVISION_MIGRATOR_ROLE",
  "KINGLIKE_VIP_QA_PROVISION_RUNTIME_ROLE","KINGLIKE_VIP_QA_PROVISION_ADDRESS",
  "KINGLIKE_VIP_QA_PROVISION_ENVIRONMENT_ID",
  "KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD","KINGLIKE_VIP_QA_PROVISION_BUYER_PASSWORD",
  "KINGLIKE_VIP_QA_PROVISION_SELLER_PASSWORD","KINGLIKE_VIP_QA_PROVISION_FINANCE_PASSWORD",
  "VIP_QA_LOCAL_TEST","VIP_QA_EXPECTED_DATA_DIRECTORY","VIP_QA_EXPECTED_PORT",
]);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const qaRole=/^vipqa_[a-z0-9_]{2,32}$/;
const qaDatabase=/^vipqa_[a-z0-9_]{2,32}$/;

export type QaProvisionConfig=Readonly<{
  mode:"local-test"|"railway";
  connectionString:string;
  host:string;
  port:number;
  database:string;
  migratorRole:string;
  runtimeRole:string;
  serverAddress:string;
  environmentId:string;
  accountPasswords:Readonly<{admin:string;buyer:string;seller:string;finance:string}>;
}>;

function refuse():never{
  throw new Error("Synthetic VIP QA provisioning refused by isolation checks");
}
function required(env:Record<string,string|undefined>,name:string):string{
  const value=env[name];
  if(typeof value!=="string"||value.length===0)refuse();
  return value;
}
function privateAddress(value:string):boolean{
  if(isIP(value)!==4)return false;
  const [a,b]=value.split(".").map(Number);
  return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||
    (a===100&&b>=64&&b<=127);
}

export function validateQaProvisionConfig(
  env:Record<string,string|undefined>,
):QaProvisionConfig{
  if(Object.entries(env).some(([name,value])=>
    value!==undefined&&!baselineEnv.has(name)&&!provisionEnv.has(name))){
    return refuse();
  }
  if(required(env,"KINGLIKE_VIP_QA_PROVISION_APPROVED")!=="true")return refuse();
  const mode=required(env,"KINGLIKE_VIP_QA_PROVISION_MODE");
  if(mode!=="local-test"&&mode!=="railway")return refuse();
  const expectedHost=required(env,"KINGLIKE_VIP_QA_PROVISION_HOST").toLowerCase();
  const expectedDatabase=required(env,"KINGLIKE_VIP_QA_PROVISION_DATABASE");
  const migratorRole=required(env,"KINGLIKE_VIP_QA_PROVISION_MIGRATOR_ROLE");
  const runtimeRole=required(env,"KINGLIKE_VIP_QA_PROVISION_RUNTIME_ROLE");
  const serverAddress=required(env,"KINGLIKE_VIP_QA_PROVISION_ADDRESS");
  const environmentId=required(env,"KINGLIKE_VIP_QA_PROVISION_ENVIRONMENT_ID").toLowerCase();
  const raw=required(env,"KINGLIKE_VIP_QA_MIGRATION_DATABASE_URL");
  let url:URL;
  try{url=new URL(raw);}catch{return refuse();}
  let database:string,role:string;
  try{
    database=decodeURIComponent(url.pathname.replace(/^\/+/,""));
    role=decodeURIComponent(url.username);
  }catch{return refuse();}
  const port=url.port?Number(url.port):5432;
  const addressOk=mode==="local-test"
    ?isIP(serverAddress)===4&&serverAddress.startsWith("127.")
    :privateAddress(serverAddress);
  if(!["postgres:","postgresql:"].includes(url.protocol)||!url.password||
    url.search||url.hash||url.hostname.toLowerCase()!==expectedHost||
    database!==expectedDatabase||role!==migratorRole||port<1||port>65535||
    !qaDatabase.test(expectedDatabase)||!qaRole.test(migratorRole)||
    !qaRole.test(runtimeRole)||migratorRole===runtimeRole||
    !addressOk||!uuid.test(environmentId)){
    return refuse();
  }
  const passwords={
    admin:required(env,"KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD"),
    buyer:required(env,"KINGLIKE_VIP_QA_PROVISION_BUYER_PASSWORD"),
    seller:required(env,"KINGLIKE_VIP_QA_PROVISION_SELLER_PASSWORD"),
    finance:required(env,"KINGLIKE_VIP_QA_PROVISION_FINANCE_PASSWORD"),
  };
  const identities=[
    ["qa_preview_admin","qa_preview_admin@vipqa.test",passwords.admin],
    ["qa_preview_buyer","qa_preview_buyer@vipqa.test",passwords.buyer],
    ["qa_preview_seller","qa_preview_seller@vipqa.test",passwords.seller],
    ["qa_preview_finance","qa_preview_finance@vipqa.test",passwords.finance],
  ] as const;
  if(!validateQaBootstrapIdentity(...identities[0])||
    !validateQaBootstrapIdentity(...identities[1])||
    !validateQaBootstrapIdentity(...identities[2])||
    !validateQaBootstrapIdentity(...identities[3])){
    return refuse();
  }
  if(new Set(Object.values(passwords)).size!==4)return refuse();
  if(mode==="local-test"){
    const directory=required(env,"VIP_QA_EXPECTED_DATA_DIRECTORY");
    const expectedPort=Number(required(env,"VIP_QA_EXPECTED_PORT"));
    if(env.NODE_ENV!=="test"||env.VIP_QA_LOCAL_TEST!=="true"||
      !directory.startsWith("/tmp/kinglike-vip-pg-")||
      expectedHost!=="127.0.0.1"||port!==expectedPort||
      !Number.isInteger(expectedPort)||isIP(serverAddress)!==4||
      !serverAddress.startsWith("127.")){
      return refuse();
    }
  }else if(env.NODE_ENV!=="production"||
      !/^[a-z0-9.-]+\.railway\.internal$/.test(expectedHost)||port!==5432){
    return refuse();
  }
  return Object.freeze({
    mode,connectionString:raw,host:expectedHost,port,database, migratorRole,
    runtimeRole,serverAddress,environmentId,accountPasswords:Object.freeze(passwords),
  });
}

export function qaRuntimePrivilegesForTable(table:string):readonly string[]{
  if(!RAILWAY_QA_PUBLIC_TABLES.includes(table as (typeof RAILWAY_QA_PUBLIC_TABLES)[number])){
    return refuse();
  }
  return RAILWAY_QA_RUNTIME_TABLE_PRIVILEGES[table]??["SELECT","INSERT","UPDATE"];
}

export function quoteQaSqlIdentifier(value:string):string{
  if(!/^[a-z_][a-z0-9_]{0,62}$/.test(value))return refuse();
  return `"${value}"`;
}
