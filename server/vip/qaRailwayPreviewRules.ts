import {isIP} from "node:net";

const runtimeEnvAllowlist=new Set([
  "PATH","HOME","TMPDIR","LANG","LC_ALL","TZ","NODE_ENV","PORT","PWD","SHLVL",
  "HOSTNAME","TERM",
  "KINGLIKE_VIP_QA_RUNTIME","KINGLIKE_VIP_QA_START","KINGLIKE_VIP_QA_PREVIEW",
  "KINGLIKE_VIP_ENABLED","KINGLIKE_VIP_QA_DATABASE_URL",
  "KINGLIKE_VIP_QA_EXPECTED_DB_HOST","KINGLIKE_VIP_QA_EXPECTED_DB_NAME",
  "KINGLIKE_VIP_QA_EXPECTED_DB_ROLE","KINGLIKE_VIP_QA_EXPECTED_DB_ADDRESS",
  "KINGLIKE_VIP_QA_ENVIRONMENT_ID","KINGLIKE_VIP_QA_GATE_USER",
  "KINGLIKE_VIP_QA_GATE_PASSWORD","KINGLIKE_VIP_QA_SESSION_SECRET",
  "KINGLIKE_VIP_QA_STATIC_DIR",
  "KINGLIKE_VIP_EMAIL_ENABLED",
  "KINGLIKE_VIP_EMAIL_LIVE_APPROVED",
  "VITE_KINGLIKE_VIP_ENABLED",
]);

export const RAILWAY_QA_PUBLIC_TABLES=Object.freeze([
  "users",
  "vip_projects","vip_units","vip_unit_access","vip_progress_updates",
  "vip_installments","vip_receipts","vip_payment_postings","vip_finance_permissions",
  "vip_private_documents","vip_statement_requests","vip_invitations",
  "vip_project_photos","vip_project_cameras","vip_handover",
  "vip_handover_key_receipts","vip_handover_appointments","vip_handover_snags",
  "vip_member_cards","vip_referrals","vip_referral_links","vip_referral_rewards",
  "vip_notifications","vip_notification_preferences","vip_journey_milestones",
  "vip_benefits","vip_service_requests","vip_financial_adjustments",
  "vip_support_tickets","vip_support_messages","vip_exchange_rates",
  "vip_internal_commissions","vip_crm_sale_links","vip_audit_events",
  "vip_qa_environment_identity","vip_qa_file_objects","vip_qa_sessions",
]);
const expectedPublicTables=new Set(RAILWAY_QA_PUBLIC_TABLES);

export const RAILWAY_QA_RUNTIME_TABLE_PRIVILEGES:
Readonly<Record<string,readonly string[]>>=Object.freeze({
  users:["SELECT"],
  vip_qa_environment_identity:["SELECT"],
  vip_qa_sessions:["SELECT","INSERT","UPDATE","DELETE"],
  vip_qa_file_objects:["SELECT","INSERT","DELETE"],
  vip_audit_events:["SELECT","INSERT"],
  vip_payment_postings:["SELECT","INSERT"],
  vip_finance_permissions:["SELECT","INSERT","UPDATE"],
});
const mutableVipDml=new Set(["SELECT","INSERT","UPDATE"]);

export type RailwayQaDatabaseConfig=Readonly<{
  connectionString:string;
  host:string;
  port:number;
  database:string;
  role:string;
  serverAddress:string;
  environmentId:string;
}>;

