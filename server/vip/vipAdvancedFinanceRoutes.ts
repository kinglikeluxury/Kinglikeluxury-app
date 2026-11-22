import type {Express,Request,Response,RequestHandler} from "express";
import {pool} from "../db";
import {fxRateInput,internalCommissionInput,internalCommissionAction} from "./vipAdvancedFinanceRules";
import {positiveVipId} from "./vipExperienceRules";

const originJson:RequestHandler=(req,res,next)=>{
 if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
 try{
  if(!req.get("Origin")||!req.get("Host")||new URL(req.get("Origin")!).host!==req.get("Host"))
   return res.status(403).json({error:"Same-origin request required"});
 }catch{return res.status(403).json({error:"Invalid origin"});}
 next();
};
const unavailable=(res:Response)=>res.status(503).json({error:"Advanced finance unavailable"});
const requireFinance:RequestHandler=async(_req,res,next)=>{
 try{
  const r=await pool.query("SELECT 1 FROM vip_finance_permissions f JOIN users u ON u.id=f.user_id "+
   "WHERE f.user_id=$1 AND f.can_approve=TRUE AND u.is_active=TRUE AND u.is_verified=TRUE LIMIT 1",
    [res.locals.vipUser.id]);
  if(!r.rowCount)return res.status(403).json({error:"Finance approval permission required"});
  next();
 }catch{return unavailable(res);}
};

