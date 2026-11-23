/**
 * Run only in the isolated GitHub Actions postgres service.
 * Never accepts a Neon or Railway database URL, and does not migrate production.
 */
import {readFileSync} from "node:fs";
import pg from "pg";
const {Client}=pg;
import {strict as assert} from "node:assert";
import {generateVipDueReminders} from "../vipDueReminderJob";

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
    // This exact QA-only schema refuses an existing CRM/production users table.
    await client.query(readFileSync("server/vip/migrations/000_qa_users_only.sql","utf8"));

    // Compatibility rehearsal: represent the real application's pre-existing
    // users and CRM tables with SYNTHETIC records in disposable CI Postgres.
    // The QA-only 000 migration is intentionally run *before* this mock CRM table.
    // Neither its schema nor its records may be changed by the additive VIP SQL.
    const legacyUser=(await client.query(
      "INSERT INTO users(username,email,role,is_verified,is_active) "+
      "VALUES('existing_app_user','existing.user@example.test','user',TRUE,TRUE) RETURNING id"
    )).rows[0].id;
    await client.query(
      "CREATE TABLE crm_leads(id INTEGER PRIMARY KEY,full_name TEXT NOT NULL,status TEXT NOT NULL)");
    await client.query(
      "INSERT INTO crm_leads(id,full_name,status) VALUES(501,'Synthetic existing CRM lead','existing')");
    const existingSchema=async()=>({
      columns:(await client.query(
        "SELECT table_name,column_name,ordinal_position,data_type,is_nullable,column_default "+
        "FROM information_schema.columns WHERE table_schema='public' "+
        "AND table_name IN ('users','crm_leads') ORDER BY table_name,ordinal_position"
      )).rows,
      indexes:(await client.query(
        "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' "+
        "AND tablename IN ('users','crm_leads') ORDER BY tablename,indexname"
      )).rows,
      constraints:(await client.query(
        "SELECT c.conrelid::regclass::text AS tablename,c.conname,pg_get_constraintdef(c.oid) AS definition "+
        "FROM pg_constraint c WHERE c.conrelid IN ('users'::regclass,'crm_leads'::regclass) "+
        "ORDER BY tablename,c.conname"
      )).rows
    });
    const originalTableTriggers=async()=>(
      await client.query(
        "SELECT c.relname AS table_name,t.tgname AS trigger_name,t.tgisinternal AS is_internal,"+
        "pg_get_triggerdef(t.oid) AS definition "+
        "FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid "+
        "WHERE t.tgrelid IN ('users'::regclass,'crm_leads'::regclass) "+
        "ORDER BY table_name,trigger_name"
      )
    ).rows;
    const beforeTriggers=await originalTableTriggers();
    const baseline=await existingSchema();
    assert(baseline.columns.some(r=>r.table_name==='users'&&r.column_name==='is_verified'));
    assert(baseline.columns.some(r=>r.table_name==='users'&&r.column_name==='is_active'));
    assert(baseline.columns.some(r=>r.table_name==='users'&&r.column_name==='is_admin'));
    const sql=readFileSync("server/vip/migrations/001_vip_foundation.sql","utf8");
    await client.query(sql);
    // Replaying an additive migration should be safe and must not replace,
    // rename, re-index, or alter any pre-existing application object.
    await client.query(sql);
    assert.deepEqual(await existingSchema(),baseline,
      "VIP migration unexpectedly changed existing app tables, indexes or constraints");
    const afterTriggers=await originalTableTriggers();
    const originalTriggerKeys=new Set(beforeTriggers.map(r=>r.table_name+":"+r.trigger_name));
    const addedTriggers=afterTriggers.filter(r=>
      !originalTriggerKeys.has(r.table_name+":"+r.trigger_name));
    // PostgreSQL adds standard *internal* RI triggers to the referenced
    // users table when new VIP tables declare FKs. This is expected metadata
    // and should not be confused with a new CRM/application business trigger.
    assert(addedTriggers.every(r=>r.table_name==="users"&&r.is_internal===true),
      "VIP migration must not attach custom triggers to existing app or CRM tables");
    assert.deepEqual(afterTriggers.filter(r=>r.table_name==="crm_leads"),
      beforeTriggers.filter(r=>r.table_name==="crm_leads"),
      "VIP migration must not add CRM triggers");
    const preservedUser=await client.query(
      "SELECT id,username,email,is_active,is_verified FROM users WHERE id=$1",[legacyUser]);
    assert.deepEqual(preservedUser.rows,[{id:legacyUser,username:'existing_app_user',
      email:'existing.user@example.test',is_active:true,is_verified:true}]);
    const preservedCrm=await client.query("SELECT * FROM crm_leads WHERE id=501");
    assert.deepEqual(preservedCrm.rows,[{id:501,full_name:'Synthetic existing CRM lead',
      status:'existing'}]);
    const nonVip=await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'vip_%' ORDER BY tablename");
    assert.deepEqual(nonVip.rows.map(r=>r.tablename),['crm_leads','users'],
      "VIP schema must create only new vip_* tables");
    const tableNames=await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'vip_%'");
    const names=new Set(tableNames.rows.map(r=>r.tablename));
    for(const name of [
      "vip_projects","vip_units","vip_unit_access","vip_installments","vip_receipts",
      "vip_finance_permissions","vip_referrals","vip_member_cards",
      "vip_referral_rewards","vip_referral_links","vip_handover","vip_handover_appointments",
      "vip_handover_snags","vip_handover_key_receipts","vip_support_tickets","vip_support_messages","vip_audit_events","vip_project_cameras","vip_project_photos","vip_notifications","vip_notification_preferences","vip_journey_milestones","vip_benefits","vip_service_requests","vip_financial_adjustments","vip_exchange_rates","vip_internal_commissions","vip_crm_sale_links"
    ]) assert(names.has(name),"Missing table "+name);

    const u1=(await client.query("INSERT INTO users(username,email,is_verified) VALUES('vip_one','one@example.test',TRUE) RETURNING id")).rows[0].id;
    const u2=(await client.query("INSERT INTO users(username,email,is_verified) VALUES('vip_two','two@example.test',TRUE) RETURNING id")).rows[0].id;
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

    // Share-link referrals never disclose submitted contact data to the inviter.
    await client.query("INSERT INTO vip_referral_links(user_id,code) VALUES($1,$2)",
      [u1,"KLR-0123456789ABCDEF0123456789ABCDEF"]);
    const linkReferral=(await client.query(
      "INSERT INTO vip_referrals(referrer_user_id,lead_name,lead_phone_e164,contact_consent,consented_at,source) "+
      "VALUES($1,'Private Lead','+995555654320',TRUE,NOW(),'share_link') RETURNING id",[u1])).rows[0].id;
    const privateView=await client.query(
      "SELECT CASE WHEN source='share_link' THEN NULL ELSE lead_name END AS lead_name,"+
      "CASE WHEN source='share_link' THEN NULL ELSE lead_phone_e164 END AS lead_phone_e164 "+
      "FROM vip_referrals WHERE id=$1",[linkReferral]);
    assert.equal(privateView.rows[0].lead_name,null);
    assert.equal(privateView.rows[0].lead_phone_e164,null);
    let duplicateLinkBlocked=false;
    try{await client.query("INSERT INTO vip_referral_links(user_id,code) VALUES($1,$2)",
      [u2,"KLR-0123456789ABCDEF0123456789ABCDEF"]);}
    catch(e){duplicateLinkBlocked=(e as {code?:string}).code==="23505";}
    assert(duplicateLinkBlocked,"Referral link code must be globally unique");
    // Seller access: one assigned staff member per unit and revocation works.
    const seller1=(await client.query("INSERT INTO users(username,email,is_verified) VALUES('vip_sales1','sales1@example.test',TRUE) RETURNING id")).rows[0].id;
    const seller2=(await client.query("INSERT INTO users(username,email,is_verified) VALUES('vip_sales2','sales2@example.test',TRUE) RETURNING id")).rows[0].id;
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
    // Draft financial entries must never leak into published buyer summaries.
    await client.query(
      "INSERT INTO vip_financial_adjustments(unit_id,category,amount,currency,description,source,published,created_by) "+
      "VALUES($1,'maintenance',2.06,'USD','Internal test entry','internal_note',FALSE,$2)",[uid,u1]);
    assert.equal((await client.query(
      "SELECT 1 FROM vip_financial_adjustments WHERE unit_id=$1 AND published=TRUE",[uid])).rowCount,0);
    let badPublishedFeeBlocked=false;
    try{
      await client.query(
        "INSERT INTO vip_financial_adjustments(unit_id,category,amount,currency,description,source,published,created_by) "+
        "VALUES($1,'tax',100,'USD','Unverified tax','internal_note',TRUE,$2)",[uid,u1]);
    }catch(e){badPublishedFeeBlocked=(e as {code?:string}).code==="23514";}
    assert(badPublishedFeeBlocked,"Unverified fee must not be visible");
    await client.query(
      "INSERT INTO vip_financial_adjustments(unit_id,category,amount,currency,description,source,source_reference,published,created_by) "+
      "VALUES($1,'maintenance',2.06,'USD','Published service fee','signed_contract','Section 12.3',TRUE,$2)",[uid,u1]);
    // Exactly two days before the due date, emit one private in-app notice.
    // Testing runs against local vipdb only, never production.
    const futureDue=(await client.query("SELECT ((NOW() AT TIME ZONE 'Asia/Tbilisi')::date+2)::text AS day")).rows[0].day;
    const noticeUnit=(await client.query(
      "INSERT INTO vip_units(project_id,unit_number) VALUES($1,'303') RETURNING id",[pid])).rows[0].id;
    await client.query("INSERT INTO vip_unit_access(unit_id,user_id,access_role) VALUES($1,$2,'owner')",[noticeUnit,u2]);
    const installment=(await client.query(
      "INSERT INTO vip_installments(unit_id,sequence_number,due_date,amount,currency) "+
      "VALUES($1,1,$2,350,'USD') RETURNING id",[noticeUnit,futureDue])).rows[0].id;
    assert.equal(await generateVipDueReminders(client),1);
    assert.equal(await generateVipDueReminders(client),0,"Due notices must not duplicate");
    await client.query(
      "INSERT INTO vip_notification_preferences(user_id,in_app_due_reminders) VALUES($1,FALSE)",[u2]);
    const installment2=(await client.query(
      "INSERT INTO vip_installments(unit_id,sequence_number,due_date,amount,currency) "+
      "VALUES($1,2,$2,125,'USD') RETURNING id",[noticeUnit,futureDue])).rows[0].id;
    assert.equal(await generateVipDueReminders(client),0,"Opt-out blocks new scheduled notices");
    await client.query("UPDATE vip_notification_preferences SET in_app_due_reminders=TRUE WHERE user_id=$1",[u2]);
    await client.query("INSERT INTO vip_payment_postings(installment_id,amount,currency,verified_by) "+
      "VALUES($1,125,'USD',$2)",[installment2,u1]);
    assert.equal(await generateVipDueReminders(client),0,"Paid installments must not trigger notices");
    assert.equal((await client.query("SELECT COUNT(*)::int AS n FROM vip_notifications "+
      "WHERE event_type='due_reminder' AND user_id=$1",[u2])).rows[0].n,1);
    assert(installment>0);
    const ticket=(await client.query(
      "INSERT INTO vip_support_tickets(unit_id,owner_user_id,category,subject,due_at) "+
      "VALUES($1,$2,'payment','Payment clarification',NOW()+INTERVAL '48 hours') RETURNING id",
      [uid,u1])).rows[0].id;
    await client.query("INSERT INTO vip_support_messages(ticket_id,sender_user_id,message) "+
      "VALUES($1,$2,'Please clarify the outstanding installment')",[ticket,u1]);
    assert.equal((await client.query("SELECT COUNT(*)::int AS n FROM vip_support_messages WHERE ticket_id=$1",[ticket])).rows[0].n,1);
    assert.equal((await client.query("SELECT 1 FROM vip_support_tickets WHERE id=$1 AND owner_user_id=$2",[ticket,u2])).rowCount,0);
    let bogusTicketStatusBlocked=false;
    try{await client.query("UPDATE vip_support_tickets SET status='bypass' WHERE id=$1",[ticket]);}
    catch(e){bogusTicketStatusBlocked=(e as {code?:string}).code==="23514";}
    assert(bogusTicketStatusBlocked,"Invalid ticket statuses must be rejected");
    // Private commissions: no unsettled draft may claim a documented settlement.
    const fx=(await client.query(
      "INSERT INTO vip_exchange_rates(base_currency,quote_currency,rate,effective_date,source,source_reference,created_by) "+
      "VALUES('USD','GEL',2.70,CURRENT_DATE,'Verified source','Official 2026 FX source',$1) RETURNING id",[u1])).rows[0].id;
    let fxUnreviewedBlocked=false;
    try{await client.query("UPDATE vip_exchange_rates SET published=TRUE WHERE id=$1",[fx]);}
    catch(e){fxUnreviewedBlocked=(e as {code?:string}).code==="23514";}
    assert(fxUnreviewedBlocked,"FX rates require separate approval before publication");
    await client.query("UPDATE vip_exchange_rates SET published=TRUE,approved_by=$2,approved_at=NOW() WHERE id=$1",[fx,u2]);
    let badMethodBlocked=false;
    try{await client.query(
      "INSERT INTO vip_internal_commissions(unit_id,side,category,basis_amount,percentage,fixed_amount,currency,payee_label,contract_reference,created_by) "+
      "VALUES($1,'expense','employee',139000,1,2000,'USD','Agent','Signed contract 2026',$2)",[uid,u1]);}
    catch(e){badMethodBlocked=(e as {code?:string}).code==="23514";}
    assert(badMethodBlocked,"Commission cannot mix percentage and fixed amount");
    const c=(await client.query(
      "INSERT INTO vip_internal_commissions(unit_id,side,category,basis_amount,percentage,currency,payee_label,contract_reference,created_by) "+
      "VALUES($1,'expense','employee',139000,1,'USD','Agent','Signed contract 2026',$2) RETURNING id",[uid,u1])).rows[0].id;
    let unreviewedSettlementBlocked=false;
    try{await client.query("UPDATE vip_internal_commissions SET status='settled',settled_by=$2,settled_at=NOW(),settlement_reference='Transfer 2026' WHERE id=$1",[c,u2]);}
    catch(e){unreviewedSettlementBlocked=(e as {code?:string}).code==="23514";}
    assert(unreviewedSettlementBlocked,"Commission settlement requires finance review first");
    await client.query("UPDATE vip_internal_commissions SET status='approved',approved_by=$2,approved_at=NOW() WHERE id=$1",[c,u2]);
    await client.query("UPDATE vip_internal_commissions SET status='settled',settled_by=$2,settled_at=NOW(),settlement_reference='Transfer 2026' WHERE id=$1",[c,u2]);
    // CRM associations exist exclusively in VIP; no CRM source table changes.
    const crmLink=(await client.query(
      "INSERT INTO vip_crm_sale_links(unit_id,owner_user_id,crm_lead_id,signed_sale_reference,note,linked_by) "+
      "VALUES($1,$2,1001,'SALE-CONTRACT-2026','Signed sale was confirmed by management',$3) RETURNING id",
      [uid,u1,u2])).rows[0].id;
    let duplicateCrmAssociationBlocked=false;
    try{await client.query(
      "INSERT INTO vip_crm_sale_links(unit_id,owner_user_id,crm_lead_id,signed_sale_reference,note,linked_by) "+
      "VALUES($1,$2,1002,'SALE-CONTRACT-2027','Alternative buyer association',$3)",
      [uid,u1,u2]);}
    catch(e){duplicateCrmAssociationBlocked=(e as {code?:string}).code==="23505";}
    assert(duplicateCrmAssociationBlocked,"One active CRM association per VIP unit");
    await client.query("UPDATE vip_crm_sale_links SET revoked_at=NOW(),revoked_by=$2,revocation_reason='Replaced after review' WHERE id=$1",[crmLink,u2]);
    await client.query("INSERT INTO vip_crm_sale_links(unit_id,owner_user_id,crm_lead_id,signed_sale_reference,note,linked_by) "+
     "VALUES($1,$2,1002,'SALE-CONTRACT-2027','Revised association after signed contract',$3)",[uid,u1,u2]);
    await client.query("INSERT INTO vip_handover(unit_id) VALUES($1)",[uid]);
    await client.query("INSERT INTO vip_handover_key_receipts(unit_id,owner_user_id,developer_handover_reference,approval_note,approved_by) "+
      "VALUES($1,$2,'DEVELOPER-DELIVERY-2027','Inspected and approved for key delivery',$3)",[uid,u1,u1]);
    let prematureKeyConfirmationBlocked=false;
    try{
      await client.query("UPDATE vip_handover_key_receipts SET delivered_at=NOW(),delivered_by=$2,key_delivery_reference='DELIVERY-2027-01' WHERE unit_id=$1",[uid,u1]);
    }catch(e){prematureKeyConfirmationBlocked=(e as {code?:string}).code==="23514";}
    assert(prematureKeyConfirmationBlocked,"Management cannot finalize keys before buyer acknowledgment");
    await client.query("UPDATE vip_handover_key_receipts SET received_keys_count=2,received_date=CURRENT_DATE,buyer_acknowledged_at=NOW() WHERE unit_id=$1",[uid]);
    await client.query("UPDATE vip_handover_key_receipts SET delivered_at=NOW(),delivered_by=$2,key_delivery_reference='DELIVERY-2027-01' WHERE unit_id=$1",[uid,u1]);
    const received=await client.query("SELECT received_keys_count,buyer_acknowledged_at,delivered_at FROM vip_handover_key_receipts WHERE unit_id=$1",[uid]);
    assert.equal(received.rows[0].received_keys_count,2);
    assert(received.rows[0].buyer_acknowledged_at);
    assert(received.rows[0].delivered_at);
    const result=await client.query("SELECT status FROM vip_handover WHERE unit_id=$1",[uid]);
    assert.equal(result.rows[0].status,"not_ready");
    text("VIP database migration and constraints smoke test passed");
  }finally{await client.end();}
}
function text(value:string){process.stdout.write(value+"\n")}
run().catch(e=>{process.stderr.write(String(e)+"\n");process.exitCode=1});
