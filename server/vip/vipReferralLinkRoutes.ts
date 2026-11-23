import type {Express,Request,Response,RequestHandler} from "express";
import {pool} from "../db";
import {normalizedReferralName,normalizedReferralPhone} from "./vipEngagementRules";
import {newReferralCode,validReferralCode} from "./vipReferralLinkRules";

const originGuard:RequestHandler=(req,res,next)=>{
 if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
 try{
  const origin=req.get("Origin"),host=req.get("Host");
  if(!origin||!host||new URL(origin).host!==host)return res.status(403).json({error:"Same-origin request required"});
 }catch{return res.status(403).json({error:"Invalid origin"});}
 next();
};
function failed(res:Response){return res.status(503).json({error:"Referral link temporarily unavailable"});}
export function registerVipReferralLinkRoutes(app:Express,enabled:RequestHandler,auth:RequestHandler):void{
 app.get("/api/vip/referral-link",enabled,auth,async(_req:Request,res:Response)=>{
  try{
   const r=await pool.query(
    "SELECT l.code,l.is_active FROM vip_referral_links l "+
    "WHERE l.user_id=$1 AND EXISTS(SELECT 1 FROM vip_unit_access a "+
    "WHERE a.user_id=l.user_id AND a.access_role='owner' AND a.revoked_at IS NULL)",
    [res.locals.vipUser.id]);
   return res.json({link:r.rows[0]||null});
  }catch{return failed(res);}
 });
 app.post("/api/vip/referral-link",enabled,auth,originGuard,async(_req:Request,res:Response)=>{
  const userId=res.locals.vipUser.id;
  const db=await pool.connect().catch(()=>null);if(!db)return failed(res);
  try{
   await db.query("BEGIN");
   const u=await db.query("SELECT id FROM users WHERE id=$1 AND is_active=TRUE FOR UPDATE",[userId]);
   if(!u.rowCount){await db.query("ROLLBACK");return res.status(403).json({error:"Inactive account"});}
   const owned=await db.query(
    "SELECT 1 FROM vip_unit_access WHERE user_id=$1 AND access_role='owner' AND revoked_at IS NULL LIMIT 1",[userId]);
   if(!owned.rowCount){await db.query("ROLLBACK");return res.status(403).json({error:"Active VIP owner required"});}
   const existing=await db.query("SELECT code,is_active FROM vip_referral_links WHERE user_id=$1 FOR UPDATE",[userId]);
   if(existing.rowCount){
    await db.query("ROLLBACK");
    return res.json({link:existing.rows[0]});
   }
   const code=newReferralCode();
   await db.query("INSERT INTO vip_referral_links(user_id,code) VALUES($1,$2)",[userId,code]);
   await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) VALUES($1,'vip_referral_link_issued',$2::jsonb)",
    [userId,JSON.stringify({codeLast4:code.slice(-4)})]);
   await db.query("COMMIT");return res.status(201).json({link:{code,is_active:true}});
  }catch{await db.query("ROLLBACK").catch(()=>{});return failed(res);}
  finally{db.release();}
 });
 // A public shared link never reveals the referrer identity or any client data.
 app.get("/api/vip/referral-share/:code",enabled,async(req:Request,res:Response)=>{
  if(!validReferralCode(req.params.code))return res.json({valid:false});
  try{
   const found=await pool.query(
    "SELECT 1 FROM vip_referral_links l JOIN users u ON u.id=l.user_id "+
    "WHERE l.code=$1 AND l.is_active=TRUE AND u.is_active=TRUE "+
    "AND EXISTS(SELECT 1 FROM vip_unit_access a WHERE a.user_id=l.user_id "+
    "AND a.access_role='owner' AND a.revoked_at IS NULL)",[req.params.code]);
   return res.json({valid:found.rowCount===1});
  }catch{return failed(res);}
 });
 app.post("/api/vip/referral-share/:code",enabled,originGuard,async(req:Request,res:Response)=>{
  const code=req.params.code;
  const name=normalizedReferralName(req.body?.name),phone=normalizedReferralPhone(req.body?.phoneE164);
  if(!validReferralCode(code)||!name||!phone||req.body?.consent!==true){
   return res.status(400).json({error:"Valid contact details and informed consent required"});
  }
  const db=await pool.connect().catch(()=>null);
  if(!db)return failed(res);
  try{
   await db.query("BEGIN");
   const link=await db.query(
    "SELECT l.user_id FROM vip_referral_links l JOIN users u ON u.id=l.user_id "+
    "WHERE l.code=$1 AND l.is_active=TRUE AND u.is_active=TRUE FOR UPDATE OF l",[code]);
   if(!link.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Link no longer available"});}
   const ownerId=Number(link.rows[0].user_id);
   const access=await db.query("SELECT 1 FROM vip_unit_access WHERE user_id=$1 "+
    "AND access_role='owner' AND revoked_at IS NULL LIMIT 1",[ownerId]);
   if(!access.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Link no longer available"});}
   const rate=await db.query("SELECT COUNT(*)::int AS n FROM vip_referrals WHERE referrer_user_id=$1 "+
    "AND created_at>NOW()-INTERVAL '24 hours'",[ownerId]);
   if(Number(rate.rows[0].n)>=3){await db.query("ROLLBACK");return res.status(429).json({error:"Referral limit reached"});}
   const r=await db.query(
    "INSERT INTO vip_referrals(referrer_user_id,lead_name,lead_phone_e164,contact_consent,consented_at,source) "+
    "VALUES($1,$2,$3,TRUE,NOW(),'share_link') RETURNING id::text AS id",
    [ownerId,name,phone]);
   await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) "+
    "VALUES($1,'vip_referral_link_submitted',$2::jsonb)",
    [ownerId,JSON.stringify({referralId:r.rows[0].id,source:"share_link",consent:true})]);
   await db.query("COMMIT");
   return res.status(201).json({submitted:true});
  }catch(e){
   await db.query("ROLLBACK").catch(()=>{});
   return res.status((e as {code?:string}).code==="23505"?409:503)
    .json({error:"Contact was already submitted or referral service unavailable"});
  }finally{db.release();}
 });
}
