import type {Express,Request,Response,RequestHandler} from "express";
import {pool} from "../db";
import {journeyInput,benefitInput,serviceRequestInput,nextServiceStatus,positiveVipId} from "./vipExperienceRules";

const sameOriginJson:RequestHandler=(req,res,next)=>{
  if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
  try{
    if(!req.get("Origin")||!req.get("Host")||new URL(req.get("Origin")!).host!==req.get("Host"))
      return res.status(403).json({error:"Same-origin request required"});
  }catch{return res.status(403).json({error:"Invalid origin"});}
  next();
};
const unavailable=(res:Response)=>res.status(503).json({error:"VIP experience unavailable"});

async function ownsUnit(unitId:number,userId:number):Promise<boolean>{
  const r=await pool.query(
    "SELECT 1 FROM vip_unit_access WHERE unit_id=$1 AND user_id=$2 "+
    "AND access_role='owner' AND revoked_at IS NULL LIMIT 1",
    [unitId,userId]);
  return r.rowCount===1;
}
const journeyQuery="SELECT stage_code,status,planned_date::text AS planned_date,actual_date::text AS actual_date,"+
  "note,published,updated_at FROM vip_journey_milestones WHERE unit_id=$1 ";
const serviceQuery="SELECT id::text AS id,unit_id::text AS unit_id,service_type,details,status,"+
  "admin_reply,created_at,updated_at FROM vip_service_requests WHERE unit_id=$1 ";

