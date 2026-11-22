import type {Express,Request,Response,RequestHandler} from "express";
import {pool} from "../db";

const originJson:RequestHandler=(req,res,next)=>{
  if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
  try{
    const origin=req.get("Origin");
    if(!origin||new URL(origin).host!==req.get("Host"))return res.status(403).json({error:"Same-origin request required"});
  }catch{return res.status(403).json({error:"Invalid origin"});}
  next();
};
function validId(raw:unknown):number|null{
  if(typeof raw!=="string"||!/^[1-9]\d*$/.test(raw))return null;
  const value=Number(raw);return Number.isSafeInteger(value)?value:null;
}
function safeText(raw:unknown,min:number,max:number):string|null{
  if(typeof raw!=="string")return null;
  const value=raw.trim().replace(/\s+/g," ");
  if(value.length<min||value.length>max||/[\u0000-\u001f\u007f]/.test(value))return null;
  return value;
}

export function registerVipNotificationRoutes(app:Express,enabled:RequestHandler,auth:RequestHandler,admin:RequestHandler):void {
  app.get("/api/vip/notifications",enabled,auth,async(_req:Request,res:Response)=>{
    const userId=res.locals.vipUser.id;
    try{
      const [notifications,upcoming]=await Promise.all([
        pool.query(
          "SELECT n.id::text AS id,n.unit_id::text AS unit_id,n.title,n.body,n.event_type,n.payload,n.created_at,n.read_at "+
          "FROM vip_notifications n WHERE n.user_id=$1 "+
          "AND (n.unit_id IS NULL OR EXISTS(SELECT 1 FROM vip_unit_access a "+
          "WHERE a.unit_id=n.unit_id AND a.user_id=$1 AND a.access_role='owner' AND a.revoked_at IS NULL)) "+
          "ORDER BY n.created_at DESC LIMIT 100",
          [userId]
        ),
        pool.query(
          "SELECT i.id::text AS installment_id,i.unit_id::text AS unit_id,i.due_date::text AS due_date, "+
          "i.amount::text AS amount,i.currency,p.name AS project_name,u.unit_number, "+
          "GREATEST(i.amount-COALESCE(SUM(x.amount),0),0)::text AS remaining "+
          "FROM vip_installments i "+
          "JOIN vip_units u ON u.id=i.unit_id "+
          "JOIN vip_projects p ON p.id=u.project_id "+
          "JOIN vip_unit_access a ON a.unit_id=u.id AND a.user_id=$1 "+
          "AND a.access_role='owner' AND a.revoked_at IS NULL "+
          "LEFT JOIN vip_payment_postings x ON x.installment_id=i.id "+
          "WHERE i.due_date BETWEEN (NOW() AT TIME ZONE 'Asia/Tbilisi')::date "+
          "AND ((NOW() AT TIME ZONE 'Asia/Tbilisi')::date+2) "+
          "GROUP BY i.id,p.id,u.id HAVING i.amount-COALESCE(SUM(x.amount),0)>0 "+
          "ORDER BY i.due_date LIMIT 30",
          [userId]
        )
      ]);
      return res.json({notifications:notifications.rows,dueSoon:upcoming.rows});
    }catch{return res.status(503).json({error:"VIP notifications unavailable"});}
  });
  app.get("/api/vip/notification-preferences",enabled,auth,async(_req:Request,res:Response)=>{
    try{
      const pref=await pool.query(
        "SELECT in_app_due_reminders FROM vip_notification_preferences WHERE user_id=$1",
        [res.locals.vipUser.id]);
      return res.json({inAppDueReminders:pref.rows[0]?.in_app_due_reminders!==false});
    }catch{return res.status(503).json({error:"Preferences unavailable"});}
  });
  app.put("/api/vip/notification-preferences",enabled,auth,originJson,async(req:Request,res:Response)=>{
    if(typeof req.body?.inAppDueReminders!=="boolean"){
      return res.status(400).json({error:"Valid notification preference required"});
    }
    try{
      await pool.query(
        "INSERT INTO vip_notification_preferences(user_id,in_app_due_reminders) VALUES($1,$2) "+
        "ON CONFLICT(user_id) DO UPDATE SET in_app_due_reminders=EXCLUDED.in_app_due_reminders,updated_at=NOW()",
        [res.locals.vipUser.id,req.body.inAppDueReminders]);
      return res.json({saved:true});
    }catch{return res.status(503).json({error:"Could not save preference"});}
  });
  app.post("/api/vip/notifications/:id/read",enabled,auth,originJson,async(req:Request,res:Response)=>{
    const notificationId=validId(req.params.id);
    if(!notificationId)return res.status(404).json({error:"Notification not found"});
    try{
      const result=await pool.query(
        "UPDATE vip_notifications n SET read_at=COALESCE(read_at,NOW()) "+
        "WHERE n.id=$1 AND n.user_id=$2 "+
        "AND (n.unit_id IS NULL OR EXISTS(SELECT 1 FROM vip_unit_access a "+
        "WHERE a.unit_id=n.unit_id AND a.user_id=$2 AND a.access_role='owner' AND a.revoked_at IS NULL)) "+
        "RETURNING n.id",
        [notificationId,res.locals.vipUser.id]);
      if(!result.rowCount)return res.status(404).json({error:"Notification not found"});
      return res.json({read:true});
    }catch{return res.status(503).json({error:"Could not update notification"});}
  });
  // This writes only in-app notifications to the current owner of the specified
  // unit. It never sends WhatsApp, SMS or email, and cannot target arbitrary IDs.
  app.post("/api/admin/vip/units/:unitId/notifications",enabled,auth,admin,originJson,async(req:Request,res:Response)=>{
    const unitId=validId(req.params.unitId);
    const title=safeText(req.body?.title,3,90),body=safeText(req.body?.body,5,700);
    if(!unitId||!title||!body)return res.status(400).json({error:"Invalid notification"});
    const db=await pool.connect().catch(()=>null);
    if(!db)return res.status(503).json({error:"Notifications unavailable"});
    try{
      await db.query("BEGIN");
      const unit=await db.query("SELECT id FROM vip_units WHERE id=$1 FOR UPDATE",[unitId]);
      if(!unit.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Unit not found"});}
      const owner=await db.query(
        "SELECT a.user_id FROM vip_unit_access a JOIN users u ON u.id=a.user_id "+
        "WHERE a.unit_id=$1 AND a.access_role='owner' AND a.revoked_at IS NULL "+
        "AND u.is_active=TRUE LIMIT 1",[unitId]);
      if(!owner.rowCount){
        await db.query("ROLLBACK");return res.status(409).json({error:"No active owner assigned to this unit"});
      }
      const count=await db.query(
        "SELECT COUNT(*)::int AS n FROM vip_notifications WHERE unit_id=$1 "+
        "AND event_type='admin_update' AND created_at>NOW()-interval '24 hours'",[unitId]);
      if(Number(count.rows[0].n)>=5){
        await db.query("ROLLBACK");return res.status(429).json({error:"Daily notification limit reached"});
      }
      const inserted=await db.query(
        "INSERT INTO vip_notifications(user_id,unit_id,event_type,title,body,created_by) "+
        "VALUES($1,$2,'admin_update',$3,$4,$5) RETURNING id::text AS id",
        [owner.rows[0].user_id,unitId,title,body,res.locals.vipUser.id]);
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
        "VALUES($1,'vip_notification_sent',$2,$3::jsonb)",
        [res.locals.vipUser.id,unitId,JSON.stringify({notificationId:inserted.rows[0].id})]);
      await db.query("COMMIT");return res.status(201).json({notification:inserted.rows[0]});
    }catch{await db.query("ROLLBACK").catch(()=>{});return res.status(503).json({error:"Notification not saved"});}
    finally{db.release();}
  });
}
