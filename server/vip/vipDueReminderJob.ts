import type {Client,Pool,PoolClient} from "pg";

/**
 * Idempotent local in-app installment reminders.
 * Does not run on import. The deployment owner must explicitly configure a
 * scheduler after staged verification; no WhatsApp, email, SMS, or push calls.
 * Project due dates use the Georgia/Azerbaijan business calendar (UTC+4).
 */
export async function generateVipDueReminders(db:Pool|PoolClient|Client):Promise<number>{
 const result=await db.query(
  "INSERT INTO vip_notifications(user_id,unit_id,event_type,title,body,source_key,payload) "+
  "SELECT a.user_id,i.unit_id,'due_reminder', "+
    "'Upcoming installment', "+
    "'A property installment is scheduled in two days. Open your account to check the current outstanding balance.', "+
    "'installment:'||i.id::text||':due:'||i.due_date::text, "+
    "jsonb_build_object('unitNumber',un.unit_number,'projectName',p.name,"+
      "'dueDate',i.due_date::text,'currency',i.currency) "+
  "FROM vip_installments i "+
  "JOIN vip_units un ON un.id=i.unit_id "+
  "JOIN vip_projects p ON p.id=un.project_id "+
  "JOIN vip_unit_access a ON a.unit_id=i.unit_id AND a.access_role='owner' AND a.revoked_at IS NULL "+
  "JOIN users usr ON usr.id=a.user_id AND usr.is_active=TRUE "+
  "LEFT JOIN vip_notification_preferences pref ON pref.user_id=a.user_id "+
  "LEFT JOIN LATERAL (SELECT COALESCE(SUM(post.amount),0) AS verified FROM vip_payment_postings post "+
    "WHERE post.installment_id=i.id AND post.currency=i.currency) paid ON TRUE "+
  "WHERE i.due_date=(NOW() AT TIME ZONE 'Asia/Tbilisi')::date + 2 "+
    "AND i.amount>paid.verified "+
    "AND COALESCE(pref.in_app_due_reminders,TRUE)=TRUE "+
  "ON CONFLICT DO NOTHING RETURNING id"
 );
 return result.rowCount||0;
}
