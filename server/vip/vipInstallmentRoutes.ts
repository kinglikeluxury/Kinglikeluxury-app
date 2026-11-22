import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { pool } from "../db";

const installmentInput = z.object({
  sequenceNumber: z.number().int().min(1).max(999),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
    const parsed = new Date(v+"T12:00:00Z");
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10)===v;
  }),
  amount: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/).refine((v) => Number(v)>0),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict();
function positiveId(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}
const sameOriginJson: RequestHandler = (req,res,next) => {
  if (!req.is("application/json")) return res.status(415).json({error:"JSON required"});
  try {
    const origin=req.get("Origin");
    if (!origin || new URL(origin).host !== req.get("Host")) {
      return res.status(403).json({error:"Same-origin request required"});
    }
  } catch {
    return res.status(403).json({error:"Invalid origin"});
  }
  next();
};
const installmentSql =
  "SELECT i.id::text AS id, i.unit_id::text AS unit_id, i.sequence_number, i.due_date::text AS due_date, " +
  "i.amount::text AS amount, i.currency, " +
  "COALESCE(SUM(p.amount),0)::text AS paid_amount, " +
  "GREATEST(i.amount-COALESCE(SUM(p.amount),0),0)::text AS remaining_amount " +
  "FROM vip_installments i LEFT JOIN vip_payment_postings p ON p.installment_id=i.id " +
  "WHERE i.unit_id=$1 GROUP BY i.id ORDER BY i.due_date,i.sequence_number LIMIT 500";

export function registerVipInstallmentRoutes(
  app:Express,
  enabled:RequestHandler,
  authenticated:RequestHandler,
  adminOnly:RequestHandler,
):void {
  app.get("/api/vip/units/:unitId/installments",enabled,authenticated,async (req:Request,res:Response)=>{
    const unitId=positiveId(req.params.unitId);
    if(!unitId)return res.status(404).json({error:"Unit not found"});
    try {
      const access=await pool.query(
        "SELECT 1 FROM vip_unit_access WHERE unit_id=$1 AND user_id=$2 " +
        "AND access_role='owner' AND revoked_at IS NULL LIMIT 1",
        [unitId,res.locals.vipUser.id]
      );
      if(access.rowCount!==1)return res.status(404).json({error:"Unit not found"});
      const result=await pool.query(installmentSql,[unitId]);
      return res.json({installments:result.rows});
    } catch {
      return res.status(503).json({error:"Installments unavailable"});
    }
  });

  app.get("/api/admin/vip/units/:unitId/installments",enabled,authenticated,adminOnly,async (req:Request,res:Response)=>{
    const unitId=positiveId(req.params.unitId);
    if(!unitId)return res.status(404).json({error:"Unit not found"});
    try {
      const result=await pool.query(installmentSql,[unitId]);
      return res.json({installments:result.rows});
    } catch {
      return res.status(503).json({error:"Installments unavailable"});
    }
  });

  app.post("/api/admin/vip/units/:unitId/installments",enabled,authenticated,adminOnly,sameOriginJson,async (req:Request,res:Response)=>{
    const unitId=positiveId(req.params.unitId);
    const parsed=installmentInput.safeParse(req.body);
    if(!unitId||!parsed.success)return res.status(400).json({error:"Invalid installment"});
    const db=await pool.connect().catch(()=>null);
    if(!db)return res.status(503).json({error:"Database unavailable"});
    try {
      await db.query("BEGIN");
      const unit=await db.query("SELECT id FROM vip_units WHERE id=$1 FOR UPDATE",[unitId]);
      if(unit.rowCount!==1){
        await db.query("ROLLBACK");
        return res.status(404).json({error:"Unit not found"});
      }
      const data=parsed.data;
      const inserted=await db.query(
        "INSERT INTO vip_installments(unit_id,sequence_number,due_date,amount,currency) " +
        "VALUES ($1,$2,$3,$4,$5) " +
        "RETURNING id::text AS id,unit_id::text AS unit_id,sequence_number,due_date::text AS due_date,amount::text AS amount,currency",
        [unitId,data.sequenceNumber,data.dueDate,data.amount,data.currency]
      );
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) " +
        "VALUES($1,'installment_created',$2,$3::jsonb)",
        [res.locals.vipUser.id,unitId,JSON.stringify({installmentId:inserted.rows[0].id,sequenceNumber:data.sequenceNumber,dueDate:data.dueDate,amount:data.amount,currency:data.currency})]
      );
      await db.query("COMMIT");
      return res.status(201).json({installment:inserted.rows[0]});
    } catch(e) {
      await db.query("ROLLBACK").catch(()=>{});
      const unique=(e as {code?:string})?.code==="23505";
      return res.status(unique?409:503).json({error:unique?"An installment with that number already exists":"Could not save installment"});
    } finally {db.release();}
  });
}
