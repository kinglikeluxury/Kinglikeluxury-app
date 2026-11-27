import type {Express,Request,Response,RequestHandler} from "express";
import {pool} from "../db";
import {positiveVipId} from "./vipExperienceRules";
import {approveHandoverInput,buyerKeysAcknowledgmentInput,confirmKeysInput,canApproveHandover} from "./vipKeyReceiptRules";

const originJson:RequestHandler=(req,res,next)=>{
 if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
 try{
  if(!req.get("Origin")||!req.get("Host")||
    new URL(req.get("Origin")!).host!==req.get("Host"))return res.status(403).json({error:"Same-origin request required"});
 }catch{return res.status(403).json({error:"Invalid origin"});}
 next();
};
function unavailable(res:Response){return res.status(503).json({error:"Handover key receipt unavailable"});}
async function ownerOf(unitId:number,userId:number){
 const x=await pool.query("SELECT 1 FROM vip_unit_access a JOIN users u ON u.id=a.user_id "+
   "WHERE a.unit_id=$1 AND a.user_id=$2 AND a.access_role='owner' "+
   "AND a.revoked_at IS NULL AND u.is_active=TRUE LIMIT 1",[unitId,userId]);
 return x.rowCount===1;
}
const keySelect="SELECT unit_id::text AS unit_id,owner_user_id::text AS owner_user_id,"+
 "developer_handover_reference,approved_at,approval_note,"+
 "received_keys_count,received_date::text AS received_date,buyer_acknowledged_at,"+
 "buyer_note,delivered_at,key_delivery_reference,delivery_note "+
 "FROM vip_handover_key_receipts WHERE unit_id=$1";

