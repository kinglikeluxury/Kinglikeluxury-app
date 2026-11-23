import {readFileSync} from "node:fs";
import {pool} from "./qaPreviewDb";
import {assertQaPreviewConfiguration} from "./qaPreviewRules";

/**
 * Owner-invoked ONLY. Applies QA schema to a completely empty, dedicated
 * Railway private Postgres database. Never called by app startup or deploy.
 * SQL 000 refuses databases containing existing real users/CRM.
 */
async function run(){
 assertQaPreviewConfiguration();
 if(process.env.KINGLIKE_VIP_QA_MIGRATE_APPROVED!=="true")
  throw Error("Explicit QA-only migration approval required");
 const client=await pool.connect();
 try{
  const existing=await client.query(
   "SELECT table_name FROM information_schema.tables "+
   "WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name");
  if(existing.rowCount){
   throw Error("QA migration refused: database is not empty");
  }
  const usersSql=readFileSync("server/vip/migrations/000_qa_users_only.sql","utf8");
  const vipSql=readFileSync("server/vip/migrations/001_vip_foundation.sql","utf8");
  await client.query(usersSql);
  await client.query(vipSql);
  const ready=await client.query(
   "SELECT to_regclass('public.users') AS users,"+
   "to_regclass('public.vip_units') AS units,"+
   "to_regclass('public.vip_unit_access') AS access");
  if(!ready.rows[0]?.users||!ready.rows[0]?.units||!ready.rows[0]?.access)
   throw Error("QA migration verification failed");
  process.stdout.write("Isolated QA schemas installed; no customer data imported\n");
 }finally{
  client.release();
  await pool.end();
 }
}
run().catch(e=>{
 process.stderr.write("QA migration refused: "+(e instanceof Error?e.message:String(e))+"\n");
 process.exitCode=1;
});
