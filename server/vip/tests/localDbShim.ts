/**
 * Integration-test-only stand-in for server/db.ts.
 * This is never imported by the deployed application. The esbuild alias in the
 * isolated GitHub workflow redirects VIP route imports to this module.
 */
import pg from "pg";
const {Pool}=pg;
const url=process.env.VIP_TEST_DATABASE_URL;
if(!url)throw Error("VIP integration test requires explicit test database URL");
const parsed=new URL(url);
if(!["127.0.0.1","localhost"].includes(parsed.hostname)||parsed.pathname!=="/vipdb"||
   Number(parsed.port)!==Number(process.env.PGPORT)){
 throw Error("VIP integration test refuses any non-local or non-vipdb connection");
}
export const pool=new Pool({connectionString:url,max:4,connectionTimeoutMillis:3000,idleTimeoutMillis:1000});
