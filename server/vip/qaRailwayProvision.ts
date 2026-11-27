import bcrypt from "bcrypt";
import pg from "pg";
import {randomUUID} from "node:crypto";
import {resolve4} from "node:dns/promises";
import {assertTemporaryPostgresProcessIdentity} from "./qaLocalPostgresIdentity";
import {
  RAILWAY_QA_PUBLIC_TABLES,
  RAILWAY_QA_RUNTIME_TABLE_PRIVILEGES,
} from "./qaRailwayPreviewRules";
import {
  qaRuntimePrivilegesForTable,
  quoteQaSqlIdentifier,
  validateQaProvisionConfig,
  type QaProvisionConfig,
} from "./qaRailwayProvisionRules";

const {Pool}=pg;
const pdfFixture=Buffer.from("%PDF-1.4\n% Synthetic VIP QA receipt\n%%EOF\n","ascii");
const privilegeNames=["SELECT","INSERT","UPDATE","DELETE"] as const;

async function readTargetIdentity(client:pg.PoolClient){
  const result=await client.query<{
    database:string;role:string;database_owner:string;server_address:string|null;server_port:number;
  }>(
    "SELECT current_database() AS database,current_user AS role,"+
    "host(inet_server_addr()) AS server_address,inet_server_port() AS server_port,"+
    "(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) "+
    "AS database_owner",
  );
  return result.rows[0];
}

async function assertTargetIsEmptyAndDedicated(
  client:pg.PoolClient,
  config:QaProvisionConfig,
):Promise<void>{
  const identity=await readTargetIdentity(client);
  if(!identity||identity.database!==config.database||
    identity.role!==config.migratorRole||identity.database_owner!==config.migratorRole||
    identity.server_address!==config.serverAddress||Number(identity.server_port)!==config.port){
    throw new Error("target identity mismatch");
  }
  const migrator=await client.query<{
    superuser:boolean;createdb:boolean;createrole:boolean;replication:boolean;
    bypass_rls:boolean;member_of_any:boolean;
  }>(
    "SELECT r.rolsuper AS superuser,r.rolcreatedb AS createdb,"+
    "r.rolcreaterole AS createrole,r.rolreplication AS replication,"+
    "r.rolbypassrls AS bypass_rls,"+
    "EXISTS(SELECT 1 FROM pg_auth_members m "+
    "WHERE m.member=r.oid OR m.roleid=r.oid) AS member_of_any "+
    "FROM pg_roles r WHERE r.rolname=current_user",
  );
  const migratorRole=migrator.rows[0];
  if(!migratorRole||migratorRole.superuser||migratorRole.createdb||
    migratorRole.createrole||migratorRole.replication||migratorRole.bypass_rls||
    migratorRole.member_of_any){
    throw new Error("migration role has excessive authority");
  }
  const tables=await client.query<{table_name:string}>(
    "SELECT table_name FROM information_schema.tables "+
    "WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
  );
  if(tables.rows.length!==RAILWAY_QA_PUBLIC_TABLES.length||
    RAILWAY_QA_PUBLIC_TABLES.some(name=>!tables.rows.some(row=>row.table_name===name))){
    throw new Error("unexpected schema");
  }
  const objectSafety=await client.query<{safe:boolean}>(
    "SELECT "+
    "NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
    "WHERE n.nspname='public' AND c.relkind NOT IN ('r','p','S','i','I')) "+
    "AND NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid "+
    "JOIN pg_namespace n ON n.oid=c.relnamespace "+
    "WHERE n.nspname='public' AND NOT t.tgisinternal) "+
    "AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "+
    "WHERE n.nspname='public') AS safe",
  );
  if(objectSafety.rows[0]?.safe!==true)throw new Error("unexpected database object");
  for(const table of RAILWAY_QA_PUBLIC_TABLES){
    const count=await client.query<{has_rows:boolean}>(
      `SELECT EXISTS(SELECT 1 FROM public.${quoteQaSqlIdentifier(table)} LIMIT 1) AS has_rows`,
    );
    if(count.rows[0]?.has_rows!==false)throw new Error("database must be empty");
  }
  const role=await client.query<{
    can_login:boolean;superuser:boolean;createdb:boolean;createrole:boolean;
    replication:boolean;bypass_rls:boolean;member_of_any:boolean;
    owned_objects:number;can_create_public:boolean;
  }>(
    "SELECT r.rolcanlogin AS can_login,r.rolsuper AS superuser,"+
    "r.rolcreatedb AS createdb,r.rolcreaterole AS createrole,"+
    "r.rolreplication AS replication,r.rolbypassrls AS bypass_rls,"+
    "EXISTS(SELECT 1 FROM pg_auth_members m "+
    "WHERE m.member=r.oid OR m.roleid=r.oid) AS member_of_any,"+
    "(SELECT count(*)::int FROM pg_class c JOIN pg_namespace n "+
    "ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=r.oid) AS owned_objects,"+
    "has_schema_privilege(r.oid,'public','CREATE') AS can_create_public "+
    "FROM pg_roles r WHERE r.rolname=$1",
    [config.runtimeRole],
  );
  const runtime=role.rows[0];
  if(!runtime||!runtime.can_login||runtime.superuser||runtime.createdb||
    runtime.createrole||runtime.replication||runtime.bypass_rls||
    runtime.member_of_any||Number(runtime.owned_objects)!==0){
    throw new Error("runtime role is not least-privilege");
  }
}

