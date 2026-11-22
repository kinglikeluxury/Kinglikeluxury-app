/**
 * Run only in the isolated GitHub Actions postgres service.
 * Never accepts a Neon or Railway database URL, and does not migrate production.
 */
import {readFileSync} from "node:fs";
import {Client} from "pg";
import {strict as assert} from "node:assert";

const testUrl=process.env.VIP_TEST_DATABASE_URL;
if(!testUrl)throw Error("VIP_TEST_DATABASE_URL is required");
const parsed=new URL(testUrl);
if(parsed.hostname!=="127.0.0.1"&&parsed.hostname!=="localhost"){
  throw Error("Migration smoke test refuses non-local database");
}
if(parsed.pathname!=="/vipdb")throw Error("Migration smoke test requires the vipdb database");
const client=new Client({connectionString:testUrl});
async function run(){
  await client.connect();
  try{
    await client.query("CREATE TABLE users(id SERIAL PRIMARY KEY,email TEXT)");
    const sql=readFileSync("server/vip/migrations/001_vip_foundation.sql","utf8");
    await client.query(sql);
    const tableNames=await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'vip_%'");
    const names=new Set(tableNames.rows.map(r=>r.tablename));
    for(const name of [
      "vip_projects","vip_units","vip_unit_access","vip_installments","vip_receipts",
      "vip_finance_permissions","vip_referrals","vip_member_cards",
      "vip_referral_rewards","vip_handover","vip_handover_appointments",
      "vip_handover_snags","vip_audit_events","vip_project_cameras","vip_project_photos"
    ]) assert(names.has(name),"Missing table "+name);

    const u1=(await client.query("INSERT INTO users(email) VALUES('one@example.test') RETURNING id")).rows[0].id;
    const u2=(await client.query("INSERT INTO users(email) VALUES('two@example.test') RETURNING id")).rows[0].id;
    const pid=(await client.query("INSERT INTO vip_projects(name) VALUES('Test Project') RETURNING id")).rows[0].id;
    const uid=(await client.query("INSERT INTO vip_units(project_id,unit_number) VALUES($1,'101') RETURNING id",[pid])).rows[0].id;
    await client.query("INSERT INTO vip_unit_access(unit_id,user_id,access_role) VALUES($1,$2,'owner')",[uid,u1]);
    let duplicateBlocked=false;
    try{
      await client.query("INSERT INTO vip_unit_access(unit_id,user_id,access_role) VALUES($1,$2,'owner')",[uid,u2]);
    }catch(error){duplicateBlocked=(error as {code?:string}).code==="23505";}
    assert(duplicateBlocked,"Double active ownership must be blocked");
    const code="KLV-0123456789ABCDEF01234567";
    await client.query("INSERT INTO vip_member_cards(user_id,member_code) VALUES($1,$2)",[u1,code]);
    await client.query(
      "INSERT INTO vip_referrals(referrer_user_id,lead_name,lead_phone_e164,contact_consent,consented_at) "+
      "VALUES($1,'Sample Contact','+995555123456',TRUE,NOW())",[u1]);
    let duplicateReferralBlocked=false;
    try{
      await client.query(
        "INSERT INTO vip_referrals(referrer_user_id,lead_name,lead_phone_e164,contact_consent,consented_at) "+
        "VALUES($1,'Duplicate Contact','+995555123456',TRUE,NOW())",[u1]);
    }catch(error){duplicateReferralBlocked=(error as {code?:string}).code==="23505";}
    assert(duplicateReferralBlocked,"Duplicate referrals must be blocked");
    let noConsentBlocked=false;
    try{
      await client.query(
        "INSERT INTO vip_referrals(referrer_user_id,lead_name,lead_phone_e164,contact_consent,consented_at) "+
        "VALUES($1,'No consent','+995555654321',FALSE,NOW())",[u1]);
    }catch(error){noConsentBlocked=(error as {code?:string}).code==="23514";}
    assert(noConsentBlocked,"Contact consent required");
    let badPhoneBlocked=false;
    try{
      await client.query(
        "INSERT INTO vip_referrals(referrer_user_id,lead_name,lead_phone_e164,contact_consent,consented_at) "+
        "VALUES($1,'Invalid phone','555123',TRUE,NOW())",[u1]);
    }catch(error){badPhoneBlocked=(error as {code?:string}).code==="23514";}
    assert(badPhoneBlocked,"International phone required");

    await client.query("INSERT INTO vip_handover(unit_id) VALUES($1)",[uid]);
    const result=await client.query("SELECT status FROM vip_handover WHERE unit_id=$1",[uid]);
    assert.equal(result.rows[0].status,"not_ready");
    text("VIP database migration and constraints smoke test passed");
  }finally{await client.end();}
}
function text(value:string){process.stdout.write(value+"\n")}
run().catch(e=>{process.stderr.write(String(e)+"\n");process.exitCode=1});
