import type {Express,Request,Response,RequestHandler} from "express";
import {pool} from "../db";
import {validSellerAccount,validSellerEmail,validSellerReason} from "./vipSellerRules";

const strictId=(value:unknown):number|null=>{
  if(typeof value!=="string"||!/^[1-9]\d*$/.test(value))return null;
  const n=Number(value);return Number.isSafeInteger(n)?n:null;
};
const sameOriginJson:RequestHandler=(req,res,next)=>{
  if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
  try{
    if(!req.get("Origin")||!req.get("Host")||
       new URL(req.get("Origin")!).host!==req.get("Host"))return res.status(403).json({error:"Same-origin request required"});
  }catch{return res.status(403).json({error:"Invalid origin"});}
  next();
};
const unavailable=(res:Response)=>res.status(503).json({error:"VIP seller access unavailable"});
// Re-check the employee's CURRENT role on every seller request. Revoking or
// downgrading the employee in the main application must immediately revoke
// their ability to view any VIP customer file, even if a stale assignment
// remains for audit purposes.
const requireActiveSeller:RequestHandler=async (_req,res,next)=>{
  try{
    const r=await pool.query(
      "SELECT is_active,is_verified,is_admin,role,email FROM users WHERE id=$1 LIMIT 1",
      [res.locals.vipUser.id]);
    if(r.rowCount!==1||!validSellerAccount(r.rows[0])){
      return req.params.unitId
        ? res.status(404).json({error:"Unit not found"})
        : res.status(403).json({error:"Active sales employee permission required"});
    }
    next();
  }catch{
    return unavailable(res);
  }
};

/**
 * Selling agent is an existing, verified staff account chosen by VIP admin.
 * All reads are strictly scoped by live per-unit entitlement and read-only.
 * No seller endpoint grants financial approval, upload, client administration
 * or entitlement management.
 */