export function registerVipKeyReceiptRoutes(app:Express,enabled:RequestHandler,auth:RequestHandler,admin:RequestHandler):void{
 app.get("/api/vip/units/:unitId/keys",enabled,auth,async(req:Request,res:Response)=>{
   const unitId=positiveVipId(req.params.unitId);
   if(!unitId)return res.status(404).json({error:"Unit not found"});
   try{
     if(!(await ownerOf(unitId,res.locals.vipUser.id)))return res.status(404).json({error:"Unit not found"});
     const r=await pool.query(keySelect+" AND owner_user_id=$2",[unitId,res.locals.vipUser.id]);
     return res.json({handover:r.rows[0]||null});
   }catch{return unavailable(res);}
 });
 app.get("/api/admin/vip/units/:unitId/keys",enabled,auth,admin,async(req:Request,res:Response)=>{
   const unitId=positiveVipId(req.params.unitId);
   if(!unitId)return res.status(400).json({error:"Invalid unit"});
   try{
     const r=await pool.query(keySelect,[unitId]);
     return res.json({handover:r.rows[0]||null});
   }catch{return unavailable(res);}
 });
 app.post("/api/admin/vip/units/:unitId/handover/approve",enabled,auth,admin,originJson,async(req:Request,res:Response)=>{
   const unitId=positiveVipId(req.params.unitId);
   const data=approveHandoverInput.safeParse(req.body);
   if(!unitId||!data.success)return res.status(400).json({error:"Developer reference, inspection notes and confirmation required"});
   const db=await pool.connect().catch(()=>null);if(!db)return unavailable(res);
   try{
     await db.query("BEGIN");
     const h=await db.query("SELECT status,checklist FROM vip_handover WHERE unit_id=$1 FOR UPDATE",[unitId]);
     if(!h.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Handover not found"});}
     const open=(await db.query("SELECT COUNT(*)::int AS n FROM vip_handover_snags "+
      "WHERE unit_id=$1 AND status='open'",[unitId])).rows[0].n;
     if(!canApproveHandover(h.rows[0].status,Number(open),h.rows[0].checklist||{})){
       await db.query("ROLLBACK");return res.status(409).json({error:"All inspection checks must pass and all issues must be resolved"});
     }
     const owner=await db.query(
       "SELECT a.user_id FROM vip_unit_access a JOIN users u ON u.id=a.user_id "+
       "WHERE a.unit_id=$1 AND a.access_role='owner' AND a.revoked_at IS NULL "+
       "AND u.is_active=TRUE",[unitId]);
     if(owner.rowCount!==1){await db.query("ROLLBACK");return res.status(409).json({error:"Exactly one active owner required"});}
     await db.query(
       "INSERT INTO vip_handover_key_receipts(unit_id,owner_user_id,developer_handover_reference,approved_by,approval_note) "+
       "VALUES($1,$2,$3,$4,$5)",
       [unitId,owner.rows[0].user_id,data.data.developerReference,data.data.acknowledgedNoOpenSnags?res.locals.vipUser.id:null,data.data.note]
     );
     await db.query("UPDATE vip_handover SET status='handover_approved',updated_by=$2,updated_at=NOW() WHERE unit_id=$1",
       [unitId,res.locals.vipUser.id]);
     await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
       "VALUES($1,'vip_handover_approved',$2,$3::jsonb)",
       [res.locals.vipUser.id,unitId,JSON.stringify({developerReference:data.data.developerReference})]);
     await db.query("COMMIT");return res.json({approved:true});
   }catch(e){await db.query("ROLLBACK").catch(()=>{});return res.status((e as {code?:string}).code==="23505"?409:503).json({error:"Handover approval failed"});}
   finally{db.release();}
 });
 app.post("/api/vip/units/:unitId/keys/acknowledge",enabled,auth,originJson,async(req:Request,res:Response)=>{
   const unitId=positiveVipId(req.params.unitId);
   const data=buyerKeysAcknowledgmentInput.safeParse(req.body);
   if(!unitId||!data.success)return res.status(400).json({error:"Keys, count and actual receipt date required"});
   const db=await pool.connect().catch(()=>null);if(!db)return unavailable(res);
   try{
     await db.query("BEGIN");
     const h=await db.query("SELECT status FROM vip_handover WHERE unit_id=$1 FOR UPDATE",[unitId]);
     if(!h.rowCount||h.rows[0].status!=="handover_approved"){
       await db.query("ROLLBACK");return res.status(409).json({error:"Handover not approved yet"});
     }
     const owner=await db.query("SELECT 1 FROM vip_unit_access a JOIN users u ON u.id=a.user_id "+
       "WHERE a.unit_id=$1 AND a.user_id=$2 AND a.access_role='owner' "+
       "AND a.revoked_at IS NULL AND u.is_active=TRUE FOR SHARE OF a",[unitId,res.locals.vipUser.id]);
     if(!owner.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Unit not found"});}
     const record=await db.query("SELECT owner_user_id,buyer_acknowledged_at, (approved_at AT TIME ZONE 'Asia/Tbilisi')::date::text AS approved_date "+
       "FROM vip_handover_key_receipts WHERE unit_id=$1 FOR UPDATE",[unitId]);
     if(!record.rowCount||Number(record.rows[0].owner_user_id)!==res.locals.vipUser.id||record.rows[0].buyer_acknowledged_at){
       await db.query("ROLLBACK");return res.status(409).json({error:"Key receipt already recorded or owner changed"});
     }
     const today=(await db.query("SELECT (NOW() AT TIME ZONE 'Asia/Tbilisi')::date::text AS today")).rows[0].today;
     if(data.data.receivedDate>today || data.data.receivedDate<String(record.rows[0].approved_date)){
       await db.query("ROLLBACK");return res.status(400).json({error:"Receipt date cannot be in the future or before handover approval"});
     }
     await db.query("UPDATE vip_handover_key_receipts SET "+
       "received_keys_count=$2,received_date=$3,buyer_acknowledged_at=NOW(),buyer_note=$4 "+
       "WHERE unit_id=$1",
       [unitId,data.data.keyCount,data.data.receivedDate,data.data.note||null]);
     await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
       "VALUES($1,'vip_keys_receipt_acknowledged',$2,$3::jsonb)",
       [res.locals.vipUser.id,unitId,JSON.stringify({keyCount:data.data.keyCount,date:data.data.receivedDate})]);
     await db.query("COMMIT");return res.json({acknowledged:true});
   }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res);}
   finally{db.release();}
 });
 app.post("/api/admin/vip/units/:unitId/keys/confirm",enabled,auth,admin,originJson,async(req:Request,res:Response)=>{
   const unitId=positiveVipId(req.params.unitId);
   const data=confirmKeysInput.safeParse(req.body);
   if(!unitId||!data.success)return res.status(400).json({error:"Physical delivery evidence and confirmation required"});
   const db=await pool.connect().catch(()=>null);if(!db)return unavailable(res);
   try{
     await db.query("BEGIN");
     const h=await db.query("SELECT status FROM vip_handover WHERE unit_id=$1 FOR UPDATE",[unitId]);
     if(!h.rowCount||h.rows[0].status!=="handover_approved"){
       await db.query("ROLLBACK");return res.status(409).json({error:"Key handover cannot be confirmed from this stage"});
     }
     const r=await db.query(
       "SELECT k.owner_user_id,k.buyer_acknowledged_at,k.delivered_at FROM vip_handover_key_receipts k "+
       "WHERE k.unit_id=$1 FOR UPDATE",[unitId]);
     if(!r.rowCount||!r.rows[0].buyer_acknowledged_at||r.rows[0].delivered_at){
       await db.query("ROLLBACK");return res.status(409).json({error:"Buyer receipt confirmation is required first"});
     }
     const owner=await db.query("SELECT 1 FROM vip_unit_access a JOIN users u ON u.id=a.user_id "+
       "WHERE a.unit_id=$1 AND a.user_id=$2 AND a.access_role='owner' "+
       "AND a.revoked_at IS NULL AND u.is_active=TRUE",[unitId,r.rows[0].owner_user_id]);
     if(!owner.rowCount){await db.query("ROLLBACK");return res.status(409).json({error:"Owner changed; cannot confirm original receipt"});}
     await db.query("UPDATE vip_handover_key_receipts SET delivered_by=$2,delivered_at=NOW(),"+
       "key_delivery_reference=$3,delivery_note=$4 WHERE unit_id=$1",
       [unitId,res.locals.vipUser.id,data.data.developerReference,data.data.note]);
     await db.query("UPDATE vip_handover SET status='keys_delivered',updated_by=$2,updated_at=NOW() WHERE unit_id=$1",
       [unitId,res.locals.vipUser.id]);
     await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
       "VALUES($1,'vip_keys_delivered',$2,$3::jsonb)",
       [res.locals.vipUser.id,unitId,JSON.stringify({developerReference:data.data.developerReference})]);
     await db.query("COMMIT");return res.json({delivered:true});
   }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res);}
   finally{db.release();}
 });
}