export type RailwayQaDatabaseSnapshot=Readonly<{
  database:string;
  role:string;
  databaseOwner:string;
  serverAddress:string;
  serverPort:number;
  hasPrivilegedRoleMembership:boolean;
  canCreateInPublicSchema:boolean;
  ownedPublicObjectCount:number;
  roleIsSuperuser:boolean;
  roleCanCreateDatabase:boolean;
  roleCanCreateRole:boolean;
  roleCanReplicate:boolean;
  roleCanBypassRls:boolean;
  environmentRows:ReadonlyArray<{environmentId:string;classification:string}>;
  publicTables:ReadonlyArray<string>;
  publicObjectsWithinAllowlist:boolean;
  users:ReadonlyArray<{
    id:number;username:string;email:string|null;role:string;
    isAdmin:boolean;isActive:boolean;isVerified:boolean;
  }>;
  unitAccess:ReadonlyArray<{
    userId:number;accessRole:string;unitNumber:string;revoked:boolean;
  }>;
  financeReviewers:ReadonlyArray<{
    userId:number;username:string;role:string;canApprove:boolean;
  }>;
  tablePrivileges:ReadonlyArray<{
    tableName:string;select:boolean;insert:boolean;update:boolean;delete:boolean;
    truncate:boolean;references:boolean;trigger:boolean;
  }>;
  sequencePrivileges:ReadonlyArray<{
    sequenceName:string;ownerTableName:string;usage:boolean;select:boolean;update:boolean;
  }>;
  projectNames:ReadonlyArray<string>;
  unitNumbers:ReadonlyArray<string>;
  receipts:ReadonlyArray<{fileName:string;uploadedBy:number;uploaderUsername:string|null}>;
  fileObjects:ReadonlyArray<{objectKey:string;contentType:string;sizeBytes:number}>;
  receiptObjectsAvailable:boolean;
  receiptSourcesAreInternal:boolean;
  fileObjectsConsistent:boolean;
  sessionStoreReady:boolean;
  pendingReceiptCount:number;
  pendingReceiptsUnposted:boolean;
}>;

function fail():never{
  throw new Error("Railway VIP QA configuration or database identity refused");
}

function required(env:Record<string,string|undefined>,name:string):string{
  const value=env[name];
  if(typeof value!=="string"||!value)fail();
  return value;
}

