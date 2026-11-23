import type {Express,Request,Response,RequestHandler} from "express";
import {pool} from "../db";
import {supportTicketInput,supportMessageInput,supportAssignmentInput,validSupportId,validSupportTransition} from "./vipSupportRules";
import {validSellerAccount,validSellerEmail} from "./vipSellerRules";

const jsonOrigin:RequestHandler=(req,res,next)=>{
 if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
 try{
  const origin=req.get("Origin"),host=req.get("Host");
  if(!origin||!host||new URL(origin).host!==host)return res.status(403).json({error:"Same-origin request required"});
 }catch{return res.status(403).json({error:"Invalid origin"});}
 next();
};
const unavailable=(res:Response)=>res.status(503).json({error:"VIP support temporarily unavailable"});
const ticketColumns="SELECT t.id::text AS id,t.unit_id::text AS unit_id,t.owner_user_id::text AS owner_user_id,"+
 "t.subject,t.category,t.status,t.due_at,t.updated_at,t.created_at,"+
 "p.name AS project_name,u.unit_number "+
 "FROM vip_support_tickets t JOIN vip_units u ON u.id=t.unit_id "+
 "JOIN vip_projects p ON p.id=u.project_id ";

const accessSql="("+
 "(t.owner_user_id=$2 AND EXISTS(SELECT 1 FROM vip_unit_access oa "+
  "WHERE oa.unit_id=t.unit_id AND oa.user_id=$2 AND oa.access_role='owner' AND oa.revoked_at IS NULL)) "+
 "OR (t.assigned_to=$2 AND EXISTS(SELECT 1 FROM users staff "+
   "WHERE staff.id=$2 AND staff.is_active=TRUE AND staff.is_verified=TRUE "+
   "AND staff.role IN ('sub_agent','crm_employee','sales_agent','employee','agent') "+
   "AND EXISTS(SELECT 1 FROM vip_unit_access oa "+
    "WHERE oa.unit_id=t.unit_id AND oa.user_id=t.owner_user_id AND oa.access_role='owner' AND oa.revoked_at IS NULL))))";