export function registerVipExperienceRoutes(app:Express,enabled:RequestHandler,auth:RequestHandler,admin:RequestHandler):void{
  app.get("/api/vip/units/:unitId/journey",enabled,auth,async(req:Request,res:Response)=>{
    const unitId=positiveVipId(req.params.unitId);
    if(!unitId)return res.status(404).json({error:"Unit not found"});
    try{
      if(!(await ownsUnit(unitId,res.locals.vipUser.id)))return res.status(404).json({error:"Unit not found"});
      const r=await pool.query(journeyQuery+"AND published=TRUE ORDER BY "+
        "CASE stage_code WHEN 'reservation' THEN 1 WHEN 'contract' THEN 2 "+
        "WHEN 'down_payment' THEN 3 WHEN 'construction' THEN 4 "+
        "WHEN 'inspection' THEN 5 ELSE 6 END",[unitId]);
      return res.json({milestones:r.rows});
    }catch{return unavailable(res);}
  });
  app.get("/api/admin/vip/units/:unitId/journey",enabled,auth,admin,async(req:Request,res:Response)=>{
    const unitId=positiveVipId(req.params.unitId);
    if(!unitId)return res.status(400).json({error:"Invalid unit"});
    try{
      const r=await pool.query(journeyQuery+"ORDER BY stage_code",[unitId]);
      return res.json({milestones:r.rows});
    }catch{return unavailable(res);}
  });
  app.put("/api/admin/vip/units/:unitId/journey",enabled,auth,admin,sameOriginJson,async(req:Request,res:Response)=>{
    const unitId=positiveVipId(req.params.unitId);
    const parsed=journeyInput.safeParse(req.body);
    if(!unitId||!parsed.success)return res.status(400).json({error:"Invalid journey milestone"});
    const v=parsed.data;
    const db=await pool.connect().catch(()=>null);
    if(!db)return unavailable(res);
    try{
      await db.query("BEGIN");
      const u=await db.query("SELECT id FROM vip_units WHERE id=$1 FOR UPDATE",[unitId]);
      if(!u.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Unit not found"});}
      await db.query(
        "INSERT INTO vip_journey_milestones(unit_id,stage_code,status,planned_date,actual_date,note,published,updated_by) "+
        "VALUES($1,$2,$3,$4,$5,$6,$7,$8) "+
        "ON CONFLICT(unit_id,stage_code) DO UPDATE SET "+
        "status=EXCLUDED.status,planned_date=EXCLUDED.planned_date,actual_date=EXCLUDED.actual_date,"+
        "note=EXCLUDED.note,published=EXCLUDED.published,updated_by=EXCLUDED.updated_by,updated_at=NOW()",
        [unitId,v.stage,v.status,v.plannedDate,v.actualDate,v.note||null,v.published,res.locals.vipUser.id]);
      await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
        "VALUES($1,'vip_journey_updated',$2,$3::jsonb)",
        [res.locals.vipUser.id,unitId,JSON.stringify({stage:v.stage,status:v.status,published:v.published})]);
      await db.query("COMMIT");return res.json({saved:true});
    }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res);}
    finally{db.release();}
  });

  app.get("/api/vip/benefits",enabled,auth,async(_req:Request,res:Response)=>{
    try{
      const own=await pool.query(
        "SELECT 1 FROM vip_unit_access WHERE user_id=$1 AND access_role='owner' AND revoked_at IS NULL LIMIT 1",
        [res.locals.vipUser.id]);
      if(!own.rowCount)return res.status(403).json({error:"Active owner account required"});
      const r=await pool.query(
        "SELECT id::text AS id,title,details,category,valid_until::text AS valid_until "+
        "FROM vip_benefits WHERE published=TRUE AND (valid_until IS NULL OR valid_until>=CURRENT_DATE) "+
        "ORDER BY created_at DESC LIMIT 40");
      return res.json({benefits:r.rows});
    }catch{return unavailable(res);}
  });
  app.get("/api/admin/vip/benefits",enabled,auth,admin,async(_req:Request,res:Response)=>{
    try{
      const r=await pool.query(
        "SELECT id::text AS id,title,details,category,valid_until::text AS valid_until,published "+
        "FROM vip_benefits ORDER BY created_at DESC LIMIT 100");
      return res.json({benefits:r.rows});
    }catch{return unavailable(res);}
  });
  app.post("/api/admin/vip/benefits",enabled,auth,admin,sameOriginJson,async(req:Request,res:Response)=>{
    const v=benefitInput.safeParse(req.body);
    if(!v.success)return res.status(400).json({error:"Invalid benefit terms"});
    const db=await pool.connect().catch(()=>null);
    if(!db)return unavailable(res);
    try{
      await db.query("BEGIN");
      const added=await db.query(
        "INSERT INTO vip_benefits(title,details,category,valid_until,published,created_by) "+
        "VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text AS id",
        [v.data.title,v.data.details,v.data.category,v.data.validUntil,v.data.published,res.locals.vipUser.id]);
      await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) "+
        "VALUES($1,'vip_benefit_created',$2::jsonb)",
        [res.locals.vipUser.id,JSON.stringify({benefitId:added.rows[0].id,published:v.data.published})]);
      await db.query("COMMIT");return res.status(201).json({benefit:added.rows[0]});
    }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res);}
    finally{db.release();}
  });
  app.patch("/api/admin/vip/benefits/:benefitId",enabled,auth,admin,sameOriginJson,async(req:Request,res:Response)=>{
    const benefitId=positiveVipId(req.params.benefitId);
    const published=req.body?.published;
    if(!benefitId||typeof published!=="boolean")return res.status(400).json({error:"Invalid visibility"});
    const db=await pool.connect().catch(()=>null);
    if(!db)return unavailable(res);
    try{
      await db.query("BEGIN");
      const r=await db.query("UPDATE vip_benefits SET published=$2,updated_at=NOW() "+
        "WHERE id=$1 RETURNING id",[benefitId,published]);
      if(!r.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Benefit not found"});}
      await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) "+
        "VALUES($1,'vip_benefit_visibility_changed',$2::jsonb)",
        [res.locals.vipUser.id,JSON.stringify({benefitId,published})]);
      await db.query("COMMIT");return res.json({saved:true});
    }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res);}
    finally{db.release();}
  });

  app.get("/api/vip/units/:unitId/services",enabled,auth,async(req:Request,res:Response)=>{
    const unitId=positiveVipId(req.params.unitId);
    if(!unitId)return res.status(404).json({error:"Unit not found"});
    try{
      if(!(await ownsUnit(unitId,res.locals.vipUser.id)))return res.status(404).json({error:"Unit not found"});
      const r=await pool.query(serviceQuery+"AND requested_by=$2 ORDER BY created_at DESC LIMIT 100",
        [unitId,res.locals.vipUser.id]);
      return res.json({requests:r.rows});
    }catch{return unavailable(res);}
  });
  app.post("/api/vip/services",enabled,auth,sameOriginJson,async(req:Request,res:Response)=>{
    const parsed=serviceRequestInput.safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:"Invalid service request"});
    const userId=res.locals.vipUser.id, v=parsed.data;
    const db=await pool.connect().catch(()=>null);
    if(!db)return unavailable(res);
    try{
      await db.query("BEGIN");
      const user=await db.query("SELECT id FROM users WHERE id=$1 AND is_active=TRUE FOR UPDATE",[userId]);
      if(!user.rowCount){await db.query("ROLLBACK");return res.status(403).json({error:"User inactive"});}
      const access=await db.query("SELECT 1 FROM vip_unit_access WHERE unit_id=$1 AND user_id=$2 "+
        "AND access_role='owner' AND revoked_at IS NULL",[v.unitId,userId]);
      if(!access.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Unit not found"});}
      const recent=await db.query(
        "SELECT COUNT(*)::int AS n FROM vip_service_requests WHERE requested_by=$1 "+
        "AND created_at>NOW()-interval '24 hours'",[userId]);
      if(Number(recent.rows[0].n)>=4){await db.query("ROLLBACK");return res.status(429).json({error:"Service request limit reached"});}
      const added=await db.query(
        "INSERT INTO vip_service_requests(unit_id,requested_by,service_type,details) "+
        "VALUES($1,$2,$3,$4) RETURNING id::text AS id,status",
        [v.unitId,userId,v.type,v.details]);
      await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
        "VALUES($1,'vip_service_requested',$2,$3::jsonb)",
        [userId,v.unitId,JSON.stringify({requestId:added.rows[0].id,type:v.type})]);
      await db.query("COMMIT");return res.status(201).json({request:added.rows[0]});
    }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res);}
    finally{db.release();}
  });
  app.get("/api/admin/vip/services",enabled,auth,admin,async(_req:Request,res:Response)=>{
    try{
      const r=await pool.query(
        "SELECT s.id::text AS id,s.unit_id::text AS unit_id,s.service_type,s.details,"+
        "s.status,s.admin_reply,s.created_at,u.email AS customer_email,un.unit_number,p.name AS project_name "+
        "FROM vip_service_requests s JOIN users u ON u.id=s.requested_by "+
        "JOIN vip_units un ON un.id=s.unit_id JOIN vip_projects p ON p.id=un.project_id "+
        "ORDER BY s.created_at DESC LIMIT 200");
      return res.json({requests:r.rows});
    }catch{return unavailable(res);}
  });
  app.patch("/api/admin/vip/services/:requestId",enabled,auth,admin,sameOriginJson,async(req:Request,res:Response)=>{
    const id=positiveVipId(req.params.requestId),status=req.body?.status,reply=req.body?.reply;
    if(!id||typeof status!=="string"||typeof reply!=="string"||
       reply.trim().length<5||reply.length>900)return res.status(400).json({error:"Invalid service update"});
    const db=await pool.connect().catch(()=>null);
    if(!db)return unavailable(res);
    try{
      await db.query("BEGIN");
      const r=await db.query("SELECT unit_id,status FROM vip_service_requests WHERE id=$1 FOR UPDATE",[id]);
      if(!r.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Service not found"});}
      if(!nextServiceStatus(r.rows[0].status,status)){
        await db.query("ROLLBACK");return res.status(409).json({error:"Unsupported status transition"});
      }
      await db.query("UPDATE vip_service_requests SET status=$2,admin_reply=$3,reviewed_by=$4,"+
        "updated_at=NOW() WHERE id=$1",[id,status,reply.trim(),res.locals.vipUser.id]);
      await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
        "VALUES($1,'vip_service_updated',$2,$3::jsonb)",
        [res.locals.vipUser.id,r.rows[0].unit_id,JSON.stringify({requestId:id,from:r.rows[0].status,to:status})]);
      await db.query("COMMIT");return res.json({updated:true});
    }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res);}
    finally{db.release();}
  });
}
