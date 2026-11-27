import {readFileSync} from "node:fs";
import {resolve4} from "node:dns/promises";
import pg from "pg";
import {quoteQaSqlIdentifier} from "./qaRailwayProvisionRules";
import {
  isPrivateRailwayBootstrapIpv4,
  validateRailwayBootstrapEnvironment,
} from "./qaRailwayBootstrapRules";

const {Pool}=pg;
const runtimeEnvNames=new Set([
  "PATH","HOME","TMPDIR","LANG","LC_ALL","TZ","NODE_ENV","PORT","PWD","SHLVL",
  "HOSTNAME","TERM","KINGLIKE_VIP_QA_PREVIEW","KINGLIKE_VIP_ENABLED",
  "VITE_KINGLIKE_VIP_ENABLED","KINGLIKE_VIP_EMAIL_ENABLED",
  "KINGLIKE_VIP_EMAIL_LIVE_APPROVED","KINGLIKE_VIP_QA_DATABASE_URL",
  "KINGLIKE_VIP_QA_EXPECTED_DB_HOST","KINGLIKE_VIP_QA_EXPECTED_DB_NAME",
  "KINGLIKE_VIP_QA_EXPECTED_DB_ROLE","KINGLIKE_VIP_QA_EXPECTED_DB_ADDRESS",
  "KINGLIKE_VIP_QA_ENVIRONMENT_ID","KINGLIKE_VIP_QA_GATE_USER",
  "KINGLIKE_VIP_QA_GATE_PASSWORD","KINGLIKE_VIP_QA_SESSION_SECRET",
  "KINGLIKE_VIP_QA_STATIC_DIR","KINGLIKE_VIP_QA_RUNTIME","KINGLIKE_VIP_QA_START",
]);

function quoteLiteral(value:string):string{
  if(value.includes("\0"))throw new Error("Invalid QA credential encoding");
  return `'${value.replace(/'/g,"''")}'`;
}

function privateHost(value:string):boolean{
  return /^[a-z0-9.-]+\.railway\.internal$/i.test(value);
}

function stripTransaction(source:string):string{
  const stripped=source
    .replace(/^(?:\s*--[^\n]*\n)*\s*BEGIN;\s*/i,"")
    .replace(/\s*COMMIT;\s*$/i,"");
  if(stripped===source||!stripped.trim()||/\n\s*COMMIT;\s*\n/i.test(stripped)){
    throw new Error("QA bootstrap migration transaction boundaries are invalid");
  }
  return stripped;
}

async function pinnedAddress(host:string):Promise<string>{
  const addresses=await resolve4(host);
  if(addresses.length!==1||!isPrivateRailwayBootstrapIpv4(addresses[0])){
    throw new Error("Railway QA database DNS identity is not a single private IPv4");
  }
  return addresses[0];
}

async function verifyRuntimeDatabase():Promise<void>{
  for(const name of Object.keys(process.env)){
    if(!runtimeEnvNames.has(name)&&!/^RAILWAY_[A-Z0-9_]+$/.test(name)){
      delete process.env[name];
    }
  }
  process.env.KINGLIKE_VIP_QA_RUNTIME="railway";
  process.env.KINGLIKE_VIP_QA_START="true";
  const {assertQaRailwayDatabaseIdentity,pool}=await import("./qaRailwayPreviewDb");
  try{
    await assertQaRailwayDatabaseIdentity();
  }finally{
    await pool.end();
  }
}

