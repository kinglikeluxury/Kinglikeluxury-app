import type {Express,Request,Response,RequestHandler} from "express";
import multer from "multer";
import {pool} from "../db";
import {financeAdjustmentInput,validDeveloperStatementUpload} from "./vipAccountingRules";
import {savePrivateOfficialStatement,readPrivateOfficialStatement,removePrivateOfficialStatement} from "./vipPrivateReceiptStorage";
import {normalizeReceiptName} from "./vipReceiptValidation";
import {positiveVipId} from "./vipExperienceRules";

const originGuard:RequestHandler=(req,res,next)=>{
 try{
  const origin=req.get("Origin"),host=req.get("Host");
  if(!origin||!host||new URL(origin).host!==host)return res.status(403).json({error:"Same-origin request required"});
 }catch{return res.status(403).json({error:"Invalid origin"});}
 next();
};
const jsonGuard:RequestHandler=(req,res,next)=>{
 if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
 next();
};
const upload=multer({storage:multer.memoryStorage(),
 limits:{fileSize:10*1024*1024,files:1,fields:3,fieldSize:500}}).single("statement");
const parseUpload:RequestHandler=(req,res,next)=>{
 upload(req,res,(err:unknown)=>{
  if(!err)return next();
  return res.status(err instanceof multer.MulterError&&err.code==="LIMIT_FILE_SIZE"?413:400)
   .json({error:"Statement PDF exceeds upload limit or is invalid"});
 });
};
const error=(res:Response)=>res.status(503).json({error:"Financial record unavailable"});
const financialQuery=
  "SELECT i.currency,COUNT(*)::int AS installment_count,SUM(i.amount)::text AS scheduled,"+
  "SUM(COALESCE(p.verified,0))::text AS verified_paid,"+
  "SUM(GREATEST(i.amount-COALESCE(p.verified,0),0))::text AS outstanding "+
  "FROM vip_installments i LEFT JOIN LATERAL "+
  "(SELECT SUM(x.amount) AS verified FROM vip_payment_postings x WHERE x.installment_id=i.id) p ON TRUE "+
  "WHERE i.unit_id=$1 GROUP BY i.currency ORDER BY i.currency";
const adjustmentColumns=
  "SELECT id::text AS id,category,amount::text AS amount,currency,description,"+
  "source,source_reference,published,created_at FROM vip_financial_adjustments WHERE unit_id=$1 ";