export function registerVipSellerRoutes(app:Express,enabled:RequestHandler,authenticated:RequestHandler,adminOnly:RequestHandler):void{
  app.get("/api/vip/seller/units",enabled,authenticated,requireActiveSeller,async(_req:Request,res:Response)=>{
    try{
      const units=await pool.query(
        "SELECT u.id::text AS unit_id,u.unit_number,u.floor_number,"+
        "p.id::text AS project_id,p.name AS project_name,p.developer_name,"+
        "owner_usr.email AS owner_email "+
        "FROM vip_unit_access a "+
        "JOIN vip_units u ON u.id=a.unit_id "+
        "JOIN vip_projects p ON p.id=u.project_id "+
        "LEFT JOIN vip_unit_access owner_a ON owner_a.unit_id=u.id "+
          "AND owner_a.access_role='owner' AND owner_a.revoked_at IS NULL "+
        "LEFT JOIN users owner_usr ON owner_usr.id=owner_a.user_id "+
        "WHERE a.user_id=$1 AND a.access_role='seller' AND a.revoked_at IS NULL "+
        "AND EXISTS(SELECT 1 FROM vip_unit_access oa WHERE oa.unit_id=a.unit_id "+
           "AND oa.access_role='owner' AND oa.revoked_at IS NULL) "+
        "ORDER BY p.name,u.unit_number LIMIT 150",[res.locals.vipUser.id]);
      return res.json({units:units.rows});
    }catch{return unavailable(res);}
  });

  app.get("/api/vip/seller/units/:unitId",enabled,authenticated,requireActiveSeller,async(req:Request,res:Response)=>{
    const unitId=strictId(req.params.unitId);
    if(!unitId)return res.status(404).json({error:"Unit not found"});
    const sellerId=res.locals.vipUser.id;
    try{
      // Every sensitive query independently enforces the assigned seller
      // entitlement. Guessing or altering unitId cannot enumerate client data.
      const entitlement=
        "EXISTS(SELECT 1 FROM vip_unit_access a WHERE a.unit_id=$1 "+
        "AND a.user_id=$2 AND a.access_role='seller' AND a.revoked_at IS NULL) "+
        "AND EXISTS(SELECT 1 FROM vip_unit_access oa WHERE oa.unit_id=$1 "+
        "AND oa.access_role='owner' AND oa.revoked_at IS NULL)";
      const unit=await pool.query(
        "SELECT u.id::text AS unit_id,u.unit_number,u.floor_number,"+
        "p.id::text AS project_id,p.name AS project_name,p.developer_name,"+
        "ou.email AS owner_email "+
        "FROM vip_units u JOIN vip_projects p ON p.id=u.project_id "+
        "LEFT JOIN vip_unit_access oa ON oa.unit_id=u.id "+
           "AND oa.access_role='owner' AND oa.revoked_at IS NULL "+
        "LEFT JOIN users ou ON ou.id=oa.user_id "+
        "WHERE u.id=$1 AND "+entitlement+" LIMIT 1",[unitId,sellerId]);
      if(!unit.rowCount)return res.status(404).json({error:"Unit not found"});
      const [installments,receipts,statements,handover]=await Promise.all([
        pool.query(
          "SELECT i.id::text AS id,i.sequence_number,i.due_date::text AS due_date,"+
          "i.amount::text AS amount,i.currency,"+
          "COALESCE(SUM(post.amount),0)::text AS paid_amount,"+
          "GREATEST(i.amount-COALESCE(SUM(post.amount),0),0)::text AS remaining_amount "+
          "FROM vip_installments i LEFT JOIN vip_payment_postings post ON post.installment_id=i.id "+
          "WHERE i.unit_id=$1 AND "+entitlement+
          " GROUP BY i.id ORDER BY i.sequence_number LIMIT 500",[unitId,sellerId]),
        pool.query(
          "SELECT r.id::text AS id,r.file_name,r.review_status,r.upload_source,"+
          "r.created_at,i.sequence_number "+
          "FROM vip_receipts r JOIN vip_installments i ON i.id=r.installment_id "+
          "WHERE i.unit_id=$1 AND "+entitlement+
          " ORDER BY r.created_at DESC LIMIT 100",[unitId,sellerId]),
        pool.query(
          "SELECT s.id::text AS id,s.month_start::text AS month_start,s.status,s.created_at "+
          "FROM vip_statement_requests s WHERE s.unit_id=$1 AND "+entitlement+
          " ORDER BY s.created_at DESC LIMIT 24",[unitId,sellerId]),
        pool.query(
          "SELECT h.status,h.scheduled_at,h.updated_at FROM vip_handover h "+
          "WHERE h.unit_id=$1 AND "+entitlement+" LIMIT 1",[unitId,sellerId])
      ]);
      // All of the above are filtered to exactly this unit and current seller.
      return res.json({unit:unit.rows[0],installments:installments.rows,
        receipts:receipts.rows,statements:statements.rows,handover:handover.rows[0]||{status:"not_ready"}});
    }catch{return unavailable(res);}
  });

  app.get("/api/admin/vip/seller-assignments",enabled,authenticated,adminOnly,async(_req:Request,res:Response)=>{
    try{
      const result=await pool.query(
        "SELECT a.unit_id::text AS unit_id,a.user_id::text AS seller_user_id,"+
        "u.email AS seller_email,pr.name AS project_name,un.unit_number "+
        "FROM vip_unit_access a JOIN users u ON u.id=a.user_id "+
        "JOIN vip_units un ON un.id=a.unit_id JOIN vip_projects pr ON pr.id=un.project_id "+
        "WHERE a.access_role='seller' AND a.revoked_at IS NULL "+
        "ORDER BY pr.name,un.unit_number LIMIT 2000");
      return res.json({assignments:result.rows});
    }catch{return unavailable(res);}
  });

  app.put("/api/admin/vip/units/:unitId/seller",enabled,authenticated,adminOnly,sameOriginJson,async(req:Request,res:Response)=>{
    const unitId=strictId(req.params.unitId);
    const email=validSellerEmail(req.body?.email);
    const reason=req.body?.reason;
    if(!unitId||!email||!validSellerReason(reason))return res.status(400).json({error:"Valid staff email and reason of 10–240 characters required"});
    const db=await pool.connect().catch(()=>null);
    if(!db)return unavailable(res);
    try{
      await db.query("BEGIN");
      // Serialize all seller assignments for this unit under a parent row lock.
      const unit=await db.query("SELECT id FROM vip_units WHERE id=$1 FOR UPDATE",[unitId]);
      if(!unit.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Unit not found"});}
      const owner=await db.query(
        "SELECT 1 FROM vip_unit_access WHERE unit_id=$1 AND access_role='owner' AND revoked_at IS NULL LIMIT 1",[unitId]);
      if(!owner.rowCount){await db.query("ROLLBACK");return res.status(409).json({error:"Buyer must activate VIP ownership first"});}
      const result=await db.query(
        "SELECT id,role,email,is_active,is_verified,is_admin FROM users "+
        "WHERE lower(email)=$1 LIMIT 1",[email]);
      if(result.rowCount!==1||!validSellerAccount(result.rows[0])){
        await db.query("ROLLBACK");return res.status(403).json({error:"Verified active sales staff account required"});
      }
      const sellerId=Number(result.rows[0].id);
      const old=await db.query(
        "SELECT user_id FROM vip_unit_access WHERE unit_id=$1 "+
        "AND access_role='seller' AND revoked_at IS NULL FOR UPDATE",[unitId]);
      if(old.rowCount && Number(old.rows[0].user_id)===sellerId){
        await db.query("ROLLBACK");return res.status(409).json({error:"Seller is already assigned"});
      }
      const replaced=old.rows.length?Number(old.rows[0].user_id):null;
      if(old.rowCount){
        await db.query(
          "UPDATE vip_unit_access SET revoked_at=NOW() "+
          "WHERE unit_id=$1 AND access_role='seller' AND revoked_at IS NULL",[unitId]);
      }
      await db.query(
        "INSERT INTO vip_unit_access(unit_id,user_id,access_role,granted_by) "+
        "VALUES($1,$2,'seller',$3)",[unitId,sellerId,res.locals.vipUser.id]);
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
        "VALUES($1,$2,$3,$4::jsonb)",
        [res.locals.vipUser.id,replaced===null?"vip_seller_assigned":"vip_seller_reassigned",
          unitId,JSON.stringify({fromUserId:replaced,toUserId:sellerId,reason:reason.trim()})]);
      await db.query("COMMIT");
      return res.json({assigned:true,sellerUserId:String(sellerId),replacedUserId:replaced?String(replaced):null});
    }catch(e){
      await db.query("ROLLBACK").catch(()=>{});
      return res.status((e as {code?:string})?.code==="23505"?409:503).json({error:"Seller assignment failed"});
    }finally{db.release();}
  });

  app.delete("/api/admin/vip/units/:unitId/seller",enabled,authenticated,adminOnly,sameOriginJson,async(req:Request,res:Response)=>{
    const unitId=strictId(req.params.unitId);
    const reason=req.body?.reason;
    if(!unitId||!validSellerReason(reason))return res.status(400).json({error:"A reason of 10–240 characters is required"});
    const db=await pool.connect().catch(()=>null);
    if(!db)return unavailable(res);
    try{
      await db.query("BEGIN");
      const unit=await db.query("SELECT id FROM vip_units WHERE id=$1 FOR UPDATE",[unitId]);
      if(!unit.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Unit not found"});}
      const revoked=await db.query(
        "UPDATE vip_unit_access SET revoked_at=NOW() "+
        "WHERE unit_id=$1 AND access_role='seller' AND revoked_at IS NULL "+
        "RETURNING user_id",[unitId]);
      if(!revoked.rowCount){await db.query("ROLLBACK");return res.status(409).json({error:"No assigned seller"});}
      await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
        "VALUES($1,'vip_seller_revoked',$2,$3::jsonb)",
        [res.locals.vipUser.id,unitId,JSON.stringify({fromUserId:revoked.rows[0].user_id,reason:reason.trim()})]);
      await db.query("COMMIT");
      return res.json({revoked:true});
    }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res);}
    finally{db.release();}
  });
}
