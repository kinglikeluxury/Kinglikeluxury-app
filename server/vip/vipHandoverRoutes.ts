import type {Express,Request,Response,RequestHandler} from "express";
import {pool} from "../db";
import {DEFAULT_HANDOVER_CHECKLIST,validHandoverChecklist,canUpdateHandoverState,validAppointmentDate,
  type HandoverState,type HandoverChecklist} from "./vipHandoverRules";

function id(raw:unknown):number|null{
  if(typeof raw!=="string"||!/^[1-9]\d*$/.test(raw))return null;
  const value=Number(raw);return Number.isSafeInteger(value)?value:null;
}
const originJson:RequestHandler=(req,res,next)=>{
  if(!req.is("application/json"))return res.status(415).json({error:"JSON required"});
  const origin=req.get("Origin");
  try {
    if(!origin||new URL(origin).host!==req.get("Host"))return res.status(403).json({error:"Same-origin request required"});
  }catch{return res.status(403).json({error:"Invalid origin"});}
  next();
};
const fail=(res:Response)=>res.status(503).json({error:"Handover service unavailable"});
const ownerOf=async(unitId:number,userId:number)=>{
  const result=await pool.query("SELECT 1 FROM vip_unit_access "+
    "WHERE unit_id=$1 AND user_id=$2 AND access_role='owner' AND revoked_at IS NULL LIMIT 1",
    [unitId,userId]);
  return result.rowCount===1;
};
const getDetails=async(unitId:number,ownerId?:number)=>{
  const [handover,appointments,snags]=await Promise.all([
    pool.query("SELECT unit_id::text AS unit_id,status,scheduled_at,checklist,inspection_note,updated_at "+
      "FROM vip_handover WHERE unit_id=$1",[unitId]),
    pool.query("SELECT id::text AS id,preferred_at,status,requested_at,confirmed_at,note "+
      "FROM vip_handover_appointments WHERE unit_id=$1 "+
      (ownerId!==undefined?"AND requested_by=$2 ":"")+
      "ORDER BY requested_at DESC LIMIT 15",
      ownerId!==undefined?[unitId,ownerId]:[unitId]),
    pool.query("SELECT id::text AS id,description,status,created_at,resolved_at,resolution_note "+
      "FROM vip_handover_snags WHERE unit_id=$1 "+
      (ownerId!==undefined?"AND created_by=$2 ":"")+
      "ORDER BY created_at DESC LIMIT 50",
      ownerId!==undefined?[unitId,ownerId]:[unitId])
  ]);
  return {handover:handover.rows[0]??{unit_id:String(unitId),status:"not_ready",scheduled_at:null,
    checklist:DEFAULT_HANDOVER_CHECKLIST,inspection_note:null,updated_at:null},
    appointments:appointments.rows,snags:snags.rows};
};

