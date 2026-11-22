import type { Express, Request, Response, RequestHandler } from "express";
import { pool } from "../db";
import { validateVipCameraUrl } from "./vipCameraSecurity";

function idFrom(raw:unknown):number|null{
  if(typeof raw!=="string"||!/^[1-9]\d*$/.test(raw))return null;
  const n=Number(raw);return Number.isSafeInteger(n)?n:null;
}
const originJson:RequestHandler=(req,res,next)=>{
  if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
  const origin=req.get("Origin");
  try{
    if(!origin||new URL(origin).host!==req.get("Host"))return res.status(403).json({error:"Same-origin request required"});
  }catch{return res.status(403).json({error:"Invalid Origin"});}
  next();
};

export function registerVipCameraRoutes(app:Express,enabled:RequestHandler,authenticated:RequestHandler,adminOnly:RequestHandler):void {
  app.get("/api/vip/projects/:projectId/camera",enabled,authenticated,async(req:Request,res:Response)=>{
    const projectId=idFrom(req.params.projectId);
    if(!projectId)return res.status(404).json({error:"Project not found"});
    try{
      const access=await pool.query(
        "SELECT 1 FROM vip_units u JOIN vip_unit_access a ON a.unit_id=u.id "+
        "WHERE u.project_id=$1 AND a.user_id=$2 AND a.access_role='owner' AND a.revoked_at IS NULL LIMIT 1",
        [projectId,res.locals.vipUser.id]);
      if(access.rowCount!==1)return res.status(404).json({error:"Project not found"});
      const r=await pool.query(
        "SELECT label,embed_url,updated_at FROM vip_project_cameras WHERE project_id=$1 AND is_active=TRUE LIMIT 1",
        [projectId]);
      if(!r.rows.length)return res.json({available:false});
      const c=r.rows[0];
      // Even an old URL must continue to pass the current provider allowlist.
      const approved=validateVipCameraUrl(c.embed_url,process.env.KINGLIKE_VIP_CAMERA_ALLOWED_HOSTS);
      if(!approved)return res.json({available:false});
      return res.json({available:true,camera:{label:c.label,url:approved,updatedAt:c.updated_at}});
    }catch{return res.status(503).json({error:"Camera unavailable"});}
  });

  app.get("/api/admin/vip/projects/:projectId/camera",enabled,authenticated,adminOnly,async(req:Request,res:Response)=>{
    const projectId=idFrom(req.params.projectId);
    if(!projectId)return res.status(400).json({error:"Invalid project"});
    try{
      const r=await pool.query(
        "SELECT label,embed_url,is_active,updated_at FROM vip_project_cameras WHERE project_id=$1",
        [projectId]);
      return res.json({camera:r.rows[0]||null});
    }catch{return res.status(503).json({error:"Camera unavailable"});}
  });

  app.put("/api/admin/vip/projects/:projectId/camera",enabled,authenticated,adminOnly,originJson,async(req:Request,res:Response)=>{
    const projectId=idFrom(req.params.projectId);
    const label=req.body?.label;
    const active=req.body?.isActive;
    const link=validateVipCameraUrl(req.body?.embedUrl,process.env.KINGLIKE_VIP_CAMERA_ALLOWED_HOSTS);
    if(!projectId||typeof label!=="string"||label.trim().length<2||label.trim().length>80||typeof active!=="boolean"||!link){
      return res.status(400).json({error:"Invalid or unapproved camera URL"});
    }
    const db=await pool.connect().catch(()=>null);
    if(!db)return res.status(503).json({error:"Camera database unavailable"});
    try{
      await db.query("BEGIN");
      const p=await db.query("SELECT id FROM vip_projects WHERE id=$1 FOR UPDATE",[projectId]);
      if(p.rowCount!==1){await db.query("ROLLBACK");return res.status(404).json({error:"Project not found"});}
      await db.query(
        "INSERT INTO vip_project_cameras(project_id,label,embed_url,is_active,updated_by) "+
        "VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id) DO UPDATE SET "+
        "label=EXCLUDED.label,embed_url=EXCLUDED.embed_url,is_active=EXCLUDED.is_active,"+
        "updated_by=EXCLUDED.updated_by,updated_at=NOW()",
        [projectId,label.trim(),link,active,res.locals.vipUser.id]);
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) "+
        "VALUES($1,'project_camera_updated',$2::jsonb)",
        [res.locals.vipUser.id,JSON.stringify({projectId,isActive:active})]);
      await db.query("COMMIT");
      return res.json({saved:true,active});
    }catch{
      await db.query("ROLLBACK").catch(()=>{});
      return res.status(503).json({error:"Camera setting failed"});
    }finally{db.release();}
  });
}
