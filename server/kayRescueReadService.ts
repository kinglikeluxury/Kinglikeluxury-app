import { withKayReadonlyAnalysis } from "./kayAnalysisDatabase";

export async function getAssistedRescuePreview(leadId: number, decisionId: number) {
  const result = await withKayReadonlyAnalysis(c => c.query(`SELECT l.id,l.status,l.assigned_to,l.wa_stage,h.entered_at,d.payload,u.username owner_name,r.username recommended_name,
    p.id IS NOT NULL protected,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'dueDate',t.due_date,'dueTime',t.due_time)) FROM crm_tasks t WHERE t.lead_id=l.id AND t.completed_at IS NULL),'[]'::jsonb) blockers,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'type',m.mission_type,'status',m.status,'priority',m.priority) ORDER BY m.created_at DESC) FROM (SELECT * FROM kay_missions WHERE lead_id=l.id ORDER BY created_at DESC LIMIT 1) m),'[]'::jsonb) last_mission
    FROM crm_leads l JOIN kay_decisions d ON d.id=$2 AND d.lead_id=l.id LEFT JOIN LATERAL (SELECT entered_at FROM kay_lead_status_history WHERE lead_id=l.id AND status=l.status ORDER BY entered_at DESC LIMIT 1) h ON true
    LEFT JOIN kay_lead_protection p ON p.lead_id=l.id AND p.removed_at IS NULL LEFT JOIN users u ON u.id=l.assigned_to
    LEFT JOIN users r ON r.id=(d.payload->>'recommended_employee_id')::int WHERE l.id=$1 LIMIT 1`, [leadId, decisionId]));
  const row: any = result.rows[0]; if (!row) return null;
  return { lead: { id: row.id, status: row.status, ownerId: row.assigned_to, ownerName: row.owner_name, contactStage: row.wa_stage }, decision: { id: decisionId, state: row.payload?.state, statusWindow: row.entered_at, why: row.payload?.employee_selection_explanation }, protection: { protected: row.protected }, blockers: row.blockers, lastMission: row.last_mission?.[0] ?? null, target: { id: row.payload?.recommended_employee_id, name: row.recommended_name } };
}

export async function listPromiseHandoffs(employeeId: number, admin: boolean) {
  return (await withKayReadonlyAnalysis(c => c.query(`SELECT h.*,p.promise_text,p.due_at,p.importance FROM kay_promise_handoffs h LEFT JOIN kay_promises p ON p.id=h.promise_id WHERE $2 OR (h.current_responsible_id=$1 AND EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=h.lead_id AND l.assigned_to=$1)) ORDER BY h.transferred_at DESC`, [employeeId, admin]))).rows;
}