async function applyRuntimeGrants(
  client:pg.PoolClient,
  config:QaProvisionConfig,
):Promise<void>{
  const role=quoteQaSqlIdentifier(config.runtimeRole);
  await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await client.query("REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC");
  await client.query("REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC");
  await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${role}`);
  await client.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${role}`);
  await client.query(`REVOKE CREATE ON SCHEMA public FROM ${role}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  for(const table of RAILWAY_QA_PUBLIC_TABLES){
    const privileges=qaRuntimePrivilegesForTable(table);
    await client.query(
      `GRANT ${privileges.join(",")} ON TABLE public.${quoteQaSqlIdentifier(table)} TO ${role}`,
    );
  }
  const sequences=await client.query<{schema_name:string;sequence_name:string}>(
    "SELECT sn.nspname AS schema_name,seq.relname AS sequence_name "+
    "FROM pg_class seq JOIN pg_namespace sn ON sn.oid=seq.relnamespace "+
    "JOIN pg_depend d ON d.objid=seq.oid AND d.deptype IN ('a','i') "+
    "JOIN pg_class tbl ON tbl.oid=d.refobjid "+
    "JOIN pg_namespace tn ON tn.oid=tbl.relnamespace "+
    "WHERE seq.relkind='S' AND sn.nspname='public' AND tn.nspname='public' "+
    "AND left(tbl.relname,4)='vip_' ORDER BY seq.relname",
  );
  if(sequences.rows.length<1)throw new Error("VIP identity sequences are missing");
  for(const sequence of sequences.rows){
    await client.query(
      `GRANT USAGE,SELECT ON SEQUENCE `+
      `${quoteQaSqlIdentifier(sequence.schema_name)}.${quoteQaSqlIdentifier(sequence.sequence_name)} TO ${role}`,
    );
  }
}

async function assertRuntimePrivileges(
  client:pg.PoolClient,
  config:QaProvisionConfig,
):Promise<void>{
  const tables=await client.query<{
    table_name:string;select:boolean;insert:boolean;update:boolean;delete:boolean;
    truncate:boolean;references:boolean;trigger:boolean;
  }>(
    "SELECT c.relname AS table_name,"+
      "has_table_privilege($1,c.oid,'SELECT') AS \"select\","+
      "has_table_privilege($1,c.oid,'INSERT') AS \"insert\","+
      "has_table_privilege($1,c.oid,'UPDATE') AS \"update\","+
      "has_table_privilege($1,c.oid,'DELETE') AS \"delete\","+
      "has_table_privilege($1,c.oid,'TRUNCATE') AS \"truncate\","+
      "has_table_privilege($1,c.oid,'REFERENCES') AS \"references\","+
      "has_table_privilege($1,c.oid,'TRIGGER') AS \"trigger\" "+
    "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
    "WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname",
    [config.runtimeRole],
  );
  if(tables.rows.length!==RAILWAY_QA_PUBLIC_TABLES.length)throw new Error("table grant shape mismatch");
  for(const row of tables.rows){
    const expected=qaRuntimePrivilegesForTable(row.table_name);
    const actual:Record<string,boolean>={
      SELECT:row.select,INSERT:row.insert,UPDATE:row.update,DELETE:row.delete,
    };
    if(expected.some(name=>actual[name]!==true)||
      privilegeNames.some(name=>!expected.includes(name)&&actual[name])||
      row.truncate||row.references||row.trigger){
      throw new Error("table grants exceed or miss the approved least-privilege plan");
    }
  }
  const sequences=await client.query<{
    sequence_name:string;owner_table_name:string;usage:boolean;select:boolean;update:boolean;
  }>(
    "SELECT seq.relname AS sequence_name,tbl.relname AS owner_table_name,"+
      "has_sequence_privilege($1,seq.oid,'USAGE') AS \"usage\","+
      "has_sequence_privilege($1,seq.oid,'SELECT') AS \"select\","+
      "has_sequence_privilege($1,seq.oid,'UPDATE') AS \"update\" "+
    "FROM pg_class seq JOIN pg_namespace sn ON sn.oid=seq.relnamespace "+
    "JOIN pg_depend d ON d.objid=seq.oid AND d.deptype IN ('a','i') "+
    "JOIN pg_class tbl ON tbl.oid=d.refobjid "+
    "JOIN pg_namespace tn ON tn.oid=tbl.relnamespace "+
    "WHERE seq.relkind='S' AND sn.nspname='public' AND tn.nspname='public' "+
    "ORDER BY seq.relname",
    [config.runtimeRole],
  );
  if(sequences.rows.length<1||sequences.rows.some(row=>{
    const expected=row.owner_table_name.startsWith("vip_");
    return !RAILWAY_QA_PUBLIC_TABLES.includes(
      row.owner_table_name as (typeof RAILWAY_QA_PUBLIC_TABLES)[number],
    )||row.usage!==expected||row.select!==expected||row.update;
  })){
    throw new Error("VIP sequence grants are incomplete or excessive");
  }
  const publicCreate=await client.query<{allowed:boolean}>(
    "SELECT has_schema_privilege($1,'public','CREATE') AS allowed",
    [config.runtimeRole],
  );
  if(publicCreate.rows[0]?.allowed!==false)throw new Error("runtime role can create in public");
}

async function seedSyntheticData(
  client:pg.PoolClient,
  config:QaProvisionConfig,
):Promise<void>{
  const passwords=config.accountPasswords;
  const users=[
    {username:"qa_preview_admin",email:"qa_preview_admin@vipqa.test",role:"admin",isAdmin:true,password:passwords.admin},
    {username:"qa_preview_buyer",email:"qa_preview_buyer@vipqa.test",role:"user",isAdmin:false,password:passwords.buyer},
    {username:"qa_preview_seller",email:"qa_preview_seller@vipqa.test",role:"sub_agent",isAdmin:false,password:passwords.seller},
    {username:"qa_preview_finance",email:"qa_preview_finance@vipqa.test",role:"finance",isAdmin:false,password:passwords.finance},
  ] as const;
  const ids:Record<typeof users[number]["username"],number>={
    qa_preview_admin:0,qa_preview_buyer:0,qa_preview_seller:0,qa_preview_finance:0,
  };
  for(const user of users){
    const hash=await bcrypt.hash(user.password,12);
    const result=await client.query<{id:number}>(
      "INSERT INTO public.users(username,email,password,is_verified,is_active,is_admin,role,auth_method) "+
      "VALUES($1,$2,$3,TRUE,TRUE,$4,$5,'email') RETURNING id",
      [user.username,user.email,hash,user.isAdmin,user.role],
    );
    ids[user.username]=Number(result.rows[0].id);
  }
  const project=await client.query<{id:string}>(
    "INSERT INTO public.vip_projects(name,developer_name) "+
    "VALUES('Synthetic QA Project','Synthetic QA Fixture') RETURNING id::text AS id",
  );
  const unit=await client.query<{id:string}>(
    "INSERT INTO public.vip_units(project_id,unit_number,floor_number) "+
    "VALUES($1,'QA-PORTAL-101',1) RETURNING id::text AS id",
    [project.rows[0].id],
  );
  await client.query(
    "INSERT INTO public.vip_unit_access(unit_id,user_id,access_role,granted_by) "+
    "VALUES($1,$2,'owner',$3),($1,$4,'seller',$3)",
    [unit.rows[0].id,ids.qa_preview_buyer,ids.qa_preview_admin,ids.qa_preview_seller],
  );
  await client.query(
    "INSERT INTO public.vip_finance_permissions(user_id,can_approve,granted_by) "+
    "VALUES($1,TRUE,$2)",
    [ids.qa_preview_finance,ids.qa_preview_admin],
  );
  await client.query(
    "INSERT INTO public.vip_audit_events(actor_user_id,event_type,metadata) "+
    "VALUES($1,'finance_permission_granted',$2::jsonb)",
    [ids.qa_preview_admin,JSON.stringify({userId:ids.qa_preview_finance,synthetic:true})],
  );
  const installment=await client.query<{id:string}>(
    "INSERT INTO public.vip_installments(unit_id,sequence_number,due_date,amount,currency) "+
    "VALUES($1,1,CURRENT_DATE+30,1000.00,'USD') RETURNING id::text AS id",
    [unit.rows[0].id],
  );
  const objectKey=`kinglike-vip/receipts/${randomUUID()}.pdf`;
  await client.query(
    "INSERT INTO public.vip_qa_file_objects(object_key,content_type,size_bytes,object_bytes) "+
    "VALUES($1,'application/pdf',$2,$3)",
    [objectKey,pdfFixture.length,pdfFixture],
  );
  await client.query(
    "INSERT INTO public.vip_receipts(installment_id,object_path,file_name,mime_type,size_bytes,"+
    "uploaded_by,upload_source,review_status) VALUES($1,$2,'synthetic-qa-receipt.pdf',"+
    "'application/pdf',$3,$4,'client','pending')",
    [installment.rows[0].id,objectKey,pdfFixture.length,ids.qa_preview_buyer],
  );
  await client.query(
    "INSERT INTO public.vip_qa_environment_identity(singleton,environment_id,classification) "+
    "VALUES(TRUE,$1,'synthetic-only')",
    [config.environmentId],
  );
  const paid=await client.query<{count:number}>(
    "SELECT count(*)::int AS count FROM public.vip_payment_postings",
  );
  if(Number(paid.rows[0]?.count)!==0)throw new Error("receipt seed must not post a payment");
}

export async function provisionSyntheticVipQaDatabase(
  config:QaProvisionConfig,
):Promise<void>{
  if(config.mode==="local-test"){
    const env=process.env;
    assertTemporaryPostgresProcessIdentity(
      env.VIP_QA_EXPECTED_DATA_DIRECTORY,
      Number(env.VIP_QA_EXPECTED_PORT),
    );
  }else{
    const addresses=await resolve4(config.host);
    if(addresses.length!==1||addresses[0]!==config.serverAddress){
      throw new Error("private QA database DNS identity mismatch");
    }
  }
  const pool=new Pool({
    connectionString:config.connectionString,max:1,connectionTimeoutMillis:5000,
    idleTimeoutMillis:5000,query_timeout:10000,application_name:"kinglike_vip_qa_provision",
  });
  let client:pg.PoolClient|undefined;
  try{
    client=await pool.connect();
    await assertTargetIsEmptyAndDedicated(client,config);
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(487921035)");
    await assertTargetIsEmptyAndDedicated(client,config);
    await applyRuntimeGrants(client,config);
    await seedSyntheticData(client,config);
    await assertRuntimePrivileges(client,config);
    await client.query("COMMIT");
  }catch(error){
    await client?.query("ROLLBACK").catch(()=>{});
    throw error;
  }finally{
    client?.release();
    await pool.end();
  }
}

if(process.env.KINGLIKE_VIP_QA_PROVISION_EXECUTE==="true"){
  void (async()=>{
    try{
      const config=validateQaProvisionConfig(process.env);
      await provisionSyntheticVipQaDatabase(config);
      process.stdout.write("synthetic_qa_provision=complete accounts=4 receipt=pending payment_postings=0 grants=verified\n");
    }catch{
      process.stderr.write("synthetic_qa_provision=refused_or_failed; no credential values logged\n");
      process.exitCode=1;
    }
  })();
}