async function applyMigrations(
  connectionString:string,
  expected:{
    host:string;database:string;role:string;address:string;
  },
):Promise<void>{
  const migrationPool=new Pool({
    connectionString,max:1,connectionTimeoutMillis:5000,
    idleTimeoutMillis:5000,query_timeout:10000,
    application_name:"kinglike_vip_qa_migrate",
  });
  let client:pg.PoolClient|undefined;
  try{
    client=await migrationPool.connect();
    const identity=await client.query<{
      database:string;role:string;database_owner:string;server_address:string|null;
      server_port:number;superuser:boolean;createdb:boolean;createrole:boolean;
      replication:boolean;bypass_rls:boolean;member_of_any:boolean;
    }>(
      "SELECT current_database() AS database,current_user AS role,"+
      "host(inet_server_addr()) AS server_address,inet_server_port() AS server_port,"+
      "(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) "+
      "AS database_owner,r.rolsuper AS superuser,r.rolcreatedb AS createdb,"+
      "r.rolcreaterole AS createrole,r.rolreplication AS replication,"+
      "r.rolbypassrls AS bypass_rls,"+
      "EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid) "+
      "AS member_of_any FROM pg_roles r WHERE r.rolname=current_user",
    );
    const row=identity.rows[0];
    if(!row||row.database!==expected.database||row.role!==expected.role||
      row.database_owner!==expected.role||row.server_address!==expected.address||
      Number(row.server_port)!==5432||row.superuser||row.createdb||row.createrole||
      row.replication||row.bypass_rls||row.member_of_any){
      throw new Error("QA migration connection identity or privileges are invalid");
    }
    await client.query("BEGIN");
    try{
      await client.query("SELECT pg_advisory_xact_lock(81128731)");
      const existing=await client.query(
        "SELECT table_name FROM information_schema.tables "+
        "WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
      );
      if(existing.rowCount!==0)throw new Error("QA migration database is not empty");
      for(const migration of [
        "000_qa_users_only.sql",
        "001_vip_foundation.sql",
        "003_qa_sessions.sql",
        "002_railway_qa_identity.sql",
      ]){
        const source=readFileSync(
          `server/vip/migrations/${migration}`,"utf8",
        );
        await client.query(stripTransaction(source));
      }
      const ready=await client.query(
        "SELECT to_regclass('public.users') AS users,"+
        "to_regclass('public.vip_qa_sessions') AS sessions,"+
        "to_regclass('public.vip_qa_environment_identity') AS marker,"+
        "to_regclass('public.vip_qa_file_objects') AS files",
      );
      if(!ready.rows[0]?.users||!ready.rows[0]?.sessions||
        !ready.rows[0]?.marker||!ready.rows[0]?.files){
        throw new Error("QA migration schema verification failed");
      }
      await client.query("COMMIT");
    }catch(error){
      await client.query("ROLLBACK").catch(()=>{});
      throw error;
    }
  }finally{
    client?.release();
    await migrationPool.end();
  }
}

