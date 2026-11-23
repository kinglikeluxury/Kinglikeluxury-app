import type {Express,Request,Response,RequestHandler} from "express";
import pg from "pg";
import {pool as vipPool} from "../db";
import {crmVerifiedSaleInput,crmAssociationId,buyerEmailMatches} from "./vipCrmBridgeRules";

const {Pool}=pg;
// CRM is read-only and its credentials must be a separately granted SELECT-only
// user. No NEON_DATABASE_URL, DATABASE_URL or KAY_ANALYSIS_DATABASE_URL fallback.
// Never send data changes or mail through this bridge.
let crmReadPool:InstanceType<typeof Pool>|null=null;
function crmReader(){
 const value=process.env.KINGLIKE_VIP_CRM_READONLY_DATABASE_URL;
 if(!value)throw Error("VIP CRM read-only source not configured");
 const uri=new URL(value);
 if(!["postgres:","postgresql:"].includes(uri.protocol)||!uri.hostname||!uri.username||!uri.password){
  throw Error("VIP CRM read-only source invalid");
 }
 if(!crmReadPool)crmReadPool=new Pool({connectionString:value,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000});
 return crmReadPool;
}
type Lead={id:number;full_name:string|null;email:string|null;status:string|null;assigned_to:number|null};
async function fetchReadOnlyLead(id:number):Promise<Lead|null>{
 const db=await crmReader().connect();
 try{
  await db.query("BEGIN READ ONLY");
  const r=await db.query<Lead>(
   "SELECT id,full_name,email,status,assigned_to FROM crm_leads WHERE id=$1 LIMIT 1",[id]);
  await db.query("COMMIT");
  return r.rows[0]||null;
 }catch(e){await db.query("ROLLBACK").catch(()=>{});throw e}
 finally{db.release();}
}
const guardedJson:RequestHandler=(req,res,next)=>{
 if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
 try{
  if(!req.get("Origin")||!req.get("Host")||new URL(req.get("Origin")!).host!==req.get("Host"))
   return res.status(403).json({error:"Same-origin request required"});
 }catch{return res.status(403).json({error:"Invalid origin"});}
 next();
};
export function registerVipCrmBridgeRoutes(app:Express,enabled:RequestHandler,auth:RequestHandler,admin:RequestHandler):void{
 app.get("/api/admin/vip/crm/leads/:leadId",enabled,auth,admin,async(req:Request,res:Response)=>{
   const id=crmAssociationId(req.params.leadId);
   if(!id)return res.status(400).json({error:"Invalid lead ID"});
   try{
    const lead=await fetchReadOnlyLead(id);
    if(!lead)return res.status(404).json({error:"CRM lead not found"});
    return res.json({lead});
   }catch{return res.status(503).json({error:"Separate CRM read-only connection unavailable"});}
 });
 app.get("/api/admin/vip/crm-links",enabled,auth,admin,async(_req:Request,res:Response)=>{
   try{
    const result=await vipPool.query(
      "SELECT l.id::text AS id,l.unit_id::text AS unit_id,l.crm_lead_id,l.signed_sale_reference,"+
      "l.linked_at,l.linked_by::text AS linked_by,l.revoked_at,l.owner_user_id::text AS owner_user_id,"+
      "u.unit_number,p.name AS project_name,b.email AS buyer_email "+
      "FROM vip_crm_sale_links l JOIN vip_units u ON u.id=l.unit_id "+
      "JOIN vip_projects p ON p.id=u.project_id JOIN users b ON b.id=l.owner_user_id "+
      "ORDER BY l.linked_at DESC LIMIT 250");
    return res.json({links:result.rows});
   }catch{return res.status(503).json({error:"VIP CRM links unavailable"});}
 });
 app.post("/api/admin/vip/units/:unitId/crm-association",enabled,auth,admin,guardedJson,async(req:Request,res:Response)=>{
   const unitId=crmAssociationId(req.params.unitId),valid=crmVerifiedSaleInput.safeParse(req.body);
   if(!unitId||!valid.success)return res.status(400).json({error:"Signed contract and identity confirmation required"});
   const v=valid.data;
   let lead:Lead|null;
   try{lead=await fetchReadOnlyLead(v.leadId)}
   catch{return res.status(503).json({error:"CRM read-only connection must be configured before linking"});}
   if(!lead)return res.status(404).json({error:"CRM lead not found"});
   const db=await vipPool.connect().catch(()=>null);
   if(!db)return res.status(503).json({error:"VIP database unavailable"});
   try{
    await db.query("BEGIN");
    const unit=await db.query("SELECT id FROM vip_units WHERE id=$1 FOR UPDATE",[unitId]);
    if(!unit.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"VIP unit not found"});}
    const owner=await db.query(
      "SELECT a.user_id,u.email FROM vip_unit_access a JOIN users u ON u.id=a.user_id "+
      "WHERE a.unit_id=$1 AND a.access_role='owner' AND a.revoked_at IS NULL "+
      "AND u.is_active=TRUE AND u.is_verified=TRUE",[unitId]);
    if(owner.rowCount!==1){await db.query("ROLLBACK");return res.status(409).json({error:"Exactly one active verified buyer required"});}
    if(!buyerEmailMatches(lead.email,owner.rows[0].email)){
     await db.query("ROLLBACK");return res.status(409).json({error:"CRM lead email does not match the active buyer"});
    }
    const old=await db.query("SELECT id,crm_lead_id FROM vip_crm_sale_links "+
      "WHERE unit_id=$1 AND revoked_at IS NULL FOR UPDATE",[unitId]);
    if(old.rowCount&&Number(old.rows[0].crm_lead_id)===v.leadId){
      await db.query("ROLLBACK");return res.status(409).json({error:"This CRM lead is already linked to the unit"});
    }
    if(old.rowCount){
      await db.query("UPDATE vip_crm_sale_links SET revoked_at=NOW(),revoked_by=$2,revocation_reason=$3 "+
       "WHERE unit_id=$1 AND revoked_at IS NULL",[unitId,res.locals.vipUser.id,"Replaced after signed-contract verification: "+v.note]);
    }
    const inserted=await db.query(
      "INSERT INTO vip_crm_sale_links(unit_id,owner_user_id,crm_lead_id,signed_sale_reference,note,linked_by) "+
      "VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text AS id",
      [unitId,owner.rows[0].user_id,v.leadId,v.signedSaleReference,v.note,res.locals.vipUser.id]);
    await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
     "VALUES($1,'vip_crm_sale_link_verified',$2,$3::jsonb)",
     [res.locals.vipUser.id,unitId,JSON.stringify({linkId:inserted.rows[0].id,crmLeadId:v.leadId,
       oldCrmLeadId:old.rows[0]?.crm_lead_id||null,saleReference:v.signedSaleReference})]);
    await db.query("COMMIT");
    return res.status(201).json({link:inserted.rows[0],crmUpdated:false});
   }catch{await db.query("ROLLBACK").catch(()=>{});return res.status(503).json({error:"CRM association not saved"});}
   finally{db.release();}
 });
 app.delete("/api/admin/vip/crm-links/:linkId",enabled,auth,admin,guardedJson,async(req:Request,res:Response)=>{
  const id=crmAssociationId(req.params.linkId),reason=req.body?.reason;
  if(!id||typeof reason!=="string"||reason.trim().length<10||reason.length>350)
   return res.status(400).json({error:"Revocation reason of 10–350 characters required"});
  const db=await vipPool.connect().catch(()=>null);if(!db)return res.status(503).json({error:"Database unavailable"});
  try{
   await db.query("BEGIN");
   const link=await db.query("SELECT id,unit_id,crm_lead_id FROM vip_crm_sale_links "+
     "WHERE id=$1 AND revoked_at IS NULL FOR UPDATE",[id]);
   if(!link.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Link not found"});}
   await db.query("UPDATE vip_crm_sale_links SET revoked_at=NOW(),revoked_by=$2,revocation_reason=$3 WHERE id=$1",
    [id,res.locals.vipUser.id,reason.trim()]);
   await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
    "VALUES($1,'vip_crm_sale_link_revoked',$2,$3::jsonb)",
    [res.locals.vipUser.id,link.rows[0].unit_id,JSON.stringify({crmLeadId:link.rows[0].crm_lead_id,linkId:id,reason:reason.trim()})]);
   await db.query("COMMIT");return res.json({revoked:true,crmUpdated:false});
  }catch{await db.query("ROLLBACK").catch(()=>{});return res.status(503).json({error:"Could not revoke association"});}
  finally{db.release();}
 });
}