export function registerVipSupportRoutes(app:Express,enabled:RequestHandler,auth:RequestHandler,admin:RequestHandler):void{
 app.get("/api/vip/support",enabled,auth,async(_req:Request,res:Response)=>{
  try{
    const result=await pool.query(
      ticketColumns+"WHERE "+accessSql.replaceAll("$2","$1")+" ORDER BY t.updated_at DESC LIMIT 150",
      [res.locals.vipUser.id]
    );
    return res.json({tickets:result.rows});
  }catch{return unavailable(res);}
 });
 app.get("/api/admin/vip/support",enabled,auth,admin,async(_req:Request,res:Response)=>{
  try{
    const r=await pool.query(
      "SELECT t.id::text AS id,t.unit_id::text AS unit_id,t.subject,t.category,t.status,"+
      "t.created_at,t.updated_at,t.due_at,t.owner_user_id::text AS owner_user_id,"+
      "owner.email AS owner_email,assigned.email AS assignee_email,"+
      "p.name AS project_name,u.unit_number "+
      "FROM vip_support_tickets t JOIN users owner ON owner.id=t.owner_user_id "+
      "JOIN vip_units u ON u.id=t.unit_id JOIN vip_projects p ON p.id=u.project_id "+
      "LEFT JOIN users assigned ON assigned.id=t.assigned_to "+
      "ORDER BY (t.status NOT IN ('closed','resolved')) DESC,t.due_at ASC,t.updated_at DESC LIMIT 300"
    );
    return res.json({tickets:r.rows});
  }catch{return unavailable(res);}
 });
 app.post("/api/vip/support",enabled,auth,jsonOrigin,async(req:Request,res:Response)=>{
  const valid=supportTicketInput.safeParse(req.body);
  if(!valid.success)return res.status(400).json({error:"Invalid support ticket"});
  const v=valid.data,userId=res.locals.vipUser.id;
  const db=await pool.connect().catch(()=>null);
  if(!db)return unavailable(res);
  try{
   await db.query("BEGIN");
   const usr=await db.query("SELECT id FROM users WHERE id=$1 AND is_active=TRUE FOR UPDATE",[userId]);
   if(!usr.rowCount){await db.query("ROLLBACK");return res.status(403).json({error:"Inactive user"});}
   const access=await db.query("SELECT 1 FROM vip_unit_access WHERE unit_id=$1 AND user_id=$2 "+
    "AND access_role='owner' AND revoked_at IS NULL",[v.unitId,userId]);
   if(!access.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Unit not found"});}
   const recent=await db.query("SELECT COUNT(*)::int AS n FROM vip_support_tickets "+
    "WHERE owner_user_id=$1 AND created_at>NOW()-INTERVAL '24 hours'",[userId]);
   if(Number(recent.rows[0].n)>=3){await db.query("ROLLBACK");return res.status(429).json({error:"Daily ticket limit reached"});}
   const t=await db.query(
    "INSERT INTO vip_support_tickets(unit_id,owner_user_id,category,subject,due_at) "+
    "VALUES($1,$2,$3,$4,NOW()+INTERVAL '48 hours') RETURNING id::text AS id",
    [v.unitId,userId,v.category,v.subject]);
   await db.query("INSERT INTO vip_support_messages(ticket_id,sender_user_id,message) VALUES($1,$2,$3)",
    [t.rows[0].id,userId,v.message]);
   await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
    "VALUES($1,'vip_support_opened',$2,$3::jsonb)",
    [userId,v.unitId,JSON.stringify({ticketId:t.rows[0].id,category:v.category})]);
   await db.query("COMMIT");return res.status(201).json({ticket:t.rows[0]});
  }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res);}
  finally{db.release();}
 });
 app.get("/api/vip/support/:id",enabled,auth,async(req:Request,res:Response)=>{
  const id=validSupportId(req.params.id);
  if(!id)return res.status(404).json({error:"Ticket not found"});
  try{
   const userId=res.locals.vipUser.id;
   const ticket=await pool.query(ticketColumns+"WHERE t.id=$1 AND ("+accessSql+" OR $3=TRUE) LIMIT 1",
     [id,userId,res.locals.vipUser.isAdmin]);
   if(!ticket.rowCount)return res.status(404).json({error:"Ticket not found"});
   const messages=await pool.query(
    "SELECT m.id::text AS id,m.sender_user_id::text AS sender_user_id,m.message,m.created_at "+
    "FROM vip_support_messages m WHERE m.ticket_id=$1 ORDER BY m.id ASC LIMIT 300",[id]);
   return res.json({ticket:ticket.rows[0],messages:messages.rows});
  }catch{return unavailable(res);}
 });
 app.post("/api/vip/support/:id/reply",enabled,auth,jsonOrigin,async(req:Request,res:Response)=>{
  const id=validSupportId(req.params.id),v=supportMessageInput.safeParse(req.body);
  if(!id||!v.success)return res.status(400).json({error:"Invalid support message"});
  const userId=res.locals.vipUser.id;
  const db=await pool.connect().catch(()=>null);
  if(!db)return unavailable(res);
  try{
   await db.query("BEGIN");
   const ticket=await db.query(
    "SELECT t.id,t.unit_id,t.status,t.owner_user_id,t.assigned_to "+
    "FROM vip_support_tickets t WHERE t.id=$1 FOR UPDATE",[id]);
   if(!ticket.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Ticket not found"});}
   const t=ticket.rows[0];
   if(t.status==="closed"||t.status==="resolved"){await db.query("ROLLBACK");return res.status(409).json({error:"Ticket is closed"});}
   const owner=await db.query("SELECT 1 FROM vip_unit_access WHERE unit_id=$1 AND user_id=$2 "+
    "AND access_role='owner' AND revoked_at IS NULL",[t.unit_id,t.owner_user_id]);
   if(!owner.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Ticket not found"});}
   let permitted=res.locals.vipUser.isAdmin===true;
   if(!permitted && Number(t.owner_user_id)===userId)permitted=true;
   if(!permitted && Number(t.assigned_to)===userId){
    const staff=await db.query("SELECT role,email,is_active,is_verified,is_admin FROM users WHERE id=$1",[userId]);
    permitted=staff.rowCount===1 && validSellerAccount(staff.rows[0]);
   }
   if(!permitted){await db.query("ROLLBACK");return res.status(404).json({error:"Ticket not found"});}
   const cap=await db.query("SELECT COUNT(*)::int AS n FROM vip_support_messages "+
     "WHERE ticket_id=$1 AND sender_user_id=$2 AND created_at>NOW()-INTERVAL '24 hours'",[id,userId]);
   if(Number(cap.rows[0].n)>=15){await db.query("ROLLBACK");return res.status(429).json({error:"Daily support reply limit reached"});}
   await db.query("INSERT INTO vip_support_messages(ticket_id,sender_user_id,message) "+
     "VALUES($1,$2,$3)",[id,userId,v.data.message]);
   await db.query("UPDATE vip_support_tickets SET updated_at=NOW() WHERE id=$1",[id]);
   await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
    "VALUES($1,'vip_support_replied',$2,$3::jsonb)",
    [userId,t.unit_id,JSON.stringify({ticketId:id})]);
   await db.query("COMMIT");return res.status(201).json({sent:true});
  }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res);}
  finally{db.release();}
 });
 app.patch("/api/admin/vip/support/:id",enabled,auth,admin,jsonOrigin,async(req:Request,res:Response)=>{
  const id=validSupportId(req.params.id),v=supportAssignmentInput.safeParse(req.body);
  if(!id||!v.success)return res.status(400).json({error:"Invalid ticket status or assignment"});
  const userId=res.locals.vipUser.id;
  const db=await pool.connect().catch(()=>null);
  if(!db)return unavailable(res);
  try{
   await db.query("BEGIN");
   const old=await db.query(
    "SELECT id,unit_id,status,assigned_to FROM vip_support_tickets WHERE id=$1 FOR UPDATE",[id]);
   if(!old.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Ticket not found"});}
   if(old.rows[0].status!==v.data.status&&!validSupportTransition(old.rows[0].status,v.data.status)){
    await db.query("ROLLBACK");return res.status(409).json({error:"Invalid support status transition"});
   }
   let assigneeId:number|null=null;
   if(v.data.assigneeEmail){
    const email=validSellerEmail(v.data.assigneeEmail);
    if(!email){await db.query("ROLLBACK");return res.status(400).json({error:"Invalid staff email"});}
    const staff=await db.query(
     "SELECT id,role,email,is_active,is_verified,is_admin FROM users WHERE LOWER(email)=$1",[email]);
    if(staff.rowCount!==1||!validSellerAccount(staff.rows[0])){
      await db.query("ROLLBACK");return res.status(403).json({error:"Verified active staff account required"});
    }
    assigneeId=Number(staff.rows[0].id);
   }
   if(v.data.dueAt && new Date(v.data.dueAt).getTime()<Date.now()){
     await db.query("ROLLBACK");return res.status(400).json({error:"Due date cannot be in the past"});
   }
   await db.query("UPDATE vip_support_tickets SET status=$2,assigned_to=$3,due_at=$4,updated_at=NOW() WHERE id=$1",
    [id,v.data.status,assigneeId,v.data.dueAt||null]);
   await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
    "VALUES($1,'vip_support_managed',$2,$3::jsonb)",
    [userId,old.rows[0].unit_id,JSON.stringify({ticketId:id,from:old.rows[0].status,to:v.data.status,fromStaff:old.rows[0].assigned_to,toStaff:assigneeId,reason:v.data.internalNote})]);
   await db.query("COMMIT");return res.json({updated:true});
  }catch{await db.query("ROLLBACK").catch(()=>{});return unavailable(res);}
  finally{db.release();}
 });
}
