import type { Express,Request,Response,RequestHandler } from "express";
import {pool} from "../db";
import {isVipTier,newMembershipCode,validMembershipCode} from "./vipEngagementRules";

const originJson:RequestHandler=(req,res,next)=>{
  if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
  try {
    const origin=req.get("Origin"),host=req.get("Host");
    if(!origin||!host||new URL(origin).host!==host)return res.status(403).json({error:"Same-origin request required"});
  }catch{return res.status(403).json({error:"Invalid origin"});}
  next();
};
function positiveId(raw:unknown):number|null{
  if(typeof raw!=="string"||!/^[1-9]\d*$/.test(raw))return null;
  const n=Number(raw);return Number.isSafeInteger(n)?n:null;
}
async function isOwner(userId:number,conn=pool):Promise<boolean>{
  const result=await conn.query(
    "SELECT 1 FROM vip_unit_access a JOIN vip_units u ON u.id=a.unit_id "+
    "WHERE a.user_id=$1 AND a.access_role='owner' AND a.revoked_at IS NULL LIMIT 1",[userId]
  );
  return result.rowCount===1;
}
export function registerVipCardRoutes(app:Express,enabled:RequestHandler,authenticated:RequestHandler,adminOnly:RequestHandler):void {
  app.get("/api/vip/card",enabled,authenticated,async(_req:Request,res:Response)=>{
    const userId=res.locals.vipUser.id;
    try{
      if(!(await isOwner(userId)))return res.status(403).json({error:"Only active property owners may access VIP cards"});
      const r=await pool.query(
        "SELECT member_code,tier,is_active,created_at FROM vip_member_cards WHERE user_id=$1 LIMIT 1",[userId]);
      return res.json({card:r.rows[0]||null});
    }catch{return res.status(503).json({error:"Card unavailable"});}
  });
  app.post("/api/vip/card/issue",enabled,authenticated,originJson,async(_req:Request,res:Response)=>{
    const userId=res.locals.vipUser.id;
    const db=await pool.connect().catch(()=>null);
    if(!db)return res.status(503).json({error:"Card service unavailable"});
    try{
      await db.query("BEGIN");
      const user=await db.query("SELECT id FROM users WHERE id=$1 AND is_active=TRUE FOR UPDATE",[userId]);
      if(!user.rowCount||!(await isOwner(userId,db))){
        await db.query("ROLLBACK");return res.status(403).json({error:"Active ownership required"});
      }
      const existing=await db.query("SELECT member_code,is_active,tier FROM vip_member_cards WHERE user_id=$1",[userId]);
      if(existing.rowCount){
        await db.query("ROLLBACK");
        if(!existing.rows[0].is_active)return res.status(409).json({error:"Membership card was deactivated. Contact Kinglike management."});
        return res.json({card:existing.rows[0]});
      }
      const r=await db.query(
        "INSERT INTO vip_member_cards(user_id,member_code,tier) VALUES($1,$2,'VIP') "+
        "RETURNING member_code,tier,is_active,created_at",[userId,newMembershipCode()]);
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) VALUES($1,'vip_card_issued',$2::jsonb)",
        [userId,JSON.stringify({codeLast4:r.rows[0].member_code.slice(-4)})]);
      await db.query("COMMIT");
      return res.status(201).json({card:r.rows[0]});
    }catch{
      await db.query("ROLLBACK").catch(()=>{});
      return res.status(503).json({error:"Card could not be issued"});
    }finally{db.release();}
  });
  // Public verification intentionally exposes no name, contact details,
  // property, owner ID or purchase information. Card codes have 96 random bits.
  app.get("/api/vip/cards/verify",enabled,async(req:Request,res:Response)=>{
    const code=req.query.code;
    if(!validMembershipCode(code))return res.json({valid:false});
    try{
      const r=await pool.query(
        "SELECT c.tier FROM vip_member_cards c "+
        "JOIN users u ON u.id=c.user_id "+
        "WHERE c.member_code=$1 AND c.is_active=TRUE AND u.is_active=TRUE "+
        "AND EXISTS(SELECT 1 FROM vip_unit_access a WHERE a.user_id=c.user_id "+
        "AND a.access_role='owner' AND a.revoked_at IS NULL) LIMIT 1",[code]);
      return res.json(r.rowCount===1?{valid:true,tier:r.rows[0].tier}:{valid:false});
    }catch{return res.status(503).json({error:"Verification unavailable"});}
  });
  app.get("/api/admin/vip/cards",enabled,authenticated,adminOnly,async(_req:Request,res:Response)=>{
    try{
      const r=await pool.query(
        "SELECT c.user_id::text AS user_id,c.member_code,c.tier,c.is_active,c.created_at,u.email "+
        "FROM vip_member_cards c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC LIMIT 250");
      return res.json({cards:r.rows});
    }catch{return res.status(503).json({error:"Card registry unavailable"});}
  });
  app.patch("/api/admin/vip/cards/:userId",enabled,authenticated,adminOnly,originJson,async(req:Request,res:Response)=>{
    const userId=positiveId(req.params.userId);
    const tier=req.body?.tier,active=req.body?.isActive;
    if(!userId||!isVipTier(tier)||typeof active!=="boolean")return res.status(400).json({error:"Invalid card update"});
    const db=await pool.connect().catch(()=>null);
    if(!db)return res.status(503).json({error:"Card service unavailable"});
    try{
      await db.query("BEGIN");
      const prev=await db.query(
        "SELECT tier,is_active FROM vip_member_cards WHERE user_id=$1 FOR UPDATE",[userId]);
      if(!prev.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Card not found"});}
      if(!prev.rows[0].is_active && active){
        await db.query("ROLLBACK");return res.status(409).json({error:"Revoked cards cannot be silently reactivated"});
      }
      await db.query("UPDATE vip_member_cards SET tier=$2,is_active=$3,updated_by=$4,updated_at=NOW() "+
        "WHERE user_id=$1",[userId,tier,active,res.locals.vipUser.id]);
      await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) "+
        "VALUES($1,'vip_card_updated',$2::jsonb)",
        [res.locals.vipUser.id,JSON.stringify({targetUserId:userId,from:prev.rows[0],to:{tier,active}})]);
      await db.query("COMMIT");return res.json({saved:true});
    }catch{await db.query("ROLLBACK").catch(()=>{});return res.status(503).json({error:"Update failed"});}
    finally{db.release();}
  });
}