async function bootstrap():Promise<void>{
  const config=validateRailwayBootstrapEnvironment(process.env);
  if(!privateHost(config.host))throw new Error("QA database host is not private");
  const address=await pinnedAddress(config.host);
  const adminUrl=new URL(config.adminDatabaseUrl);
  if(!adminUrl.port)adminUrl.port="5432";
  const adminPool=new Pool({
    connectionString:adminUrl.toString(),max:1,
    connectionTimeoutMillis:5000,idleTimeoutMillis:5000,
    query_timeout:10000,application_name:"kinglike_vip_qa_bootstrap",
  });
  let client:pg.PoolClient|undefined;
  let createdDatabase=false;
  try{
    client=await adminPool.connect();
    const identity=await client.query<{
      database:string;role:string;server_address:string|null;server_port:number;
      superuser:boolean;createdb:boolean;createrole:boolean;member_of_any:boolean;
    }>(
      "SELECT current_database() AS database,current_user AS role,"+
      "host(inet_server_addr()) AS server_address,inet_server_port() AS server_port,"+
      "r.rolsuper AS superuser,r.rolcreatedb AS createdb,r.rolcreaterole AS createrole,"+
      "EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid) "+
      "AS member_of_any FROM pg_roles r WHERE r.rolname=current_user",
    );
    const row=identity.rows[0];
    if(!row||!row.role||row.role!==decodeURIComponent(adminUrl.username)||
      row.database===config.database||row.server_address!==address||
      Number(row.server_port)!==5432||!row.superuser||!row.createdb||
      !row.createrole){
      throw new Error("QA bootstrap admin identity lacks the isolated setup authority");
    }
    const state=await client.query<{
      target_database_exists:boolean;migrator_exists:boolean;runtime_exists:boolean;
    }>(
      "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) "+
      "AS target_database_exists,"+
      "EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$2) AS migrator_exists,"+
      "EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$3) AS runtime_exists",
      [config.database,config.migratorRole,config.runtimeRole],
    );
    const current=state.rows[0];
    if(!current)throw new Error("QA bootstrap state could not be read");
    if(current.target_database_exists){
      client.release();
      client=undefined;
      await adminPool.end();
      await verifyRuntimeDatabase();
      process.stdout.write("synthetic_vip_qa_database=already_verified\n");
      return;
    }
    if(current.migrator_exists||current.runtime_exists){
      throw new Error("QA bootstrap found partial role state; refusing recovery");
    }

    const migrator=quoteQaSqlIdentifier(config.migratorRole);
    const runtime=quoteQaSqlIdentifier(config.runtimeRole);
    await client.query(
      `CREATE ROLE ${migrator} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE `+
      `NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD ${quoteLiteral(config.migratorPassword)}`,
    );
    await client.query(
      `CREATE ROLE ${runtime} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE `+
      `NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD ${quoteLiteral(
        decodeURIComponent(new URL(config.runtimeDatabaseUrl).password),
      )}`,
    );
    await client.query(
      `CREATE DATABASE ${quoteQaSqlIdentifier(config.database)} `+
      `OWNER ${migrator} TEMPLATE template0 ENCODING 'UTF8'`,
    );
    createdDatabase=true;
    await client.query(
      `REVOKE CONNECT ON DATABASE ${quoteQaSqlIdentifier(config.database)} FROM PUBLIC`,
    );
    await client.query(
      `GRANT CONNECT ON DATABASE ${quoteQaSqlIdentifier(config.database)} TO ${migrator},${runtime}`,
    );
  }finally{
    client?.release();
    await adminPool.end().catch(()=>{});
  }

  if(!createdDatabase)throw new Error("QA database bootstrap did not create its target");
  const migratorUrl=new URL(config.adminDatabaseUrl);
  migratorUrl.username=config.migratorRole;
  migratorUrl.password=config.migratorPassword;
  migratorUrl.pathname=`/${config.database}`;
  migratorUrl.search="";
  migratorUrl.hash="";
  migratorUrl.port="5432";
  await applyMigrations(migratorUrl.toString(),{
    host:config.host,database:config.database,role:config.migratorRole,address,
  });

  const {validateQaProvisionConfig}=await import("./qaRailwayProvisionRules");
  const {provisionSyntheticVipQaDatabase}=await import("./qaRailwayProvision");
  const provisionConfig=validateQaProvisionConfig({
    NODE_ENV:"production",
    KINGLIKE_VIP_QA_PROVISION_MODE:"railway",
    KINGLIKE_VIP_QA_PROVISION_APPROVED:"true",
    KINGLIKE_VIP_QA_MIGRATION_DATABASE_URL:migratorUrl.toString(),
    KINGLIKE_VIP_QA_PROVISION_HOST:config.host,
    KINGLIKE_VIP_QA_PROVISION_DATABASE:config.database,
    KINGLIKE_VIP_QA_PROVISION_MIGRATOR_ROLE:config.migratorRole,
    KINGLIKE_VIP_QA_PROVISION_RUNTIME_ROLE:config.runtimeRole,
    KINGLIKE_VIP_QA_PROVISION_ADDRESS:address,
    KINGLIKE_VIP_QA_PROVISION_ENVIRONMENT_ID:config.expectedEnvironmentId,
    KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD:config.accountPasswords.admin,
    KINGLIKE_VIP_QA_PROVISION_BUYER_PASSWORD:config.accountPasswords.buyer,
    KINGLIKE_VIP_QA_PROVISION_SELLER_PASSWORD:config.accountPasswords.seller,
    KINGLIKE_VIP_QA_PROVISION_FINANCE_PASSWORD:config.accountPasswords.finance,
  });
  await provisionSyntheticVipQaDatabase(provisionConfig);
  await verifyRuntimeDatabase();
  process.stdout.write(
    "synthetic_vip_qa_database=initialized accounts=4 receipt=pending payment_postings=0 grants=verified\n",
  );
}

if(process.env.KINGLIKE_VIP_QA_BOOTSTRAP_EXECUTE==="true"){
  bootstrap().catch(()=>{
    process.stderr.write("synthetic_vip_qa_database=refused_or_failed; no credentials logged\n");
    process.exitCode=1;
  });
}