export function registerVipAdvancedFinanceRoutes(app:Express,enabled:RequestHandler,auth:RequestHandler,admin:RequestHandler):void{
 app.get("/api/vip/fx-rates",enabled,auth,async(_req:Request,res:Response)=>{
  try{
   const r=await pool.query("SELECT 1 FROM vip_unit_access WHERE user_id=$1 AND access_role='owner' AND revoked_at IS NULL LIMIT 1",
     [res.locals.vipUser.id]);
   if(!r.rowCount)return res.status(403).json({error:"VIP membership required"});
   const result=await pool.query(
    "SELECT base_currency,quote_currency,rate::text AS rate,effective_date::text AS effective_date,"+
    "source,source_reference FROM vip_exchange_rates WHERE published=TRUE "+
    "ORDER BY effective_date DESC,created_at DESC LIMIT 60");
   return res.json({rates:result.rows,disclaimer:"Reference-only; figures are not recalculated into another currency."});
  }catch{return unavailable(res);}
 });
 app.get("/api/admin/vip/fx-rates",enabled,auth,admin,async(_req:Request,res:Response)=>{
  try{
   const r=await pool.query("SELECT id::text AS id,base_currency,quote_currency,rate::text AS rate,"+
    "effective_date::text AS effective_date,source,source_reference,published,created_at "+
    "FROM vip_exchange_rates ORDER BY effective_date DESC,created_at DESC LIMIT 200");
   return res.json({rates:r.rows});
  }catch{return unavailable(res);}
 });
 app.post("/api/admin/vip/fx-rates",enabled,auth,admin,originJson,async(req:Request,res:Response)=>{
  const v=fxRateInput.safeParse(req.body);
  if(!v.success||v.data.published)return res.status(400).json({error:"Create an unpublished, sourced FX draft first"});
  const db=await pool.connect().catch(()=>null);if(!db)return unavailable(res);
  try{
   await db.query("BEGIN");
   const a=await db.query(
    "INSERT INTO vip_exchange_rates(base_currency,quote_currency,rate,effective_date,source,source_reference,created_by) "+
    "VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text AS id",
    [v.data.baseCurrency,v.data.quoteCurrency,v.data.rate,v.data.effectiveDate,v.data.source,v.data.sourceReference,res.locals.vipUser.id]);
   await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) VALUES($1,'vip_fx_draft_created',$2::jsonb)",
    [res.locals.vipUser.id,JSON.stringify({fxId:a.rows[0].id,currencyPair:v.data.baseCurrency+"/"+v.data.quoteCurrency,effectiveDate:v.data.effectiveDate})]);
   await db.query("COMMIT");return res.status(201).json({rate:a.rows[0]});
  }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res)}
  finally{db.release();}
 });
 app.post("/api/admin/vip/fx-rates/:id/approve",enabled,auth,admin,requireFinance,originJson,async(req:Request,res:Response)=>{
  const id=positiveVipId(req.params.id);
  if(!id||req.body?.attestOfficialSource!==true)return res.status(400).json({error:"Source attestation required"});
  const db=await pool.connect().catch(()=>null);if(!db)return unavailable(res);
  try{
   await db.query("BEGIN");
   const old=await db.query("SELECT created_by,published FROM vip_exchange_rates WHERE id=$1 FOR UPDATE",[id]);
   if(!old.rowCount||old.rows[0].published){await db.query("ROLLBACK");return res.status(409).json({error:"Rate not found or already approved"});}
   if(Number(old.rows[0].created_by)===res.locals.vipUser.id){
    await db.query("ROLLBACK");return res.status(403).json({error:"Creator cannot self-approve FX rate"});
   }
   await db.query("UPDATE vip_exchange_rates SET published=TRUE,approved_by=$2,approved_at=NOW() WHERE id=$1",
    [id,res.locals.vipUser.id]);
   await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) VALUES($1,'vip_fx_rate_approved',$2::jsonb)",
    [res.locals.vipUser.id,JSON.stringify({fxId:id})]);
   await db.query("COMMIT");return res.json({approved:true});
  }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res)}
  finally{db.release();}
 });
 app.get("/api/admin/vip/internal-commissions",enabled,auth,admin,async(req:Request,res:Response)=>{
  const unitId=req.query.unitId;
  if(unitId!==undefined&&!positiveVipId(unitId))return res.status(400).json({error:"Invalid unit"});
  try{
   const r=await pool.query(
    "SELECT c.id::text AS id,c.unit_id::text AS unit_id,c.side,c.category,"+
    "c.basis_amount::text AS basis_amount,c.percentage::text AS percentage,"+
    "c.fixed_amount::text AS fixed_amount,c.currency,c.payee_label,c.contract_reference,"+
    "c.note,c.status,c.created_at,c.approved_at,c.settled_at,"+
    "(CASE WHEN c.fixed_amount IS NOT NULL THEN c.fixed_amount "+
    "ELSE ROUND(c.basis_amount*c.percentage/100,2) END)::text AS estimated_amount "+
    "FROM vip_internal_commissions c WHERE ($1::bigint IS NULL OR c.unit_id=$1) "+
    "ORDER BY c.created_at DESC LIMIT 250",
    [unitId===undefined?null:Number(unitId)]);
   return res.json({commissions:r.rows});
  }catch{return unavailable(res);}
 });
 app.post("/api/admin/vip/internal-commissions",enabled,auth,admin,originJson,async(req:Request,res:Response)=>{
  const parsed=internalCommissionInput.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Invalid commission estimate"});
  const v=parsed.data;
  const db=await pool.connect().catch(()=>null);if(!db)return unavailable(res);
  try{
   await db.query("BEGIN");
   const u=await db.query("SELECT id FROM vip_units WHERE id=$1 FOR UPDATE",[v.unitId]);
   if(!u.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Unit not found"});}
   const row=await db.query(
    "INSERT INTO vip_internal_commissions(unit_id,side,category,basis_amount,percentage,fixed_amount,"+
    "currency,payee_label,contract_reference,note,created_by) "+
    "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id::text AS id",
    [v.unitId,v.side,v.category,v.basisAmount,v.percentage,v.fixedAmount,v.currency,v.payeeLabel,
     v.contractReference,v.note||null,res.locals.vipUser.id]);
   await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
    "VALUES($1,'vip_commission_drafted',$2,$3::jsonb)",
    [res.locals.vipUser.id,v.unitId,JSON.stringify({commissionId:row.rows[0].id,category:v.category})]);
   await db.query("COMMIT");return res.status(201).json({commission:row.rows[0]});
  }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res)}
  finally{db.release();}
 });
 app.patch("/api/admin/vip/internal-commissions/:id",enabled,auth,admin,requireFinance,originJson,async(req:Request,res:Response)=>{
  const id=positiveVipId(req.params.id),parsed=internalCommissionAction.safeParse(req.body);
  if(!id||!parsed.success)return res.status(400).json({error:"Invalid commission review action"});
  const v=parsed.data,db=await pool.connect().catch(()=>null);if(!db)return unavailable(res);
  try{
   await db.query("BEGIN");
   const item=await db.query("SELECT unit_id,status,created_by,approved_by "+
    "FROM vip_internal_commissions WHERE id=$1 FOR UPDATE",[id]);
   if(!item.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Commission not found"});}
   const old=item.rows[0];
   if(v.action==="approve"){
    if(old.status!=="draft"||Number(old.created_by)===res.locals.vipUser.id){
     await db.query("ROLLBACK");return res.status(409).json({error:"Separate finance reviewer required"});
    }
    await db.query("UPDATE vip_internal_commissions SET status='approved',approved_by=$2,approved_at=NOW() WHERE id=$1",
      [id,res.locals.vipUser.id]);
   }else if(v.action==="record_settlement"){
    if(old.status!=="approved"){
     await db.query("ROLLBACK");return res.status(409).json({error:"Approved commission required"});
    }
    await db.query("UPDATE vip_internal_commissions SET status='settled',settled_by=$2,"+
     "settled_at=NOW(),settlement_reference=$3 WHERE id=$1",
     [id,res.locals.vipUser.id,v.paymentReference]);
   }else{
    if(old.status==="settled"||old.status==="voided"){
     await db.query("ROLLBACK");return res.status(409).json({error:"Cannot void a recorded settlement"});
    }
    await db.query("UPDATE vip_internal_commissions SET status='voided',voided_by=$2,voided_at=NOW() WHERE id=$1",
      [id,res.locals.vipUser.id]);
   }
   await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
    "VALUES($1,'vip_commission_reviewed',$2,$3::jsonb)",
    [res.locals.vipUser.id,old.unit_id,JSON.stringify({commissionId:id,action:v.action,reason:v.note,settlementReference:v.paymentReference})]);
   await db.query("COMMIT");return res.json({updated:true});
  }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res)}
  finally{db.release();}
 });
}
