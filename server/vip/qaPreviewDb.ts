import pg from "pg";
import {assertTemporaryPostgresProcessIdentity} from "./qaLocalPostgresIdentity";
import {validateQaDatabaseUrl} from "./qaPreviewRules";

const {Pool}=pg;
const approvedLoopbackAddresses=new Set(["127.0.0.1","::1","::ffff:127.0.0.1"]);

/**
 * Temporary loopback-only QA database. It cannot connect to Neon, Railway,
 * CRM, or any non-local PostgreSQL host.
 */
const connectionString=validateQaDatabaseUrl(process.env.KINGLIKE_VIP_QA_DATABASE_URL);
const parsedQaUrl=new URL(connectionString);

export const pool=new Pool({
  connectionString,
  host:parsedQaUrl.hostname,
  port:parsedQaUrl.port?Number(parsedQaUrl.port):5432,
  database:"vipdb",
  user:decodeURIComponent(parsedQaUrl.username),
  password:decodeURIComponent(parsedQaUrl.password),
  ssl:false,
 max:5,connectionTimeoutMillis:4000,idleTimeoutMillis:5000
});

export async function assertQaDatabaseIdentity():Promise<void>{
  const expectedPort=Number(process.env.VIP_QA_EXPECTED_PORT);
  assertTemporaryPostgresProcessIdentity(
    process.env.VIP_QA_EXPECTED_DATA_DIRECTORY,
    expectedPort,
  );
  const result=await pool.query<{
    database_name:string;
    role_name:string;
    server_address:string|null;
    server_port:number;
  }>(
    "SELECT current_database() AS database_name,current_user AS role_name,"+
    "host(inet_server_addr()) AS server_address,"+
    "inet_server_port() AS server_port"
  );
  const row=result.rows[0];
  if(!row||row.database_name!=="vipdb"||
    row.role_name!==decodeURIComponent(parsedQaUrl.username)||
    !/^vipqa_[a-z0-9_]{1,40}$/.test(row.role_name)||
    !approvedLoopbackAddresses.has(row.server_address||"")||
    row.server_port!==expectedPort){
    throw Error("VIP QA database identity is not an approved loopback fixture");
  }
}
