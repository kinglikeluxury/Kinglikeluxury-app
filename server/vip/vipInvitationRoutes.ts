import type { Express, Request, Response, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { pool } from "../db";
import { sendEmail } from "../notificationService";
import { VIP_INVITATION_TTL_HOURS, VIP_INVITATION_COOLDOWN_MINUTES,
  allowedVipInviteRecipient, hashInvitationToken, newInvitationToken,
  normalizedVipEmail, safeEmailMarkup, sameEmail, validInvitationToken,
  validNewVipPassword, vipActivationLink } from "./vipInvitationSecurity";

const numericId = (raw:unknown):number|null => {
  const str = typeof raw === "number" ? String(raw) : raw;
  if(typeof str!=="string" || !/^[1-9]\d*$/.test(str))return null;
  const id=Number(str);return Number.isSafeInteger(id)?id:null;
};
const sameOriginJson:RequestHandler = (req,res,next)=>{
  if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
  const origin=req.get("Origin");
  try{if(!origin||new URL(origin).host!==req.get("Host"))return res.status(403).json({error:"Same-origin request required"});}
  catch{return res.status(403).json({error:"Invalid origin"});}
  next();
};
const invalid = {error:"Invitation invalid or expired. Contact Kinglike Luxury."};
const maskEmail=(email:string)=>{
  const [name,domain]=email.split("@");
  return name.slice(0,Math.min(2,name.length))+"***@"+domain;
};

export function registerVipInvitationRoutes(app:Express,enabled:RequestHandler,authenticated:RequestHandler,adminOnly:RequestHandler):void {
  // A new invitation is created only after explicit email allowlist approval.
  // No customer account, password or unit access is created by this endpoint.
  app.post("/api/admin/vip/invitations",enabled,authenticated,adminOnly,sameOriginJson,async(req:Request,res:Response)=>{
    const unitId=numericId(req.body?.unitId);
    const email=normalizedVipEmail(req.body?.email);
    if(!unitId||!email)return res.status(400).json({error:"Valid unit and email required"});
    if(!allowedVipInviteRecipient(email))return res.status(503).json({error:"Invitations not enabled for this recipient"});
    const token=newInvitationToken();
    let url:string;
    try{url=vipActivationLink(token);}catch{return res.status(503).json({error:"Invitation URL unavailable"});}
    const db=await pool.connect().catch(()=>null);
    if(!db)return res.status(503).json({error:"VIP database unavailable"});
    let invitationId:string;
    let projectName:string;
    let unitNumber:string;
    try {
      await db.query("BEGIN");
      const unit=await db.query(
        "SELECT u.id,u.unit_number,p.name AS project_name FROM vip_units u " +
        "JOIN vip_projects p ON p.id=u.project_id WHERE u.id=$1 FOR UPDATE OF u",[unitId]);
      if(unit.rowCount!==1){await db.query("ROLLBACK");return res.status(404).json({error:"Unit not found"});}
      const owned=await db.query(
        "SELECT 1 FROM vip_unit_access WHERE unit_id=$1 AND access_role='owner' AND revoked_at IS NULL LIMIT 1",[unitId]);
      if(owned.rowCount){await db.query("ROLLBACK");return res.status(409).json({error:"Unit already has an owner"});}
      const recent=await db.query(
        "SELECT 1 FROM vip_invitations WHERE unit_id=$1 " +
        "AND created_at>NOW()-($2::integer*interval '1 minute') LIMIT 1",
        [unitId,VIP_INVITATION_COOLDOWN_MINUTES]);
      if(recent.rowCount){await db.query("ROLLBACK");return res.status(429).json({error:"Invitation issued recently. Try later."});}
      await db.query("UPDATE vip_invitations SET status='revoked' WHERE unit_id=$1 AND status='pending'",[unitId]);
      const row=await db.query(
        "INSERT INTO vip_invitations(unit_id,invited_email,token_hash,invited_by,expires_at) " +
        "VALUES($1,$2,$3,$4,NOW()+($5::integer*interval '1 hour')) RETURNING id::text AS id",
        [unitId,email,hashInvitationToken(token),res.locals.vipUser.id,VIP_INVITATION_TTL_HOURS]);
      invitationId=row.rows[0].id;
      unitNumber=unit.rows[0].unit_number;
      projectName=unit.rows[0].project_name;
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) " +
        "VALUES($1,'vip_invitation_created',$2,$3::jsonb)",
        [res.locals.vipUser.id,unitId,JSON.stringify({invitationId})]);
      await db.query("COMMIT");
    }catch{
      await db.query("ROLLBACK").catch(()=>{});
      return res.status(503).json({error:"Invitation could not be created"});
    }finally{db.release();}
    const html='<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#005476">'+
      '<h2>KINGLIKE VIP</h2><p>You are invited to your private investment account.</p>'+
      '<p>Project: '+safeEmailMarkup(projectName)+'<br/>Unit: '+safeEmailMarkup(unitNumber)+'</p>'+
      '<p><a href="'+safeEmailMarkup(url)+'">Activate your secure account</a></p>'+
      '<p>This link expires in '+VIP_INVITATION_TTL_HOURS+' hours. Do not forward it.</p></div>';
    const sent=await sendEmail({to:email,subject:"KINGLIKE VIP — Secure account activation",html,idempotencyKey:"vip-invite-"+invitationId});
    try{
      await pool.query(
        "UPDATE vip_invitations SET delivery_status=$2, " +
        "sent_at=CASE WHEN $2='sent' THEN NOW() ELSE NULL END, " +
        "status=CASE WHEN $2='sent' THEN status ELSE 'revoked' END " +
        "WHERE id=$1 AND status='pending'",
        [invitationId,sent.sent?"sent":"failed"]);
    }catch{return res.status(503).json({error:"Delivery status unconfirmed; contact support before retrying"});}
    if(!sent.sent)return res.status(503).json({error:"Email could not be delivered"});
    return res.status(201).json({invitation:{id:invitationId,unitId,sent:true,expiresInHours:VIP_INVITATION_TTL_HOURS}});
  });

  app.get("/api/vip/invitations/preview",enabled,async(req:Request,res:Response)=>{
    const token=req.query.token;
    if(!validInvitationToken(token))return res.status(404).json(invalid);
    try{
      const r=await pool.query(
        "SELECT i.invited_email,i.expires_at,u.unit_number,p.name AS project_name,"+
        "EXISTS(SELECT 1 FROM users us WHERE lower(us.email)=i.invited_email) AS account_exists, "+
        "EXISTS(SELECT 1 FROM users me WHERE me.id=$2 AND me.is_active=TRUE "+
        "AND lower(me.email)=i.invited_email) AS matches_signed_in "+
        "FROM vip_invitations i JOIN vip_units u ON u.id=i.unit_id JOIN vip_projects p ON p.id=u.project_id "+
        "WHERE i.token_hash=$1 AND i.status='pending' AND i.delivery_status='sent' AND i.expires_at>NOW() LIMIT 1",
        [hashInvitationToken(token),req.session?.userId||-1]);
      if(!r.rows.length)return res.status(404).json(invalid);
      const v=r.rows[0];
      return res.json({invitation:{emailMasked:maskEmail(v.invited_email),projectName:v.project_name,
        unitNumber:v.unit_number,accountExists:v.account_exists,matchesSignedIn:v.matches_signed_in,expiresAt:v.expires_at}});
    }catch{return res.status(503).json({error:"Invitation lookup unavailable"});}
  });

  app.post("/api/vip/invitations/accept",enabled,sameOriginJson,async(req:Request,res:Response)=>{
    const token=req.body?.token;
    if(!validInvitationToken(token))return res.status(404).json(invalid);
    const db=await pool.connect().catch(()=>null);
    if(!db)return res.status(503).json({error:"Activation unavailable"});
    let clientId:number;let newAccount=false;
    try{
      await db.query("BEGIN");
      const lookup=await db.query(
        "SELECT id,unit_id FROM vip_invitations WHERE token_hash=$1 LIMIT 1",
        [hashInvitationToken(token)]);
      if(!lookup.rowCount){await db.query("ROLLBACK");return res.status(404).json(invalid);}
      // Lock unit before invitation (same order as admin issuance); recheck all
      // invitation conditions under the row lock to avoid revocation races.
      await db.query("SELECT id FROM vip_units WHERE id=$1 FOR UPDATE",[lookup.rows[0].unit_id]);
      const invited=await db.query(
        "SELECT id,unit_id,invited_email FROM vip_invitations WHERE id=$1 "+
        "AND token_hash=$2 AND status='pending' AND delivery_status='sent' "+
        "AND expires_at>NOW() FOR UPDATE",
        [lookup.rows[0].id,hashInvitationToken(token)]);
      if(!invited.rowCount){await db.query("ROLLBACK");return res.status(404).json(invalid);}
      const row=invited.rows[0];
      const owned=await db.query(
        "SELECT 1 FROM vip_unit_access WHERE unit_id=$1 AND access_role='owner' AND revoked_at IS NULL LIMIT 1",
        [row.unit_id]);
      if(owned.rowCount){await db.query("ROLLBACK");return res.status(409).json({error:"Unit already assigned"});}
      const existing=await db.query("SELECT id,email,is_active FROM users WHERE lower(email)=$1 LIMIT 1",[row.invited_email]);
      if(existing.rowCount){
        const u=existing.rows[0];
        if(!u.is_active || Number(u.id)!==Number(req.session?.userId) || !sameEmail(u.email,row.invited_email)){
          await db.query("ROLLBACK");
          return res.status(409).json({error:"Sign in with the invited email account, then reopen the invitation."});
        }
        clientId=Number(u.id);
      }else{
        if(req.session?.userId){
          await db.query("ROLLBACK");
          return res.status(409).json({error:"Sign out of your other account before activation"});
        }
        if(!validNewVipPassword(req.body?.password)){
          await db.query("ROLLBACK");
          return res.status(400).json({error:"Use 12–72 characters with upper/lower case letters and a digit"});
        }
        const passwordHash=await bcrypt.hash(req.body.password,12);
        const username="vip_"+randomUUID().replace(/-/g,"").slice(0,20);
        const created=await db.query(
          "INSERT INTO users(username,email,password,is_verified,is_active,is_admin,role,auth_method) "+
          "VALUES($1,$2,$3,TRUE,TRUE,FALSE,'user','email') RETURNING id",
          [username,row.invited_email,passwordHash]);
        clientId=Number(created.rows[0].id);
        newAccount=true;
      }
      await db.query(
        "INSERT INTO vip_unit_access(unit_id,user_id,access_role,granted_by) "+
        "VALUES($1,$2,'owner',(SELECT invited_by FROM vip_invitations WHERE id=$3))",
        [row.unit_id,clientId,row.id]);
      await db.query(
        "UPDATE vip_invitations SET status='claimed',claimed_by=$2,claimed_at=NOW() WHERE id=$1",
        [row.id,clientId]);
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
        "VALUES($1,'vip_invitation_claimed',$2,$3::jsonb)",
        [clientId,row.unit_id,JSON.stringify({invitationId:row.id,createdAccount:newAccount})]);
      await db.query("COMMIT");
    }catch(err){
      await db.query("ROLLBACK").catch(()=>{});
      if((err as {code?:string})?.code==="23505")return res.status(409).json({error:"Unit or account changed; contact Kinglike Luxury"});
      return res.status(503).json({error:"Activation could not be completed"});
    }finally{db.release();}
    if(newAccount){
      return req.session.regenerate(err=>{
        if(err)return res.status(503).json({error:"Account activated. Please sign in."});
        req.session.userId=clientId;req.session.isAdmin=false;req.session.role="user";
        req.session.save(error=>{
          if(error)return res.status(503).json({error:"Account activated. Please sign in."});
          return res.json({activated:true,redirect:"/vip"});
        });
      });
    }
    return res.json({activated:true,redirect:"/vip"});
  });
}
