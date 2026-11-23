import type {Express,Request,Response,RequestHandler} from "express";
import {pool} from "../db";

const unavailable=(res:Response)=>res.status(503).json({error:"VIP reports unavailable"});
function cursor(raw:unknown):number|null{
 if(typeof raw!=="string"||!/^[1-9]\d*$/.test(raw))return null;
 const n=Number(raw);
 return Number.isSafeInteger(n)?n:null;
}

/**
 * VIP Executive Dashboard: no financial currency mixing, no personal data,
 * no writes and no coupling to the production CRM tables.
 */
export function registerVipOperationsRoutes(app:Express,enabled:RequestHandler,auth:RequestHandler,admin:RequestHandler):void{
 app.get("/api/admin/vip/insights",enabled,auth,admin,async(_req:Request,res:Response)=>{
  try{
   const [summary,balances]=await Promise.all([
    pool.query(
     "SELECT "+
      "(SELECT COUNT(*)::int FROM vip_projects) AS projects,"+
      "(SELECT COUNT(*)::int FROM vip_units) AS units,"+
      "(SELECT COUNT(DISTINCT user_id)::int FROM vip_unit_access WHERE access_role='owner' AND revoked_at IS NULL) AS clients,"+
      "(SELECT COUNT(*)::int FROM vip_receipts WHERE review_status='pending') AS pending_receipts,"+
      "(SELECT COUNT(*)::int FROM vip_statement_requests WHERE status IN ('new','following_up','received')) AS pending_statements,"+
      "(SELECT COUNT(*)::int FROM vip_invitations WHERE status='pending' AND expires_at>NOW()) AS pending_invitations,"+
      "(SELECT COUNT(*)::int FROM vip_service_requests WHERE status NOT IN ('completed','closed')) AS active_services,"+
      "(SELECT COUNT(*)::int FROM vip_handover WHERE status='handover_approved') AS handovers_awaiting_keys,"+
      "(SELECT COUNT(*)::int FROM vip_support_tickets WHERE status NOT IN ('resolved','closed')) AS open_support,"+
      "(SELECT COUNT(*)::int FROM vip_support_tickets WHERE status NOT IN ('resolved','closed') AND due_at<NOW()) AS overdue_support,"+
      "(SELECT COUNT(*)::int FROM vip_referrals WHERE status IN ('new','contacted','qualified')) AS active_referrals,"+
      "(SELECT COUNT(*)::int FROM vip_journey_milestones WHERE stage_code='construction' "+
       "AND planned_date<(NOW() AT TIME ZONE 'Asia/Tbilisi')::date AND status<>'completed') AS delayed_construction_stages"
    ),
    pool.query(
     "SELECT i.currency,"+
      "COUNT(*) FILTER (WHERE i.due_date<(NOW() AT TIME ZONE 'Asia/Tbilisi')::date "+
        "AND i.amount>COALESCE(p.paid,0))::int AS overdue_installments,"+
      "COALESCE(SUM(GREATEST(i.amount-COALESCE(p.paid,0),0)) "+
        "FILTER (WHERE i.due_date<(NOW() AT TIME ZONE 'Asia/Tbilisi')::date),0)::text AS overdue_amount,"+
      "COALESCE(SUM(GREATEST(i.amount-COALESCE(p.paid,0),0)),0)::text AS total_outstanding,"+
      "COALESCE(SUM(COALESCE(p.paid,0)),0)::text AS total_verified_paid "+
     "FROM vip_installments i "+
     "LEFT JOIN LATERAL (SELECT SUM(post.amount) AS paid FROM vip_payment_postings post "+
        "WHERE post.installment_id=i.id AND post.currency=i.currency) p ON TRUE "+
     "WHERE EXISTS(SELECT 1 FROM vip_unit_access a WHERE a.unit_id=i.unit_id "+
       "AND a.access_role='owner' AND a.revoked_at IS NULL) "+
     "GROUP BY i.currency ORDER BY i.currency"
    )
   ]);
   return res.json({metrics:summary.rows[0],currencies:balances.rows,asOf:new Date().toISOString()});
  }catch{return unavailable(res);}
 });

 // The audit trail is read-only and admin only. Cursor pagination prevents
 // unbounded export and provides a stable view during ongoing operations.
 app.get("/api/admin/vip/audit",enabled,auth,admin,async(req:Request,res:Response)=>{
   const after=req.query.before;
   const before=after===undefined?null:cursor(after);
   const type=req.query.type;
   if(after!==undefined&&before===null)return res.status(400).json({error:"Invalid cursor"});
   if(type!==undefined&&(typeof type!=="string"||!/^[a-z][a-z0-9_]{2,79}$/.test(type))){
    return res.status(400).json({error:"Invalid audit event filter"});
   }
   try{
    const values:unknown[]=[before,type||null];
    const r=await pool.query(
      "SELECT a.id::text AS id,a.actor_user_id::text AS actor_user_id,"+
      "usr.email AS actor_email,a.event_type,a.unit_id::text AS unit_id,"+
      "a.metadata,a.created_at FROM vip_audit_events a "+
      "LEFT JOIN users usr ON usr.id=a.actor_user_id "+
      "WHERE ($1::bigint IS NULL OR a.id<$1) "+
      "AND ($2::text IS NULL OR a.event_type=$2) "+
      "ORDER BY a.id DESC LIMIT 51",values);
    const page=r.rows.slice(0,50);
    return res.json({events:page,nextCursor:r.rows.length>50?page[page.length-1].id:null});
   }catch{return unavailable(res);}
 });
}
