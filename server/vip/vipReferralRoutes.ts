import type {Express,Request,Response,RequestHandler} from "express";
import {pool} from "../db";
import type { PoolClient } from "pg";
import {canTransitionReferral,canTransitionReward,normalizedReferralName,normalizedReferralPhone,
  type ReferralStatus,type RewardStatus} from "./vipEngagementRules";
function idOf(raw:unknown):number|null{
  if(typeof raw!=="string"||!/^[1-9]\d*$/.test(raw))return null;
  const value=Number(raw);return Number.isSafeInteger(value)?value:null;
}
const originJson:RequestHandler=(req,res,next)=>{
  if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
  try{
    const origin=req.get("Origin");
    if(!origin||new URL(origin).host!==req.get("Host"))return res.status(403).json({error:"Same-origin request required"});
  }catch{return res.status(403).json({error:"Invalid origin"});}
  next();
};
const listClientSql=
 "SELECT r.id::text AS id,"+
 "CASE WHEN r.source='share_link' THEN NULL ELSE r.lead_name END AS lead_name,"+
 "CASE WHEN r.source='share_link' THEN NULL ELSE r.lead_phone_e164 END AS lead_phone_e164,"+
 "r.source,r.status,r.created_at, "+
 "w.status AS reward_status,CASE WHEN w.status IN ('approved','fulfilled') THEN w.description ELSE NULL END AS reward_description "+
 "FROM vip_referrals r LEFT JOIN vip_referral_rewards w ON w.referral_id=r.id "+
 "WHERE r.referrer_user_id=$1 ORDER BY r.created_at DESC LIMIT 100";