async function ownerAccess(unitId:number,userId:number):Promise<boolean>{
 const r=await pool.query(
  "SELECT 1 FROM vip_unit_access WHERE unit_id=$1 AND user_id=$2 "+
  "AND access_role='owner' AND revoked_at IS NULL LIMIT 1",[unitId,userId]);
 return r.rowCount===1;
}
export function registerVipAccountingRoutes(app:Express,enabled:RequestHandler,auth:RequestHandler,admin:RequestHandler):void{
 app.get("/api/vip/units/:unitId/account",enabled,auth,async(req:Request,res:Response)=>{
   const unitId=positiveVipId(req.params.unitId);
   if(!unitId)return res.status(404).json({error:"Unit not found"});
   try{
     if(!(await ownerAccess(unitId,res.locals.vipUser.id)))return res.status(404).json({error:"Unit not found"});
     const [totals,adjustments]=await Promise.all([
       pool.query(financialQuery,[unitId]),
       pool.query(adjustmentColumns+"AND published=TRUE AND voided_at IS NULL ORDER BY created_at DESC LIMIT 100",[unitId])
     ]);
     return res.json({totals:totals.rows,adjustments:adjustments.rows,official:false,
       note:"Based only on Kinglike-recorded installments and finance-verified receipts. Not a developer statement."});
   }catch{return error(res);}
 });
 app.get("/api/admin/vip/units/:unitId/account",enabled,auth,admin,async(req:Request,res:Response)=>{
   const unitId=positiveVipId(req.params.unitId);
   if(!unitId)return res.status(400).json({error:"Invalid unit"});
   try{
     const [totals,adjustments]=await Promise.all([
       pool.query(financialQuery,[unitId]),
       pool.query(adjustmentColumns+"AND voided_at IS NULL ORDER BY created_at DESC LIMIT 100",[unitId])
     ]);
     return res.json({totals:totals.rows,adjustments:adjustments.rows});
   }catch{return error(res);}
 });
 app.post("/api/admin/vip/units/:unitId/adjustments",enabled,auth,admin,originGuard,jsonGuard,async(req:Request,res:Response)=>{
   const unitId=positiveVipId(req.params.unitId),valid=financeAdjustmentInput.safeParse(req.body);
   if(!unitId||!valid.success)return res.status(400).json({error:"Invalid monetary adjustment or missing source"});
   const v=valid.data,db=await pool.connect().catch(()=>null);
   if(!db)return error(res);
   try{
     await db.query("BEGIN");
     const u=await db.query("SELECT id FROM vip_units WHERE id=$1 FOR UPDATE",[unitId]);
     if(!u.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Unit not found"});}
     const r=await db.query(
       "INSERT INTO vip_financial_adjustments(unit_id,category,amount,currency,description,source,source_reference,published,created_by) "+
       "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text AS id",
       [unitId,v.category,v.amount,v.currency,v.description,v.source,v.sourceReference||null,v.publish,res.locals.vipUser.id]);
     await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
       "VALUES($1,'vip_financial_adjustment_created',$2,$3::jsonb)",
       [res.locals.vipUser.id,unitId,JSON.stringify({adjustmentId:r.rows[0].id,category:v.category,amount:v.amount,currency:v.currency,published:v.publish})]);
     await db.query("COMMIT");return res.status(201).json({adjustment:r.rows[0]});
   }catch{await db.query("ROLLBACK").catch(()=>{});return error(res);}
   finally{db.release();}
 });
 app.patch("/api/admin/vip/adjustments/:adjustmentId",enabled,auth,admin,originGuard,jsonGuard,async(req:Request,res:Response)=>{
   const id=positiveVipId(req.params.adjustmentId),action=req.body?.action;
   if(!id||!["publish","hide","void"].includes(action))return res.status(400).json({error:"Invalid adjustment action"});
   const db=await pool.connect().catch(()=>null);
   if(!db)return error(res);
   try{
     await db.query("BEGIN");
     const row=await db.query("SELECT unit_id,source,source_reference,published,voided_at "+
       "FROM vip_financial_adjustments WHERE id=$1 FOR UPDATE",[id]);
     if(!row.rowCount||row.rows[0].voided_at){await db.query("ROLLBACK");return res.status(404).json({error:"Adjustment not found"});}
     const a=row.rows[0];
     if(action==="publish"&&(a.source==="internal_note"||!a.source_reference||a.source_reference.length<8)){
       await db.query("ROLLBACK");return res.status(409).json({error:"A documented external source is needed before publication"});
     }
     if(action==="void"){
       await db.query("UPDATE vip_financial_adjustments SET published=FALSE,voided_at=NOW(),voided_by=$2 WHERE id=$1",
         [id,res.locals.vipUser.id]);
     }else{
       await db.query("UPDATE vip_financial_adjustments SET published=$2 WHERE id=$1",
         [id,action==="publish"]);
     }
     await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
       "VALUES($1,'vip_financial_adjustment_visibility',$2,$3::jsonb)",
       [res.locals.vipUser.id,a.unit_id,JSON.stringify({adjustmentId:id,action})]);
     await db.query("COMMIT");return res.json({updated:true});
   }catch{await db.query("ROLLBACK").catch(()=>{});return error(res);}
   finally{db.release();}
 });
 app.post("/api/admin/vip/statement-requests/:id/document",enabled,auth,admin,originGuard,parseUpload,async(req:Request,res:Response)=>{
   const requestId=positiveVipId(req.params.id);
   const sourceNote=typeof req.body?.sourceNote==="string"?req.body.sourceNote.trim():"";
   if(!requestId||!req.file||req.body?.developerConfirmed!=="true"||
      sourceNote.length<8||sourceNote.length>200)return res.status(400).json({error:"Official developer PDF confirmation and source note required"});
   if(!validDeveloperStatementUpload(req.file.buffer))return res.status(415).json({error:"Only a valid PDF statement is allowed"});
   let objectPath:string|undefined;
   const db=await pool.connect().catch(()=>null);
   if(!db)return error(res);
   try{
     objectPath=await savePrivateOfficialStatement(req.file.buffer);
     await db.query("BEGIN");
     const r=await db.query(
       "SELECT s.id,s.unit_id,s.requested_by,s.status,s.official_document_id "+
       "FROM vip_statement_requests s WHERE s.id=$1 FOR UPDATE",[requestId]);
     if(!r.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Statement request not found"});}
     const v=r.rows[0];
     if(v.official_document_id||!["new","following_up","received"].includes(v.status)){
       await db.query("ROLLBACK");return res.status(409).json({error:"A document already exists or request is closed"});
     }
     const access=await db.query("SELECT 1 FROM vip_unit_access "+
       "WHERE unit_id=$1 AND user_id=$2 AND access_role='owner' AND revoked_at IS NULL",
       [v.unit_id,v.requested_by]);
     if(!access.rowCount){await db.query("ROLLBACK");return res.status(409).json({error:"Buyer no longer owns this VIP unit"});}
     const doc=await db.query(
       "INSERT INTO vip_private_documents(unit_id,owner_user_id,object_path,file_name,category,uploaded_by,source_note,mime_type,size_bytes) "+
       "VALUES($1,$2,$3,$4,'official_statement',$5,$6,'application/pdf',$7) RETURNING id",
       [v.unit_id,v.requested_by,objectPath,normalizeReceiptName(req.file.originalname),res.locals.vipUser.id,sourceNote,req.file.size]);
     await db.query("UPDATE vip_statement_requests SET status='available',official_document_id=$2,handled_by=$3 "+
       "WHERE id=$1",[requestId,doc.rows[0].id,res.locals.vipUser.id]);
     await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
       "VALUES($1,'vip_official_statement_attached',$2,$3::jsonb)",
       [res.locals.vipUser.id,v.unit_id,JSON.stringify({requestId,documentId:doc.rows[0].id})]);
     await db.query(
       "INSERT INTO vip_notifications(user_id,unit_id,event_type,title,body,source_key,payload,created_by) "+
       "VALUES($1,$2,'statement_ready','Official developer statement available',"+
       "'Your requested official developer statement is ready to download.',"+
       "$3,$4::jsonb,$5) ON CONFLICT DO NOTHING",
       [v.requested_by,v.unit_id,"statement:"+requestId,JSON.stringify({requestId}),res.locals.vipUser.id]
     );
     await db.query("COMMIT");objectPath=undefined;
     return res.status(201).json({available:true});
   }catch{
     await db.query("ROLLBACK").catch(()=>{});
     return error(res);
   }finally{
     db.release();
     if(objectPath)await removePrivateOfficialStatement(objectPath).catch(()=>{});
   }
 });
 app.get("/api/vip/statements/:requestId/download",enabled,auth,async(req:Request,res:Response)=>{
   const requestId=positiveVipId(req.params.requestId);
   if(!requestId)return res.status(404).json({error:"Document not found"});
   try{
     const r=await pool.query(
       "SELECT d.object_path,s.month_start::text AS month_start FROM vip_statement_requests s "+
       "JOIN vip_private_documents d ON d.id=s.official_document_id "+
       "JOIN vip_unit_access a ON a.unit_id=s.unit_id "+
       "AND a.user_id=$2 AND a.access_role='owner' AND a.revoked_at IS NULL "+
       "WHERE s.id=$1 AND s.requested_by=$2 AND s.status='available' "+
       "AND d.owner_user_id=$2 AND d.unit_id=s.unit_id AND d.category='official_statement' LIMIT 1",
       [requestId,res.locals.vipUser.id]);
     if(!r.rowCount)return res.status(404).json({error:"Document not found"});
     const data=await readPrivateOfficialStatement(r.rows[0].object_path);
     const date=String(r.rows[0].month_start).slice(0,7);
     res.setHeader("Content-Type","application/pdf");
     res.setHeader("Content-Disposition",'attachment; filename="developer-statement-'+date+'.pdf"');
     res.setHeader("Cache-Control","private, no-store");
     res.setHeader("X-Content-Type-Options","nosniff");
     res.setHeader("Cross-Origin-Resource-Policy","same-origin");
     return res.end(data);
   }catch{return error(res);}
 });
}