function isUuid(value:string):boolean{
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isValidExpectedAddress(value:string):boolean{
  if(isIP(value)!==4)return false;
  const octets=value.split(".").map(Number);
  return octets[0]===10||
    (octets[0]===172&&octets[1]>=16&&octets[1]<=31)||
    (octets[0]===192&&octets[1]===168)||
    (octets[0]===100&&octets[1]>=64&&octets[1]<=127);
}

export function validateRailwayQaDatabaseConfig(
  env:Record<string,string|undefined>,
):RailwayQaDatabaseConfig{
  const raw=required(env,"KINGLIKE_VIP_QA_DATABASE_URL");
  const expectedHost=required(env,"KINGLIKE_VIP_QA_EXPECTED_DB_HOST").toLowerCase();
  const expectedDatabase=required(env,"KINGLIKE_VIP_QA_EXPECTED_DB_NAME");
  const expectedRole=required(env,"KINGLIKE_VIP_QA_EXPECTED_DB_ROLE");
  const serverAddress=required(env,"KINGLIKE_VIP_QA_EXPECTED_DB_ADDRESS");
  const environmentId=required(env,"KINGLIKE_VIP_QA_ENVIRONMENT_ID").toLowerCase();
  let parsed:URL;
  try{parsed=new URL(raw);}catch{return fail();}
  let database:string,role:string;
  try{
    database=decodeURIComponent(parsed.pathname.replace(/^\/+/,""));
    role=decodeURIComponent(parsed.username);
  }catch{return fail();}
  const port=parsed.port?Number(parsed.port):5432;
  if(!["postgres:","postgresql:"].includes(parsed.protocol)||
    !parsed.password||parsed.search||parsed.hash||
    parsed.hostname.toLowerCase()!==expectedHost||
    !/^[a-z0-9.-]+\.railway\.internal$/i.test(expectedHost)||
    !/^vipqa_[a-z0-9_]{2,32}$/.test(expectedDatabase)||
    database!==expectedDatabase||!/^vipqa_[a-z0-9_]{2,32}$/.test(expectedRole)||
    role!==expectedRole||port!==5432||!isValidExpectedAddress(serverAddress)||
    !isUuid(environmentId)){
    return fail();
  }
  return Object.freeze({
    connectionString:raw,host:expectedHost,port,database,role,serverAddress,environmentId,
  });
}

export function assertRailwayQaPreviewEnvironment(
  env:Record<string,string|undefined>=process.env,
):RailwayQaDatabaseConfig{
  if(Object.keys(env).some(name=>!runtimeEnvAllowlist.has(name)&&
    !/^RAILWAY_[A-Z0-9_]+$/.test(name)))fail();
  if(env.NODE_ENV!=="production"||env.KINGLIKE_VIP_QA_RUNTIME!=="railway"||
    env.KINGLIKE_VIP_QA_START!=="true"||env.KINGLIKE_VIP_QA_PREVIEW!=="true"||
    env.KINGLIKE_VIP_ENABLED!=="true"||
    (env.KINGLIKE_VIP_EMAIL_ENABLED!==undefined&&env.KINGLIKE_VIP_EMAIL_ENABLED!=="false")||
    (env.KINGLIKE_VIP_EMAIL_LIVE_APPROVED!==undefined&&env.KINGLIKE_VIP_EMAIL_LIVE_APPROVED!=="false")||
    (env.VITE_KINGLIKE_VIP_ENABLED!==undefined&&env.VITE_KINGLIKE_VIP_ENABLED!=="true")||
    !/^\d+$/.test(env.PORT||"")||Number(env.PORT)<1||Number(env.PORT)>65535||
    (env.KINGLIKE_VIP_QA_GATE_USER||"").length<4||
    (env.KINGLIKE_VIP_QA_GATE_PASSWORD||"").length<20||
    (env.KINGLIKE_VIP_QA_SESSION_SECRET||"").length<48){
    return fail();
  }
  const staticDir=env.KINGLIKE_VIP_QA_STATIC_DIR;
  if(staticDir!==undefined&&staticDir!==".local/qa-vip-railway-build/public")return fail();
  return validateRailwayQaDatabaseConfig(env);
}

export function verifySyntheticRailwayQaSnapshot(
  config:RailwayQaDatabaseConfig,
  snapshot:RailwayQaDatabaseSnapshot,
):void{
  if(snapshot.database!==config.database||snapshot.role!==config.role||
    snapshot.databaseOwner===snapshot.role||snapshot.canCreateInPublicSchema||
    snapshot.hasPrivilegedRoleMembership||
    snapshot.ownedPublicObjectCount!==0||
    snapshot.serverAddress!==config.serverAddress||snapshot.serverPort!==config.port||
    snapshot.roleIsSuperuser||snapshot.roleCanCreateDatabase||
    snapshot.roleCanCreateRole||snapshot.roleCanReplicate||snapshot.roleCanBypassRls){
    fail();
  }
  if(snapshot.environmentRows.length!==1||
    snapshot.environmentRows[0].environmentId.toLowerCase()!==config.environmentId||
    snapshot.environmentRows[0].classification!=="synthetic-only"){
    fail();
  }
  const tables=new Set(snapshot.publicTables);
  let missingExpectedTable=false;
  expectedPublicTables.forEach(table=>{if(!tables.has(table))missingExpectedTable=true;});
  if(tables.size!==expectedPublicTables.size||
    missingExpectedTable||
    snapshot.publicTables.some(table=>!expectedPublicTables.has(table))){
    fail();
  }
  if(!snapshot.publicObjectsWithinAllowlist)fail();
  if(snapshot.users.length<4||snapshot.users.some(user=>
    !Number.isSafeInteger(user.id)||
    !/^qa_[a-z0-9_]{4,36}$/.test(user.username)||
    typeof user.email!=="string"||
    !/^qa_[a-z0-9._+-]{4,70}@[a-z0-9.-]+\.test$/i.test(user.email)||
    !user.isActive||!user.isVerified)){
    fail();
  }
  const admin=snapshot.users.some(user=>user.isAdmin&&user.role==="admin");
  const buyer=snapshot.users.some(user=>!user.isAdmin&&user.role==="user");
  const seller=snapshot.users.some(user=>!user.isAdmin&&user.role==="sub_agent");
  const finance=snapshot.financeReviewers.some(user=>
    (user.role==="finance"||user.role==="crm_employee")&&
    snapshot.users.some(account=>account.id===user.userId&&account.isActive&&account.isVerified));
  if(!admin||!buyer||!seller||!finance||
    !snapshot.unitAccess.some(access=>access.accessRole==="owner"&&
      snapshot.users.some(user=>user.id===access.userId&&user.role==="user"))||
    !snapshot.unitAccess.some(access=>access.accessRole==="seller"&&
      snapshot.users.some(user=>user.id===access.userId&&user.role==="sub_agent"))){
    fail();
  }
  if(snapshot.projectNames.length<1||snapshot.unitNumbers.length<1||snapshot.receipts.length<1||
    snapshot.projectNames.some(name=>!/^Synthetic QA\b|^Isolated Preview Test\b/.test(name))||
    snapshot.unitNumbers.some(number=>!/^QA-[A-Za-z0-9_-]+$/.test(number))||
    snapshot.receipts.some(receipt=>
      !/^synthetic-[A-Za-z0-9._-]{1,180}$/i.test(receipt.fileName)||
      !Number.isSafeInteger(receipt.uploadedBy)||
      !snapshot.users.some(user=>user.id===receipt.uploadedBy&&user.username===receipt.uploaderUsername))){
    fail();
  }
  if(!Number.isSafeInteger(snapshot.pendingReceiptCount)||snapshot.pendingReceiptCount<0||
    !snapshot.pendingReceiptsUnposted||
    snapshot.tablePrivileges.length!==RAILWAY_QA_PUBLIC_TABLES.length||
    snapshot.sequencePrivileges.length<1){
    fail();
  }
  for(const privilege of snapshot.tablePrivileges){
    const expected=RAILWAY_QA_RUNTIME_TABLE_PRIVILEGES[privilege.tableName]||
      Array.from(mutableVipDml);
    const actual:Record<string,boolean>={
      SELECT:privilege.select,INSERT:privilege.insert,
      UPDATE:privilege.update,DELETE:privilege.delete,
    };
    if(!expectedPublicTables.has(privilege.tableName)||
      expected.some(name=>actual[name]!==true)||
      Object.keys(actual).some(name=>!expected.includes(name)&&actual[name])||
      privilege.truncate||privilege.references||privilege.trigger){
      fail();
    }
  }
  if(RAILWAY_QA_PUBLIC_TABLES.some(table=>
    !snapshot.tablePrivileges.some(privilege=>privilege.tableName===table))||
    snapshot.sequencePrivileges.some(privilege=>{
      if(!expectedPublicTables.has(privilege.ownerTableName))return true;
      const shouldGrant=privilege.ownerTableName.startsWith("vip_");
      return privilege.usage!==shouldGrant||privilege.select!==shouldGrant||privilege.update;
    })){
    fail();
  }
  if(!snapshot.receiptObjectsAvailable||!snapshot.receiptSourcesAreInternal||
    !snapshot.fileObjectsConsistent||!snapshot.sessionStoreReady||
    snapshot.fileObjects.some(file=>{
      const keyOk=/^kinglike-vip\/receipts\/[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(file.objectKey)||
        /^kinglike-vip\/project-photos\/[1-9]\d*\/[0-9a-f-]{36}\.(jpg|png)$/.test(file.objectKey)||
        /^kinglike-vip\/official-statements\/[0-9a-f-]{36}\.pdf$/.test(file.objectKey);
      const expectedMime=file.objectKey.endsWith(".pdf")?"application/pdf":
        file.objectKey.endsWith(".jpg")?"image/jpeg":"image/png";
      return !keyOk||file.contentType!==expectedMime||
        !Number.isSafeInteger(file.sizeBytes)||file.sizeBytes<1||file.sizeBytes>10485760;
    })){
    fail();
  }
}

export function isMinimalQaHealthProbe(method:string,path:string):boolean{
  return method==="GET"&&path==="/health";
}

export function isAllowedRailwayQaDatabaseTarget(
  host:unknown,
  port:unknown,
  config:Pick<RailwayQaDatabaseConfig,"host"|"port">,
):boolean{
  return typeof host==="string"&&host.toLowerCase()===config.host&&
    Number(port)===config.port;
}
