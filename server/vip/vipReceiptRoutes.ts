import type { Express, Request, Response, RequestHandler } from "express";
import multer from "multer";
import { pool } from "../db";
import { inspectReceiptFile, normalizeReceiptName, amountToCents, centsToAmount, MAX_VIP_RECEIPT_BYTES } from "./vipReceiptValidation";
import { savePrivateReceipt, readPrivateReceipt, removePrivateReceipt } from "./vipPrivateReceiptStorage";

const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIP_RECEIPT_BYTES, files: 1, fields: 3, fieldSize: 512 },
}).single("receipt");

function positiveId(raw: unknown): number | null {
  const str = typeof raw === "number" ? String(raw) : raw;
  if (typeof str !== "string" || !/^[1-9]\d*$/.test(str)) return null;
  const value = Number(str);
  return Number.isSafeInteger(value) ? value : null;
}

const originGuard: RequestHandler = (req, res, next) => {
  const origin = req.get("Origin");
  const host = req.get("Host");
  try {
    if (!origin || !host || new URL(origin).host !== host) {
      return res.status(403).json({error:"Same-origin request required"});
    }
  } catch {
    return res.status(403).json({error:"Invalid Origin"});
  }
  next();
};
const uploadMiddleware: RequestHandler = (req, res, next) => {
  receiptUpload(req,res,(err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({error:"Receipt exceeds 10 MB"});
    }
    return res.status(400).json({error:"Invalid receipt upload"});
  });
};

async function hasOwnerAccess(unitId:number, userId:number) {
  const r=await pool.query(
    "SELECT 1 FROM vip_unit_access WHERE unit_id=$1 AND user_id=$2 " +
    "AND access_role='owner' AND revoked_at IS NULL LIMIT 1",
    [unitId,userId]
  );
  return r.rowCount===1;
}
async function isFinanceApprover(userId:number):Promise<boolean> {
  const r=await pool.query(
    "SELECT 1 FROM vip_finance_permissions v JOIN users u ON u.id=v.user_id " +
    "WHERE v.user_id=$1 AND v.can_approve=TRUE AND u.is_active=TRUE AND u.is_verified=TRUE LIMIT 1",
    [userId]
  );
  return r.rowCount===1;
}
const requireFinance:RequestHandler=async (_req,res,next)=>{
  try {
    if (!(await isFinanceApprover(res.locals.vipUser.id))) {
      return res.status(403).json({error:"Finance verification permission required"});
    }
    next();
  } catch {
    res.status(503).json({error:"Finance permission unavailable"});
  }
};

