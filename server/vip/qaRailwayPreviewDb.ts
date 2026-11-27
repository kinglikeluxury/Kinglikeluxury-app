import pg from "pg";
import dns from "node:dns";
import {
  validateRailwayQaDatabaseConfig,
  verifySyntheticRailwayQaSnapshot,
  type RailwayQaDatabaseConfig,
} from "./qaRailwayPreviewRules";

const {Pool}=pg;
const config:RailwayQaDatabaseConfig=validateRailwayQaDatabaseConfig(process.env);

export const pool=new Pool({
  connectionString:config.connectionString,
  max:3,
  connectionTimeoutMillis:5000,
  idleTimeoutMillis:5000,
  query_timeout:10000,
  application_name:"kinglike_vip_synthetic_qa",
});

export async function assertQaRailwayDatabaseIdentity():Promise<void>{
  try{
    const resolvedDatabase=await dns.promises.lookup(config.host,{family:4});
    const expectedAddress=config.serverAddress==="auto"
      ?resolvedDatabase.address:config.serverAddress;
    const identity=await pool.query<{
      database:string;role:string;database_owner:string;
      server_address:string|null;server_port:number;
      has_privileged_role_membership:boolean;
      can_create_in_public_schema:boolean;owned_public_object_count:number;
      role_is_superuser:boolean;role_can_create_database:boolean;
      role_can_create_role:boolean;role_can_replicate:boolean;role_can_bypass_rls:boolean;
      session_store_ready:boolean;
    }>(
      "SELECT current_database() AS database,current_user AS role,"+
      "host(inet_server_addr()) AS server_address,inet_server_port() AS server_port,"+
      "(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) "+
      "AS database_owner,"+
      "EXISTS(SELECT 1 FROM pg_roles target "+
      "WHERE target.rolname<>current_user AND pg_has_role(current_user,target.oid,'MEMBER') "+
      "AND (target.rolname !~ '^vipqa_[a-z0-9_]{2,32}$' OR "+
      "target.rolsuper OR target.rolcreatedb OR target.rolcreaterole OR "+
      "target.rolreplication OR target.rolbypassrls OR "+
      "target.rolname IN ('pg_read_all_data','pg_write_all_data','pg_read_server_files',"+
      "'pg_write_server_files','pg_execute_server_program','pg_monitor','pg_signal_backend') OR "+
      "target.oid=(SELECT datdba FROM pg_database WHERE datname=current_database()) OR "+
      "target.oid=(SELECT nspowner FROM pg_namespace WHERE nspname='public') OR "+
      "target.oid IN (SELECT relowner FROM pg_class c JOIN pg_namespace n "+
      "ON n.oid=c.relnamespace WHERE n.nspname='public'))) "+
      "AS has_privileged_role_membership,"+
      "has_schema_privilege(current_user,'public','CREATE') AS can_create_in_public_schema,"+
      "(SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
      "WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f') "+
      "AND pg_get_userbyid(c.relowner)=current_user) AS owned_public_object_count,"+
      "(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS role_is_superuser,"+
      "(SELECT rolcreatedb FROM pg_roles WHERE rolname=current_user) AS role_can_create_database,"+
      "(SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) AS role_can_create_role,"+
      "(SELECT rolreplication FROM pg_roles WHERE rolname=current_user) AS role_can_replicate,"+
       "(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS role_can_bypass_rls,"+
       "CASE WHEN to_regclass('public.vip_qa_sessions') IS NULL THEN FALSE ELSE "+
       "has_table_privilege(current_user,to_regclass('public.vip_qa_sessions'),'SELECT') AND "+
       "has_table_privilege(current_user,to_regclass('public.vip_qa_sessions'),'INSERT') AND "+
       "has_table_privilege(current_user,to_regclass('public.vip_qa_sessions'),'UPDATE') AND "+
       "has_table_privilege(current_user,to_regclass('public.vip_qa_sessions'),'DELETE') END "+
       "AS session_store_ready",
    );
    const tables=await pool.query<{table_name:string}>(
      "SELECT table_name FROM information_schema.tables "+
      "WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
    );
    const publicObjects=await pool.query<{safe:boolean}>(
      "SELECT "+
      "NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
      "WHERE n.nspname='public' AND c.relkind NOT IN ('r','p','S','i','I')) "+
      "AND NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid "+
      "JOIN pg_namespace n ON n.oid=c.relnamespace "+
      "WHERE n.nspname='public' AND NOT t.tgisinternal) "+
      "AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "+
      "WHERE n.nspname='public') AS safe",
    );
    const environment=await pool.query<{environment_id:string;classification:string}>(
      "SELECT environment_id::text AS environment_id,classification "+
      "FROM public.vip_qa_environment_identity WHERE singleton=TRUE",
    );
    const users=await pool.query<{
      id:number;username:string;email:string|null;role:string;
      is_admin:boolean;is_active:boolean;is_verified:boolean;
    }>(
      "SELECT id,username,email,role,is_admin,is_active,is_verified "+
      "FROM public.users ORDER BY id",
    );
    const unitAccess=await pool.query<{
      user_id:number;access_role:string;unit_number:string;revoked_at:Date|null;
    }>(
      "SELECT a.user_id,a.access_role,u.unit_number,a.revoked_at "+
      "FROM public.vip_unit_access a JOIN public.vip_units u ON u.id=a.unit_id "+
      "ORDER BY a.id",
    );
    const financeReviewers=await pool.query<{
      user_id:number;username:string;role:string;can_approve:boolean;
    }>(
      "SELECT u.id AS user_id,u.username,u.role,p.can_approve "+
      "FROM public.vip_finance_permissions p JOIN public.users u ON u.id=p.user_id "+
      "WHERE u.is_admin=TRUE OR u.role IN ('crm_employee','finance')",
    );
    const tablePrivileges=await pool.query<{
      table_name:string;select:boolean;insert:boolean;update:boolean;delete:boolean;
      truncate:boolean;references:boolean;trigger:boolean;
    }>(
      "SELECT c.relname AS table_name,"+
      "has_table_privilege(current_user,c.oid,'SELECT') AS \"select\","+
      "has_table_privilege(current_user,c.oid,'INSERT') AS \"insert\","+
      "has_table_privilege(current_user,c.oid,'UPDATE') AS \"update\","+
      "has_table_privilege(current_user,c.oid,'DELETE') AS \"delete\","+
      "has_table_privilege(current_user,c.oid,'TRUNCATE') AS \"truncate\","+
      "has_table_privilege(current_user,c.oid,'REFERENCES') AS \"references\","+
      "has_table_privilege(current_user,c.oid,'TRIGGER') AS \"trigger\" "+
      "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
      "WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname",
    );
    const sequencePrivileges=await pool.query<{
      sequence_name:string;owner_table_name:string;usage:boolean;select:boolean;update:boolean;
    }>(
      "SELECT seq.relname AS sequence_name,tbl.relname AS owner_table_name,"+
      "has_sequence_privilege(current_user,seq.oid,'USAGE') AS \"usage\","+
      "has_sequence_privilege(current_user,seq.oid,'SELECT') AS \"select\","+
      "has_sequence_privilege(current_user,seq.oid,'UPDATE') AS \"update\" "+
      "FROM pg_class seq JOIN pg_namespace sn ON sn.oid=seq.relnamespace "+
      "JOIN pg_depend d ON d.objid=seq.oid AND d.deptype IN ('a','i') "+
      "JOIN pg_class tbl ON tbl.oid=d.refobjid "+
      "JOIN pg_namespace tn ON tn.oid=tbl.relnamespace "+
      "WHERE seq.relkind='S' AND sn.nspname='public' AND tn.nspname='public' "+
      "ORDER BY seq.relname",
    );
    const projects=await pool.query<{name:string}>(
      "SELECT name FROM public.vip_projects ORDER BY id",
    );
    const units=await pool.query<{unit_number:string}>(
      "SELECT unit_number FROM public.vip_units ORDER BY id",
    );
    const receipts=await pool.query<{
      file_name:string;uploaded_by:number;uploader_username:string|null;upload_source:string;
    }>(
      "SELECT r.file_name,r.uploaded_by,u.username AS uploader_username,r.upload_source "+
      "FROM public.vip_receipts r LEFT JOIN public.users u ON u.id=r.uploaded_by "+
      "ORDER BY r.id",
    );
    const fileObjects=await pool.query<{
      object_key:string;content_type:string;size_bytes:number;
    }>(
      "SELECT object_key,content_type,size_bytes FROM public.vip_qa_file_objects "+
      "ORDER BY object_key",
    );
    const receiptObjects=await pool.query<{
      available:boolean;internal_sources:boolean;file_sizes_valid:boolean;
      pending_receipt_count:number;pending_receipts_unposted:boolean;
    }>(
      "SELECT "+
      "NOT EXISTS(SELECT 1 FROM public.vip_receipts r "+
      "LEFT JOIN public.vip_qa_file_objects f ON f.object_key=r.object_path "+
      "WHERE f.object_key IS NULL) AS available,"+
      "NOT EXISTS(SELECT 1 FROM public.vip_receipts WHERE upload_source NOT IN ('client','admin')) "+
      "AS internal_sources,"+
      "NOT EXISTS(SELECT 1 FROM public.vip_qa_file_objects "+
      "WHERE size_bytes<>octet_length(object_bytes)) AS file_sizes_valid,"+
      "(SELECT count(*)::int FROM public.vip_receipts WHERE review_status='pending') "+
      "AS pending_receipt_count,"+
      "NOT EXISTS(SELECT 1 FROM public.vip_receipts r "+
      "JOIN public.vip_payment_postings p ON p.receipt_id=r.id "+
      "WHERE r.review_status='pending') AS pending_receipts_unposted",
    );
    const row=identity.rows[0];
     if(!row||!row.server_address||row.server_address!==expectedAddress)throw new Error("identity");
     verifySyntheticRailwayQaSnapshot({...config,serverAddress:expectedAddress},{
      database:row.database,
      role:row.role,
      databaseOwner:row.database_owner,
      serverAddress:row.server_address,
      serverPort:Number(row.server_port),
      hasPrivilegedRoleMembership:row.has_privileged_role_membership===true,
      canCreateInPublicSchema:row.can_create_in_public_schema===true,
      ownedPublicObjectCount:Number(row.owned_public_object_count),
      roleIsSuperuser:row.role_is_superuser===true,
      roleCanCreateDatabase:row.role_can_create_database===true,
      roleCanCreateRole:row.role_can_create_role===true,
      roleCanReplicate:row.role_can_replicate===true,
      roleCanBypassRls:row.role_can_bypass_rls===true,
      environmentRows:environment.rows.map(item=>({
        environmentId:item.environment_id,
        classification:item.classification,
      })),
      publicTables:tables.rows.map(item=>item.table_name),
      publicObjectsWithinAllowlist:publicObjects.rows[0]?.safe===true,
      users:users.rows.map(item=>({
        id:Number(item.id),username:item.username,email:item.email,role:item.role,
        isAdmin:item.is_admin,isActive:item.is_active,isVerified:item.is_verified,
      })),
      unitAccess:unitAccess.rows.map(item=>({
        userId:Number(item.user_id),accessRole:item.access_role,unitNumber:item.unit_number,
        revoked:item.revoked_at!==null,
      })),
      financeReviewers:financeReviewers.rows.map(item=>({
        userId:Number(item.user_id),username:item.username,role:item.role,
        canApprove:item.can_approve,
      })),
      tablePrivileges:tablePrivileges.rows.map(item=>({
        tableName:item.table_name,
        select:item.select,insert:item.insert,update:item.update,delete:item.delete,
        truncate:item.truncate,references:item.references,trigger:item.trigger,
      })),
      sequencePrivileges:sequencePrivileges.rows.map(item=>({
        sequenceName:item.sequence_name,ownerTableName:item.owner_table_name,
        usage:item.usage,select:item.select,update:item.update,
      })),
      projectNames:projects.rows.map(item=>item.name),
      unitNumbers:units.rows.map(item=>item.unit_number),
      receipts:receipts.rows.map(item=>({
        fileName:item.file_name,
        uploadedBy:Number(item.uploaded_by),
        uploaderUsername:item.uploader_username,
      })),
      fileObjects:fileObjects.rows.map(item=>({
        objectKey:item.object_key,contentType:item.content_type,sizeBytes:Number(item.size_bytes),
      })),
      receiptObjectsAvailable:receiptObjects.rows[0]?.available===true,
      receiptSourcesAreInternal:receiptObjects.rows[0]?.internal_sources===true,
      fileObjectsConsistent:receiptObjects.rows[0]?.file_sizes_valid===true,
      sessionStoreReady:row.session_store_ready===true,
      pendingReceiptCount:Number(receiptObjects.rows[0]?.pending_receipt_count||0),
      pendingReceiptsUnposted:receiptObjects.rows[0]?.pending_receipts_unposted===true,
    });
  }catch{
    throw new Error("Managed VIP QA database identity or synthetic-only data check failed");
  }
}

// Compatibility export used by the shared QA app factory when this module is
// selected by the Railway-only build alias.
export const assertQaDatabaseIdentity=assertQaRailwayDatabaseIdentity;
