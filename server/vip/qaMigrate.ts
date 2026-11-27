import {readFileSync} from "node:fs";
import {assertQaDatabaseIdentity,pool} from "./qaPreviewDb";
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
 await assertQaDatabaseIdentity();
 const client=await pool.connect();
 try{
  // Protect against competing migration attempts and make both SQL scripts
  // one all-or-nothing transaction; neither users nor VIP tables can be left
  // half-created if either phase or the readiness check fails.
  const statements=(path:string):string=>{
   const source=readFileSync(path,"utf8");
   const stripped=source
    .replace(/^(?:\s*--[^\n]*\n)*\s*BEGIN;\s*/i,"")
    .replace(/\s*COMMIT;\s*$/i,"");
   if(stripped===source||!stripped.trim()||/\n\s*COMMIT;\s*\n/i.test(stripped)){
    throw Error("QA migration file has unexpected transaction boundaries");
   }
   return stripped;
  };
  const usersSql=statements("server/vip/migrations/000_qa_users_only.sql");
  const vipSql=statements("server/vip/migrations/001_vip_foundation.sql");
   const sessionsSql=statements("server/vip/migrations/003_qa_sessions.sql");
  await client.query("BEGIN");
  try{
   await client.query("SELECT pg_advisory_xact_lock(81128731)");
   const existing=await client.query(
    "SELECT table_name FROM information_schema.tables "+
    "WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name");
   if(existing.rowCount)throw Error("QA migration refused: database is not empty");
   await client.query(usersSql);
   await client.query(vipSql);
    await client.query(sessionsSql);
   const ready=await client.query(
    "SELECT to_regclass('public.users') AS users,"+
    "to_regclass('public.vip_units') AS units,"+
     "to_regclass('public.vip_unit_access') AS access,"+
     "to_regclass('public.vip_qa_sessions') AS sessions");
    if(!ready.rows[0]?.users||!ready.rows[0]?.units||!ready.rows[0]?.access||
      !ready.rows[0]?.sessions)
    throw Error("QA migration verification failed");
   await client.query("COMMIT");
  }catch(e){
   await client.query("ROLLBACK").catch(()=>{});
   throw e;
  }
  process.stdout.write("Isolated QA schemas installed atomically; no customer data imported\n");
 }finally{
  client.release();
  await pool.end();
 }
}
run().catch(e=>{
 process.stderr.write("QA migration refused: "+(e instanceof Error?e.message:String(e))+"\n");
 process.exitCode=1;
});