export function registerVipReceiptRoutes(
  app:Express,
  enabled:RequestHandler,
  authenticated:RequestHandler,
  adminOnly:RequestHandler,
):void {
  // The client can only upload to an installment on their currently owned unit.
  // The Kinglike admin can upload on the client's behalf and select the source.
  app.post("/api/vip/installments/:installmentId/receipts",
    enabled,authenticated,originGuard,uploadMiddleware,async (req:Request,res:Response)=>{
      const installmentId=positiveId(req.params.installmentId);
      if(!installmentId || !req.file) return res.status(400).json({error:"Receipt file and installment required"});
      const fileKind=inspectReceiptFile(req.file.buffer);
      if(!fileKind)return res.status(415).json({error:"Only valid PDF, JPEG or PNG receipts are accepted"});
      const actor=res.locals.vipUser as {id:number;isAdmin:boolean};
      const sourceRaw=req.body?.source;
      const source=actor.isAdmin?sourceRaw:"client";
      if ((actor.isAdmin && !["admin","email","whatsapp"].includes(source)) ||
          (!actor.isAdmin && sourceRaw && sourceRaw !== "client")) {
        return res.status(400).json({error:"Invalid receipt source"});
      }
      let objectPath:string|undefined;
      try {
        const installment=await pool.query(
          "SELECT id,unit_id FROM vip_installments WHERE id=$1 LIMIT 1",[installmentId]
        );
        if(installment.rowCount!==1)return res.status(404).json({error:"Installment not found"});
        const unitId=Number(installment.rows[0].unit_id);
        if(!actor.isAdmin && !(await hasOwnerAccess(unitId,actor.id))) {
          return res.status(404).json({error:"Installment not found"});
        }
        objectPath=await savePrivateReceipt(req.file.buffer,fileKind.mime,fileKind.extension);
        const db=await pool.connect();
        try {
          await db.query("BEGIN");
          if(!actor.isAdmin) {
            const active=await db.query(
              "SELECT 1 FROM vip_unit_access WHERE unit_id=$1 AND user_id=$2 " +
              "AND access_role='owner' AND revoked_at IS NULL FOR SHARE",
              [unitId,actor.id]
            );
            if(active.rowCount!==1)throw Error("ACCESS_REVOKED");
          }
          const inserted=await db.query(
            "INSERT INTO vip_receipts(installment_id,object_path,file_name,mime_type,size_bytes,uploaded_by,upload_source) " +
            "VALUES($1,$2,$3,$4,$5,$6,$7) " +
            "RETURNING id::text AS id,review_status,created_at",
            [installmentId,objectPath,normalizeReceiptName(req.file.originalname),fileKind.mime,req.file.size,actor.id,source]
          );
          await db.query(
            "INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) " +
            "VALUES($1,'receipt_uploaded',$2,$3::jsonb)",
            [actor.id,unitId,JSON.stringify({receiptId:inserted.rows[0].id,installmentId,source,bytes:req.file.size})]
          );
          await db.query("COMMIT");
          return res.status(201).json({receipt:inserted.rows[0]});
        } catch(e) {
          await db.query("ROLLBACK").catch(()=>{});
          throw e;
        } finally {db.release();}
      } catch {
        if(objectPath)await removePrivateReceipt(objectPath).catch(()=>{});
        return res.status(503).json({error:"Receipt could not be saved. No payment has been confirmed."});
      }
    }
  );

  app.get("/api/vip/units/:unitId/receipts",enabled,authenticated,async (req:Request,res:Response)=>{
    const unitId=positiveId(req.params.unitId);
    if(!unitId)return res.status(404).json({error:"Unit not found"});
    const userId=res.locals.vipUser.id;
    try {
      if(!(await hasOwnerAccess(unitId,userId)))return res.status(404).json({error:"Unit not found"});
      const data=await pool.query(
        "SELECT r.id::text AS id,i.id::text AS installment_id,r.file_name,r.upload_source,r.review_status,r.created_at," +
        "r.reviewed_at,r.review_note, uploader.username AS uploaded_by_name " +
        "FROM vip_receipts r JOIN vip_installments i ON i.id=r.installment_id " +
        "JOIN users uploader ON uploader.id=r.uploaded_by " +
        "WHERE i.unit_id=$1 ORDER BY r.created_at DESC LIMIT 250",
        [unitId]
      );
      return res.json({receipts:data.rows});
    } catch {
      return res.status(503).json({error:"Receipts unavailable"});
    }
  });

  app.get("/api/admin/vip/receipts",enabled,authenticated,async (_req:Request,res:Response)=>{
    const actor=res.locals.vipUser as {id:number;isAdmin:boolean};
    try {
      if(!actor.isAdmin && !(await isFinanceApprover(actor.id))) {
        return res.status(403).json({error:"Restricted"});
      }
      const r=await pool.query(
        "SELECT r.id::text AS id,r.file_name,r.upload_source,r.review_status,r.created_at, " +
        "r.reviewed_at,r.review_note,r.uploaded_by, u.username AS uploaded_by_name, " +
        "i.id::text AS installment_id, i.unit_id::text AS unit_id, i.due_date::text AS due_date," +
        "i.amount::text AS installment_amount,i.currency,n.unit_number,p.name AS project_name " +
        "FROM vip_receipts r JOIN users u ON u.id=r.uploaded_by " +
        "JOIN vip_installments i ON i.id=r.installment_id " +
        "JOIN vip_units n ON n.id=i.unit_id JOIN vip_projects p ON p.id=n.project_id " +
        "ORDER BY r.created_at DESC LIMIT 250"
      );
      return res.json({receipts:r.rows});
    } catch { return res.status(503).json({error:"Receipts unavailable"}); }
  });

  app.get("/api/vip/receipts/:receiptId/download",enabled,authenticated,async (req:Request,res:Response)=>{
    const receiptId=positiveId(req.params.receiptId);
    if(!receiptId)return res.status(404).json({error:"Receipt not found"});
    const actor=res.locals.vipUser as {id:number;isAdmin:boolean};
    try {
      const {rows}=await pool.query(
        "SELECT r.object_path,r.file_name,r.mime_type,i.unit_id " +
        "FROM vip_receipts r JOIN vip_installments i ON i.id=r.installment_id WHERE r.id=$1 LIMIT 1",
        [receiptId]
      );
      if(rows.length===0)return res.status(404).json({error:"Receipt not found"});
      const {object_path,file_name,mime_type,unit_id}=rows[0];
      const access=await pool.query(
        "SELECT 1 FROM vip_unit_access WHERE user_id=$1 AND unit_id=$2 " +
        "AND access_role IN ('owner','seller') AND revoked_at IS NULL LIMIT 1",
        [actor.id,unit_id]
      );
      if(!actor.isAdmin && access.rowCount!==1 && !(await isFinanceApprover(actor.id))) {
        return res.status(404).json({error:"Receipt not found"});
      }
      const file=await readPrivateReceipt(object_path);
      res.setHeader("Cache-Control","private, no-store");
      res.setHeader("X-Content-Type-Options","nosniff");
      res.setHeader("Content-Type",mime_type);
      res.setHeader("Content-Disposition",
        "attachment; filename=\"receipt\"; filename*=UTF-8''"+encodeURIComponent(file_name));
      res.setHeader("Content-Length",String(file.length));
      return res.status(200).end(file);
    } catch {
      return res.status(503).json({error:"Receipt unavailable"});
    }
  });

  // Finance status is read live from the dedicated permission table.
  app.get("/api/admin/vip/finance/me",enabled,authenticated,async (_req:Request,res:Response)=>{
    try {
      return res.json({canApprove:await isFinanceApprover(res.locals.vipUser.id)});
    } catch {
      return res.status(503).json({error:"Finance permission unavailable"});
    }
  });

  // An admin can nominate an ACTIVE, VERIFIED account as a finance approver.
  // Admin status by itself never grants the ability to confirm payments.
  app.post("/api/admin/vip/finance-permissions",enabled,authenticated,adminOnly,originGuard,async (req:Request,res:Response)=>{
    if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
    const email=req.body?.email;
    if(typeof email!=="string"||!/^.{1,100}@.{2,150}$/.test(email)) {
      return res.status(400).json({error:"Valid user email required"});
    }
    const db=await pool.connect().catch(()=>null);
    if(!db)return res.status(503).json({error:"Database unavailable"});
    try {
      await db.query("BEGIN");
      const user=await db.query(
        "SELECT id FROM users WHERE lower(email)=lower($1) AND is_active=TRUE AND is_verified=TRUE " +
        "AND (is_admin=TRUE OR role IN ('crm_employee','finance')) LIMIT 1",
        [email.trim()]
      );
      if(user.rowCount!==1) {
        await db.query("ROLLBACK");return res.status(404).json({error:"Verified staff account not found"});
      }
      await db.query(
        "INSERT INTO vip_finance_permissions(user_id,can_approve,granted_by) VALUES($1,TRUE,$2) " +
        "ON CONFLICT(user_id) DO UPDATE SET can_approve=TRUE,granted_by=$2,updated_at=NOW()",
        [user.rows[0].id,res.locals.vipUser.id]
      );
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) VALUES($1,'finance_permission_granted',$2::jsonb)",
        [res.locals.vipUser.id,JSON.stringify({userId:user.rows[0].id})]
      );
      await db.query("COMMIT");
      return res.json({granted:true});
    } catch {
      await db.query("ROLLBACK").catch(()=>{});
      return res.status(503).json({error:"Permission change failed"});
    } finally {db.release();}
  });

  // Revoking finance approval is immediate for all subsequent requests.
  // Keep the permission row for auditing; disable rather than deleting it.
  app.delete("/api/admin/vip/finance-permissions",enabled,authenticated,adminOnly,originGuard,async (req:Request,res:Response)=>{
    if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
    const email=req.body?.email;
    if(typeof email!=="string" || !/^.{1,100}@.{2,150}$/.test(email)){
      return res.status(400).json({error:"Valid staff email required"});
    }
    const db=await pool.connect().catch(()=>null);
    if(!db)return res.status(503).json({error:"Database unavailable"});
    try {
      await db.query("BEGIN");
      const found=await db.query("SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1",[email.trim()]);
      if(found.rowCount!==1){
        await db.query("ROLLBACK");
        return res.status(404).json({error:"Staff account not found"});
      }
      const disabled=await db.query(
        "UPDATE vip_finance_permissions SET can_approve=FALSE,updated_at=NOW() " +
        "WHERE user_id=$1 AND can_approve=TRUE RETURNING user_id",
        [found.rows[0].id]
      );
      if(disabled.rowCount!==1){
        await db.query("ROLLBACK");
        return res.status(409).json({error:"Permission is not currently active"});
      }
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) VALUES($1,'finance_permission_revoked',$2::jsonb)",
        [res.locals.vipUser.id,JSON.stringify({userId:found.rows[0].id})]
      );
      await db.query("COMMIT");
      return res.json({revoked:true});
    } catch {
      await db.query("ROLLBACK").catch(()=>{});
      return res.status(503).json({error:"Revocation failed"});
    } finally {db.release();}
  });

  app.post("/api/admin/vip/receipts/:receiptId/review",
    enabled,authenticated,requireFinance,originGuard,async (req:Request,res:Response)=>{
      if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
      const receiptId=positiveId(req.params.receiptId);
      const decision=req.body?.decision;
      const amountRaw=req.body?.verifiedAmount;
      const note=typeof req.body?.note==="string"?req.body.note.trim():"";
      if(!receiptId || !["approve","reject"].includes(decision) ||
         note.length>500 || (decision==="reject" && note.length<5) ||
         (decision==="approve" && (typeof amountRaw!=="string" || amountToCents(amountRaw)===null))) {
        return res.status(400).json({error:"Invalid verification decision"});
      }
      const db=await pool.connect().catch(()=>null);
      if(!db)return res.status(503).json({error:"Database unavailable"});
      try {
        await db.query("BEGIN");
        // Lock receipt first, then the installment; independent verification of
        // multiple receipts for the same installment is serialized by the row lock.
        const result=await db.query(
          "SELECT r.id,r.review_status,r.uploaded_by,r.installment_id,i.unit_id,i.currency " +
          "FROM vip_receipts r JOIN vip_installments i ON i.id=r.installment_id " +
          "WHERE r.id=$1 FOR UPDATE OF r",[receiptId]
        );
        if(result.rowCount!==1) {
          await db.query("ROLLBACK");return res.status(404).json({error:"Receipt not found"});
        }
        const item=result.rows[0];
        if(item.review_status!=="pending") {
          await db.query("ROLLBACK");return res.status(409).json({error:"Receipt already reviewed"});
        }
        if(Number(item.uploaded_by)===Number(res.locals.vipUser.id)) {
          await db.query("ROLLBACK");return res.status(403).json({error:"You may not verify a receipt you uploaded"});
        }
        await db.query("SELECT id FROM vip_installments WHERE id=$1 FOR UPDATE",[item.installment_id]);
        if(decision==="approve") {
          const sums=await db.query(
            "SELECT i.amount::text AS total, " +
            "COALESCE(SUM(p.amount),0)::text AS posted " +
            "FROM vip_installments i LEFT JOIN vip_payment_postings p ON p.installment_id=i.id " +
            "WHERE i.id=$1 GROUP BY i.id",[item.installment_id]
          );
          const total=amountToCents(sums.rows[0].total);
          const paid=amountToCents(sums.rows[0].posted)??BigInt(0);
          const requested=amountToCents(amountRaw);
          if(!total || !requested || requested > total-paid) {
            await db.query("ROLLBACK");
            return res.status(409).json({error:"Verified amount exceeds outstanding balance"});
          }
          await db.query(
            "INSERT INTO vip_payment_postings(installment_id,receipt_id,amount,currency,verified_by) " +
            "VALUES($1,$2,$3,$4,$5)",
            [item.installment_id,receiptId,centsToAmount(requested),item.currency,res.locals.vipUser.id]
          );
        }
        await db.query(
          "UPDATE vip_receipts SET review_status=$2,reviewed_by=$3,reviewed_at=NOW(),review_note=$4 WHERE id=$1",
          [receiptId,decision==="approve"?"approved":"rejected",res.locals.vipUser.id,note||null]
        );
        await db.query(
          "INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) " +
          "VALUES($1,$2,$3,$4::jsonb)",
          [res.locals.vipUser.id,decision==="approve"?"receipt_approved":"receipt_rejected",item.unit_id,
           JSON.stringify({receiptId,amount:decision==="approve"?amountRaw:null,currency:item.currency})]
        );
        await db.query("COMMIT");
        return res.json({reviewed:true,status:decision==="approve"?"approved":"rejected"});
      } catch {
        await db.query("ROLLBACK").catch(()=>{});
        return res.status(503).json({error:"Verification failed; no payment was confirmed"});
      } finally {db.release();}
    }
  );
}