async function isVipOwner(userId:number,conn:typeof pool | PoolClient=pool):Promise<boolean>{
  const a=await conn.query(
    "SELECT 1 FROM vip_unit_access WHERE user_id=$1 AND access_role='owner' AND revoked_at IS NULL LIMIT 1",
    [userId]);
  return a.rowCount===1;
}
export function registerVipReferralRoutes(app:Express,enabled:RequestHandler,auth:RequestHandler,admin:RequestHandler):void{
  app.get("/api/vip/referrals",enabled,auth,async(_req:Request,res:Response)=>{
    try{
      if(!(await isVipOwner(res.locals.vipUser.id)))return res.status(403).json({error:"VIP membership required"});
      const r=await pool.query(listClientSql,[res.locals.vipUser.id]);
      return res.json({referrals:r.rows});
    }catch{return res.status(503).json({error:"Referrals unavailable"});}
  });
  app.post("/api/vip/referrals",enabled,auth,originJson,async(req:Request,res:Response)=>{
    const leadName=normalizedReferralName(req.body?.leadName);
    const phone=normalizedReferralPhone(req.body?.phoneE164);
    if(!leadName||!phone||req.body?.contactConsent!==true){
      return res.status(400).json({error:"Contact name, international phone and consent required"});
    }
    const userId=res.locals.vipUser.id;
    const db=await pool.connect().catch(()=>null);
    if(!db)return res.status(503).json({error:"Referral service unavailable"});
    try{
      await db.query("BEGIN");
      // Serializes submissions to prevent rate limit races per buyer.
      const u=await db.query("SELECT id FROM users WHERE id=$1 AND is_active=TRUE FOR UPDATE",[userId]);
      if(!u.rowCount||!(await isVipOwner(userId,db))){
        await db.query("ROLLBACK");return res.status(403).json({error:"Only active VIP owners can refer"});
      }
      const daily=await db.query(
        "SELECT COUNT(*)::int AS count FROM vip_referrals WHERE referrer_user_id=$1 "+
        "AND created_at>NOW()-interval '24 hours'",[userId]);
      if(Number(daily.rows[0].count)>=3){
        await db.query("ROLLBACK");return res.status(429).json({error:"Daily referral limit reached"});
      }
      const added=await db.query(
        "INSERT INTO vip_referrals(referrer_user_id,lead_name,lead_phone_e164,contact_consent,consented_at) "+
        "VALUES($1,$2,$3,TRUE,NOW()) RETURNING id::text AS id,status,created_at",
        [userId,leadName,phone]);
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) "+
        "VALUES($1,'vip_referral_submitted',$2::jsonb)",
        [userId,JSON.stringify({referralId:added.rows[0].id,consent:true})]);
      await db.query("COMMIT");
      return res.status(201).json({referral:added.rows[0]});
    }catch(e){
      await db.query("ROLLBACK").catch(()=>{});
      const unique=(e as {code?:string})?.code==="23505";
      return res.status(unique?409:503).json({error:unique?"This contact has already been referred":"Could not save referral"});
    }finally{db.release();}
  });
  app.get("/api/admin/vip/referrals",enabled,auth,admin,async(_req:Request,res:Response)=>{
    try{
      const r=await pool.query(
        "SELECT r.id::text AS id,r.lead_name,r.lead_phone_e164,r.status,r.created_at,"+
        "r.sale_reference,r.referrer_user_id,u.email AS referrer_email,"+
        "w.status AS reward_status,w.description AS reward_description,w.id::text AS reward_id "+
        "FROM vip_referrals r JOIN users u ON u.id=r.referrer_user_id "+
        "LEFT JOIN vip_referral_rewards w ON w.referral_id=r.id "+
        "ORDER BY r.created_at DESC LIMIT 250");
      return res.json({referrals:r.rows});
    }catch{return res.status(503).json({error:"Referrals unavailable"});}
  });
  app.patch("/api/admin/vip/referrals/:id",enabled,auth,admin,originJson,async(req:Request,res:Response)=>{
    const referralId=idOf(req.params.id);
    const next=req.body?.status as ReferralStatus;
    const saleRef=req.body?.saleReference;
    const note=req.body?.note;
    if(!referralId||!["contacted","qualified","converted","declined"].includes(next)||
       (note!==undefined&&(typeof note!=="string"||note.length>500))||
       (next==="converted"&&(typeof saleRef!=="string"||!/^[-a-zA-Z0-9_/]{6,80}$/.test(saleRef)))){
      return res.status(400).json({error:"Invalid referral decision; conversion requires a sale reference"});
    }
    const db=await pool.connect().catch(()=>null);
    if(!db)return res.status(503).json({error:"Referral service unavailable"});
    try{
      await db.query("BEGIN");
      const row=await db.query("SELECT status FROM vip_referrals WHERE id=$1 FOR UPDATE",[referralId]);
      if(!row.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Referral not found"});}
      const previous=row.rows[0].status as ReferralStatus;
      if(!canTransitionReferral(previous,next)){
        await db.query("ROLLBACK");return res.status(409).json({error:"Invalid referral status transition"});
      }
      await db.query(
        "UPDATE vip_referrals SET status=$2,sale_reference=CASE WHEN $2='converted' THEN $3 ELSE sale_reference END, "+
        "review_note=$4,reviewed_by=$5,reviewed_at=NOW() WHERE id=$1",
        [referralId,next,next==="converted"?saleRef.trim():null,note?.trim()||null,res.locals.vipUser.id]);
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) "+
        "VALUES($1,'vip_referral_status_changed',$2::jsonb)",
        [res.locals.vipUser.id,JSON.stringify({referralId,from:previous,to:next,saleReference:next==="converted"?saleRef:null})]);
      await db.query("COMMIT");
      return res.json({status:next});
    }catch(e){
      await db.query("ROLLBACK").catch(()=>{});
      const unique=(e as {code?:string})?.code==="23505";
      return res.status(unique?409:503).json({error:unique?"Sale reference already used":"Could not update referral"});
    }finally{db.release();}
  });
  app.post("/api/admin/vip/referrals/:id/reward",enabled,auth,admin,originJson,async(req:Request,res:Response)=>{
    const referralId=idOf(req.params.id);
    const description=req.body?.description;
    if(!referralId||typeof description!=="string"||description.trim().length<8||description.length>250){
      return res.status(400).json({error:"Reward description must contain 8–250 characters"});
    }
    const db=await pool.connect().catch(()=>null);
    if(!db)return res.status(503).json({error:"Reward review unavailable"});
    try{
      await db.query("BEGIN");
      const r=await db.query("SELECT id,status FROM vip_referrals WHERE id=$1 FOR UPDATE",[referralId]);
      if(!r.rowCount||r.rows[0].status!=="converted"){
        await db.query("ROLLBACK");return res.status(409).json({error:"A verified sale reference is required before proposing rewards"});
      }
      const reward=await db.query(
        "INSERT INTO vip_referral_rewards(referral_id,description,proposed_by) "+
        "VALUES($1,$2,$3) RETURNING id::text AS id,status",
        [referralId,description.trim(),res.locals.vipUser.id]);
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) "+
        "VALUES($1,'vip_reward_proposed',$2::jsonb)",
        [res.locals.vipUser.id,JSON.stringify({referralId,rewardId:reward.rows[0].id})]);
      await db.query("COMMIT");return res.status(201).json({reward:reward.rows[0]});
    }catch(e){
      await db.query("ROLLBACK").catch(()=>{});
      return res.status((e as {code?:string}).code==="23505"?409:503)
       .json({error:"Could not propose reward; an existing proposal may already exist"});
    }finally{db.release();}
  });
  app.patch("/api/admin/vip/referrals/:id/reward",enabled,auth,admin,originJson,async(req:Request,res:Response)=>{
    const referralId=idOf(req.params.id);
    const status=req.body?.status as RewardStatus;
    if(!referralId||!["approved","declined","fulfilled"].includes(status)){
      return res.status(400).json({error:"Invalid reward decision"});
    }
    const db=await pool.connect().catch(()=>null);
    if(!db)return res.status(503).json({error:"Reward service unavailable"});
    try{
      await db.query("BEGIN");
      const row=await db.query(
        "SELECT w.id,w.status FROM vip_referral_rewards w WHERE w.referral_id=$1 FOR UPDATE",[referralId]);
      if(!row.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Reward not found"});}
      const before=row.rows[0].status as RewardStatus;
      if(!canTransitionReward(before,status)){
        await db.query("ROLLBACK");return res.status(409).json({error:"Reward transition not allowed"});
      }
      await db.query("UPDATE vip_referral_rewards SET status=$2,reviewed_by=$3,reviewed_at=NOW() "+
        "WHERE id=$1",[row.rows[0].id,status,res.locals.vipUser.id]);
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) "+
        "VALUES($1,'vip_reward_status_changed',$2::jsonb)",
        [res.locals.vipUser.id,JSON.stringify({referralId,from:before,to:status})]);
      await db.query("COMMIT");return res.json({rewardStatus:status});
    }catch{await db.query("ROLLBACK").catch(()=>{});return res.status(503).json({error:"Reward decision failed"});}
    finally{db.release();}
  });
}
