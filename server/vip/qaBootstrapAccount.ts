import bcrypt from "bcrypt";
import {assertQaDatabaseIdentity,pool} from "./qaPreviewDb";
import {assertQaPreviewConfiguration} from "./qaPreviewRules";
import {validateQaBootstrapIdentity} from "./qaBootstrapRules";

/**
 * Operator-only CLI, NOT an HTTP endpoint and NEVER invoked on startup.
 * Creates synthetic accounts only in the local loopback QA database adapter.
 * It is not a Railway seeder and its credentials must never be reused remotely.
 */
async function run(){
 assertQaPreviewConfiguration();
 if(process.env.KINGLIKE_VIP_QA_BOOTSTRAP_ONLY!=="true")
  throw Error("Explicit QA bootstrap authorization is required");
 const username=process.env.KINGLIKE_VIP_QA_BOOTSTRAP_USERNAME;
 const email=process.env.KINGLIKE_VIP_QA_BOOTSTRAP_EMAIL;
 const password=process.env.KINGLIKE_VIP_QA_BOOTSTRAP_PASSWORD;
 const kind=process.env.KINGLIKE_VIP_QA_BOOTSTRAP_ROLE;
 if(!validateQaBootstrapIdentity(username,email,password)||
    !["admin","buyer","seller"].includes(kind||""))
   throw Error("Synthetic QA username, .test email, strong password and role required");
 await assertQaDatabaseIdentity();
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(918273645)");
  if(kind==="admin"){
   const existing=await client.query("SELECT 1 FROM users WHERE is_admin=TRUE LIMIT 1");
   if(existing.rowCount)throw Error("QA administrator already exists; escalation refused");
  }
  const hash=await bcrypt.hash(password!,12);
  const role=kind==="seller"?"sub_agent":"user";
  const result=await client.query(
   "INSERT INTO users(username,email,password,is_verified,is_active,is_admin,role,auth_method) "+
   "VALUES($1,$2,$3,TRUE,TRUE,$4,$5,'email') RETURNING id",
   [username,email,hash,kind==="admin",role]);
  await client.query("COMMIT");
  process.stdout.write("QA-only "+kind+" account created: user id "+result.rows[0].id+"\n");
 }catch(error){
  await client.query("ROLLBACK").catch(()=>{});
  throw error;
 }finally{client.release();await pool.end();}
}
run().catch(error=>{
 process.stderr.write("QA bootstrap refused: "+(error instanceof Error?error.message:String(error))+"\n");
 process.exitCode=1;
});
