/**
 * Run only in the isolated GitHub Actions postgres service.
 * Never accepts a Neon or Railway database URL, and does not migrate production.
 */
import {readFileSync} from "node:fs";
import pg from "pg";
const {Client}=pg;
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
      "vip_handover_snags","vip_audit_events","vip_project_cameras","vip_project_photos","vip_notifications","vip_journey_milestones","vip_benefits","vip_service_requests"
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

    // Seller access: one assigned staff member per unit and revocation works.
    const seller1=(await client.query("INSERT INTO users(email) VALUES('sales1@example.test') RETURNING id")).rows[0].id;
    const seller2=(await client.query("INSERT INTO users(email) VALUES('sales2@example.test') RETURNING id")).rows[0].id;
    await client.query("INSERT INTO vip_unit_access(unit_id,user_id,access_role) VALUES($1,$2,'seller')",[uid,seller1]);
    let sellerCollisionBlocked=false;
    try {
      await client.query("INSERT INTO vip_unit_access(unit_id,user_id,access_role) VALUES($1,$2,'seller')",[uid,seller2]);
    } catch(error){sellerCollisionBlocked=(error as {code?:string}).code==="23505";}
    assert(sellerCollisionBlocked,"One active seller per unit must be enforced");
    const anotherUnit=(await client.query(
      "INSERT INTO vip_units(project_id,unit_number) VALUES($1,'202') RETURNING id",[pid])).rows[0].id;
    await client.query("INSERT INTO vip_unit_access(unit_id,user_id,access_role) VALUES($1,$2,'owner')",[anotherUnit,u2]);
    const scopedSql="SELECT u.id FROM vip_units u JOIN vip_unit_access a "+
      "ON a.unit_id=u.id AND a.user_id=$1 AND a.access_role='seller' AND a.revoked_at IS NULL "+
      "WHERE EXISTS(SELECT 1 FROM vip_unit_access owner WHERE owner.unit_id=u.id "+
      "AND owner.access_role='owner' AND owner.revoked_at IS NULL)";
    const seller1List=await client.query(scopedSql,[seller1]);
    assert.deepEqual(seller1List.rows.map(r=>Number(r.id)),[Number(uid)]);
    assert.equal((await client.query(scopedSql,[seller2])).rowCount,0);
    await client.query(
      "UPDATE vip_unit_access SET revoked_at=NOW() WHERE unit_id=$1 "+
      "AND user_id=$2 AND access_role='seller' AND revoked_at IS NULL",[uid,seller1]);
    assert.equal((await client.query(scopedSql,[seller1])).rowCount,0,
      "Seller must lose access immediately after revocation");
    await client.query("INSERT INTO vip_unit_access(unit_id,user_id,access_role) VALUES($1,$2,'seller')",[uid,seller2]);
    const seller2List=await client.query(scopedSql,[seller2]);
    assert.deepEqual(seller2List.rows.map(r=>Number(r.id)),[Number(uid)]);
    // If a sale is canceled and its buyer assignment is revoked, even an
    // assigned seller must stop seeing that unit (including linked receipts).
    await client.query(
      "UPDATE vip_unit_access SET revoked_at=NOW() WHERE unit_id=$1 "+
      "AND access_role='owner' AND revoked_at IS NULL",[uid]);
    assert.equal((await client.query(scopedSql,[seller2])).rowCount,0,
      "No seller access without an active client owner");
    // Only an admin-published stage belongs on the buyer timeline.
    await client.query(
      "INSERT INTO vip_journey_milestones(unit_id,stage_code,status,planned_date,published,updated_by) "+
      "VALUES($1,'contract','planned','2027-04-01',FALSE,$2)",[uid,u1]);
    assert.equal((await client.query(
      "SELECT 1 FROM vip_journey_milestones WHERE unit_id=$1 AND published=TRUE",[uid])).rowCount,0);
    let prematureCompletionBlocked=false;
    try{
      await client.query(
        "UPDATE vip_journey_milestones SET status='completed' WHERE unit_id=$1",[uid]);
    }catch(e){prematureCompletionBlocked=(e as {code?:string}).code==="23514";}
    assert(prematureCompletionBlocked,"Actual milestone date must be recorded before completion");
    await client.query("INSERT INTO vip_handover(unit_id) VALUES($1)",[uid]);
    const result=await client.query("SELECT status FROM vip_handover WHERE unit_id=$1",[uid]);
    assert.equal(result.rows[0].status,"not_ready");
    text("VIP database migration and constraints smoke test passed");
  }finally{await client.end();}
}
function text(value:string){process.stdout.write(value+"\n")}
run().catch(e=>{process.stderr.write(String(e)+"\n");process.exitCode=1});