export function registerVipHandoverRoutes(app:Express,enabled:RequestHandler,authenticated:RequestHandler,adminOnly:RequestHandler):void{
  app.get("/api/vip/units/:unitId/handover",enabled,authenticated,async(req:Request,res:Response)=>{
    const unitId=id(req.params.unitId);
    if(!unitId)return res.status(404).json({error:"Unit not found"});
    try{
      if(!(await ownerOf(unitId,res.locals.vipUser.id)))return res.status(404).json({error:"Unit not found"});
      return res.json(await getDetails(unitId,res.locals.vipUser.id));
    }catch{return fail(res);}
  });

  app.get("/api/admin/vip/units/:unitId/handover",enabled,authenticated,adminOnly,async(req:Request,res:Response)=>{
    const unitId=id(req.params.unitId);
    if(!unitId)return res.status(400).json({error:"Invalid unit"});
    try{
      const unit=await pool.query("SELECT 1 FROM vip_units WHERE id=$1",[unitId]);
      if(!unit.rowCount)return res.status(404).json({error:"Unit not found"});
      return res.json(await getDetails(unitId));
    }catch{return fail(res);}
  });

  app.post("/api/admin/vip/units/:unitId/handover/stage",
    enabled,authenticated,adminOnly,originJson,async(req:Request,res:Response)=>{
      const unitId=id(req.params.unitId);
      const action=req.body?.action as "mark_ready"|"finish_inspection"|"record_issues"|"resolve_issues";
      const note=req.body?.note;
      if(!unitId||!["mark_ready","finish_inspection","record_issues","resolve_issues"].includes(action)||
         (note!==undefined&&(typeof note!=="string"||note.length>1200))) {
        return res.status(400).json({error:"Invalid handover stage"});
      }
      const db=await pool.connect().catch(()=>null);
      if(!db)return fail(res);
      try{
        await db.query("BEGIN");
        const u=await db.query("SELECT id FROM vip_units WHERE id=$1 FOR UPDATE",[unitId]);
        if(u.rowCount!==1){await db.query("ROLLBACK");return res.status(404).json({error:"Unit not found"});}
        await db.query("INSERT INTO vip_handover(unit_id,status) VALUES($1,'not_ready') ON CONFLICT(unit_id) DO NOTHING",[unitId]);
        const r=await db.query("SELECT status,checklist FROM vip_handover WHERE unit_id=$1 FOR UPDATE",[unitId]);
        const current=r.rows[0].status as HandoverState;
        const checks=validHandoverChecklist(r.rows[0].checklist)?r.rows[0].checklist as HandoverChecklist:DEFAULT_HANDOVER_CHECKLIST;
        const count=await db.query("SELECT COUNT(*)::int AS n FROM vip_handover_snags WHERE unit_id=$1 AND status='open'",[unitId]);
        const open=Number(count.rows[0].n);
        let next:HandoverState;
        if(action==="mark_ready"){
          if(!canUpdateHandoverState(current,"mark_ready",checks,open)){
            await db.query("ROLLBACK");return res.status(409).json({error:"Handover cannot be marked ready from this stage"});
          }
          next="ready_for_appointment";
        }else if(action==="finish_inspection"){
          if(!canUpdateHandoverState(current,"finish_inspection",checks,open)){
            await db.query("ROLLBACK");return res.status(409).json({error:"All checks must pass and no snags may remain open"});
          }
          next="inspection_completed";
        }else if(action==="record_issues"){
          if(current!=="appointment_scheduled"||(
            open===0&&!Object.values(checks).some(s=>s==="issue")
          )){
            await db.query("ROLLBACK");return res.status(409).json({error:"A documented issue is required"});
          }
          next="snags_open";
        }else{
          if(current!=="snags_open"||open>0||!Object.values(checks).every(s=>s==="passed")){
            await db.query("ROLLBACK");return res.status(409).json({error:"Resolve all snags and checklist issues first"});
          }
          next="inspection_completed";
        }
        await db.query(
          "UPDATE vip_handover SET status=$2,inspection_note=$3,updated_by=$4,updated_at=NOW() "+
          "WHERE unit_id=$1",
          [unitId,next,typeof note==="string"?note.trim()||null:null,res.locals.vipUser.id]);
        await db.query(
          "INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
          "VALUES($1,'handover_stage_changed',$2,$3::jsonb)",
          [res.locals.vipUser.id,unitId,JSON.stringify({from:current,to:next,action})]);
        await db.query("COMMIT");
        return res.json({stage:next});
      }catch{await db.query("ROLLBACK").catch(()=>{});return fail(res);}
      finally{db.release();}
    });

  app.put("/api/admin/vip/units/:unitId/handover/checklist",
    enabled,authenticated,adminOnly,originJson,async(req:Request,res:Response)=>{
      const unitId=id(req.params.unitId),checklist=req.body?.checklist;
      if(!unitId||!validHandoverChecklist(checklist))return res.status(400).json({error:"Invalid checklist"});
      const db=await pool.connect().catch(()=>null);
      if(!db)return fail(res);
      try{
        await db.query("BEGIN");
        const r=await db.query("SELECT status FROM vip_handover WHERE unit_id=$1 FOR UPDATE",[unitId]);
        if(!r.rowCount||!["appointment_scheduled","snags_open","inspection_completed"].includes(r.rows[0].status)){
          await db.query("ROLLBACK");return res.status(409).json({error:"Inspection checklist not yet editable"});
        }
        await db.query(
          "UPDATE vip_handover SET checklist=$2::jsonb,updated_by=$3,updated_at=NOW() WHERE unit_id=$1",
          [unitId,JSON.stringify(checklist),res.locals.vipUser.id]);
        await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
          "VALUES($1,'handover_checklist_updated',$2,$3::jsonb)",
          [res.locals.vipUser.id,unitId,JSON.stringify({checklist})]);
        await db.query("COMMIT");
        return res.json({saved:true});
      }catch{await db.query("ROLLBACK").catch(()=>{});return fail(res);}
      finally{db.release();}
    });

  app.post("/api/vip/units/:unitId/handover/appointments",
    enabled,authenticated,originJson,async(req:Request,res:Response)=>{
      const unitId=id(req.params.unitId),date=validAppointmentDate(req.body?.preferredAt);
      const note=req.body?.note??"";
      if(!unitId||!date||typeof note!=="string"||note.length>800){
        return res.status(400).json({error:"Invalid proposed appointment"});
      }
      const db=await pool.connect().catch(()=>null);
      if(!db)return fail(res);
      try{
        await db.query("BEGIN");
        const access=await db.query(
          "SELECT 1 FROM vip_unit_access WHERE unit_id=$1 AND user_id=$2 "+
          "AND access_role='owner' AND revoked_at IS NULL FOR SHARE",
          [unitId,res.locals.vipUser.id]);
        if(!access.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Unit not found"});}
        const handover=await db.query("SELECT status FROM vip_handover WHERE unit_id=$1 FOR UPDATE",[unitId]);
        if(!handover.rowCount||handover.rows[0].status!=="ready_for_appointment"){
          await db.query("ROLLBACK");return res.status(409).json({error:"Scheduling has not been opened by Kinglike"});
        }
        const pending=await db.query(
          "SELECT 1 FROM vip_handover_appointments WHERE unit_id=$1 AND status='requested' LIMIT 1",[unitId]);
        if(pending.rowCount){await db.query("ROLLBACK");return res.status(409).json({error:"There is already an open appointment request"});}
        const created=await db.query(
          "INSERT INTO vip_handover_appointments(unit_id,requested_by,preferred_at,note) "+
          "VALUES($1,$2,$3,$4) RETURNING id::text AS id,status",
          [unitId,res.locals.vipUser.id,date.toISOString(),note.trim()||null]);
        await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
          "VALUES($1,'handover_appointment_requested',$2,$3::jsonb)",
          [res.locals.vipUser.id,unitId,JSON.stringify({appointmentId:created.rows[0].id})]);
        await db.query("COMMIT");
        return res.status(201).json({appointment:created.rows[0]});
      }catch(e){
        await db.query("ROLLBACK").catch(()=>{});
        return res.status((e as {code?:string}).code==="23505"?409:503).json({error:"Could not save appointment request"});
      }finally{db.release();}
    });

  app.patch("/api/admin/vip/units/:unitId/handover/appointments/:appointmentId",
    enabled,authenticated,adminOnly,originJson,async(req:Request,res:Response)=>{
      const unitId=id(req.params.unitId),appointmentId=id(req.params.appointmentId),decision=req.body?.decision;
      if(!unitId||!appointmentId||!["confirm","decline"].includes(decision)){
        return res.status(400).json({error:"Invalid appointment decision"});
      }
      const db=await pool.connect().catch(()=>null);
      if(!db)return fail(res);
      try{
        await db.query("BEGIN");
        const h=await db.query("SELECT status FROM vip_handover WHERE unit_id=$1 FOR UPDATE",[unitId]);
        if(!h.rowCount||h.rows[0].status!=="ready_for_appointment"){
          await db.query("ROLLBACK");return res.status(409).json({error:"Unit is not ready for appointment"});
        }
        const a=await db.query(
          "SELECT preferred_at,status FROM vip_handover_appointments "+
          "WHERE id=$1 AND unit_id=$2 FOR UPDATE",[appointmentId,unitId]);
        if(!a.rowCount||a.rows[0].status!=="requested"){
          await db.query("ROLLBACK");return res.status(409).json({error:"Appointment already processed"});
        }
        await db.query(
          "UPDATE vip_handover_appointments SET status=$2,handled_by=$3,confirmed_at=CASE WHEN $2='confirmed' THEN NOW() ELSE NULL END "+
          "WHERE id=$1",[appointmentId,decision==="confirm"?"confirmed":"declined",res.locals.vipUser.id]);
        if(decision==="confirm"){
          await db.query(
            "UPDATE vip_handover SET status='appointment_scheduled',scheduled_at=$2,updated_by=$3,updated_at=NOW() WHERE unit_id=$1",
            [unitId,a.rows[0].preferred_at,res.locals.vipUser.id]);
        }
        await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
          "VALUES($1,'handover_appointment_reviewed',$2,$3::jsonb)",
          [res.locals.vipUser.id,unitId,JSON.stringify({appointmentId,decision})]);
        await db.query("COMMIT");
        return res.json({decision,scheduled:decision==="confirm"});
      }catch{await db.query("ROLLBACK").catch(()=>{});return fail(res);}
      finally{db.release();}
    });

  app.post("/api/vip/units/:unitId/handover/snags",enabled,authenticated,originJson,async(req:Request,res:Response)=>{
    const unitId=id(req.params.unitId),description=req.body?.description;
    if(!unitId||typeof description!=="string"||description.trim().length<10||description.length>1200){
      return res.status(400).json({error:"Describe the issue (10–1200 characters)"});
    }
    const db=await pool.connect().catch(()=>null);
    if(!db)return fail(res);
    try{
      await db.query("BEGIN");
      const access=await db.query(
        "SELECT 1 FROM vip_unit_access WHERE unit_id=$1 AND user_id=$2 "+
        "AND access_role='owner' AND revoked_at IS NULL FOR SHARE",
        [unitId,res.locals.vipUser.id]);
      if(!access.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Unit not found"});}
      const handover=await db.query("SELECT status FROM vip_handover WHERE unit_id=$1 FOR UPDATE",[unitId]);
      if(!handover.rowCount||!["appointment_scheduled","inspection_completed","snags_open"].includes(handover.rows[0].status)){
        await db.query("ROLLBACK");return res.status(409).json({error:"Report issues after a confirmed appointment"});
      }
      const created=await db.query(
        "INSERT INTO vip_handover_snags(unit_id,created_by,description) "+
        "VALUES($1,$2,$3) RETURNING id::text AS id",[unitId,res.locals.vipUser.id,description.trim()]);
      await db.query("UPDATE vip_handover SET status='snags_open',updated_at=NOW() WHERE unit_id=$1",[unitId]);
      await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
        "VALUES($1,'handover_snag_reported',$2,$3::jsonb)",
        [res.locals.vipUser.id,unitId,JSON.stringify({snagId:created.rows[0].id})]);
      await db.query("COMMIT");
      return res.status(201).json({snag:created.rows[0]});
    }catch{await db.query("ROLLBACK").catch(()=>{});return fail(res);}
    finally{db.release();}
  });

  app.patch("/api/admin/vip/units/:unitId/handover/snags/:snagId",
    enabled,authenticated,adminOnly,originJson,async(req:Request,res:Response)=>{
      const unitId=id(req.params.unitId),snagId=id(req.params.snagId);
      const note=req.body?.resolutionNote;
      if(!unitId||!snagId||typeof note!=="string"||note.trim().length<10||note.length>1200){
        return res.status(400).json({error:"Resolution note of 10–1200 characters required"});
      }
      const db=await pool.connect().catch(()=>null);
      if(!db)return fail(res);
      try{
        await db.query("BEGIN");
        const h=await db.query("SELECT status FROM vip_handover WHERE unit_id=$1 FOR UPDATE",[unitId]);
        if(!h.rowCount||h.rows[0].status!=="snags_open"){
          await db.query("ROLLBACK");return res.status(409).json({error:"No active snagging stage"});
        }
        const result=await db.query(
          "UPDATE vip_handover_snags SET status='resolved',resolved_by=$3,resolved_at=NOW(),resolution_note=$4 "+
          "WHERE id=$1 AND unit_id=$2 AND status='open' RETURNING id::text AS id",
          [snagId,unitId,res.locals.vipUser.id,note.trim()]);
        if(!result.rowCount){await db.query("ROLLBACK");return res.status(409).json({error:"Issue already closed"});
        }
        await db.query("INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) "+
          "VALUES($1,'handover_snag_resolved',$2,$3::jsonb)",
          [res.locals.vipUser.id,unitId,JSON.stringify({snagId})]);
        await db.query("COMMIT");
        return res.json({resolved:true});
      }catch{await db.query("ROLLBACK").catch(()=>{});return fail(res);}
      finally{db.release();}
    });
}
