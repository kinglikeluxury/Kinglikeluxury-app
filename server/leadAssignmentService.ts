/**
 * Lead Assignment Service — Round-Robin Sub-Agent Assignment
 *
 * Rules:
 *  - Only users with role='sub_agent' are eligible
 *  - Agent with fewest assigned leads goes next (fairness)
 *  - Tiebreak: lowest user id (deterministic ordering)
 *  - Never overwrites an already-set assignedTo
 *  - Logs every assignment with [LeadAssignment] prefix
 */

import { pool } from "./db";

export interface SubAgent {
  id: number;
  username: string;
}

/**
 * Returns all eligible sub-agents sorted by current assigned lead count ASC,
 * then by user id ASC (tiebreak). This gives a fair starting point for round-robin.
 */
export async function getEligibleSubAgents(): Promise<SubAgent[]> {
  const res = await pool.query<{ id: number; username: string; lead_count: number }>(`
    SELECT u.id, u.username, COUNT(l.id)::int AS lead_count
    FROM users u
    LEFT JOIN crm_leads l ON l.assigned_to = u.id
    WHERE u.role = 'sub_agent'
    GROUP BY u.id, u.username
    ORDER BY lead_count ASC, u.id ASC
  `);

  if (res.rows.length === 0) {
    console.log("[LeadAssignment] No eligible sub-agents found");
  }

  return res.rows.map(r => ({ id: r.id, username: r.username }));
}

/**
 * For SINGLE-lead creation (manual CRM, webhook).
 * Picks the sub-agent with the fewest currently assigned leads.
 * Returns null if no sub-agents exist.
 */
export async function pickNextSubAgentId(): Promise<number | null> {
  const agents = await getEligibleSubAgents();
  return agents.length > 0 ? agents[0].id : null;
}

/**
 * For BATCH lead creation (pull sync, Excel import).
 * Call ONCE before the import loop; use the returned array as a cycling cursor.
 *
 * Usage:
 *   const agents = await getEligibleSubAgents();
 *   let offset = 0;
 *   // inside loop:
 *   const agentId = agents.length ? agents[offset++ % agents.length].id : null;
 *
 * Exporting this helper so callers can share the same pattern.
 */
export function cycleAgentId(agents: SubAgent[], offset: number): number | null {
  if (!agents.length) return null;
  return agents[offset % agents.length].id;
}

/**
 * Admin backfill: assigns all CRM leads where assigned_to IS NULL
 * using round-robin across eligible sub-agents.
 * Never touches leads that already have an assignee.
 */
export async function backfillUnassignedLeads(): Promise<{
  assigned: number;
  agentCount: number;
}> {
  const agents = await getEligibleSubAgents();
  if (!agents.length) {
    return { assigned: 0, agentCount: 0 };
  }

  const unassigned = await pool.query<{ id: number }>(
    "SELECT id FROM crm_leads WHERE assigned_to IS NULL ORDER BY id ASC"
  );

  let assigned = 0;
  for (let i = 0; i < unassigned.rows.length; i++) {
    const leadId  = unassigned.rows[i].id;
    const agentId = agents[i % agents.length].id;
    await pool.query(
      "UPDATE crm_leads SET assigned_to=$1, updated_at=NOW() WHERE id=$2",
      [agentId, leadId]
    );
    console.log(`[LeadAssignment] Backfill assigned leadId=${leadId} to userId=${agentId}`);
    assigned++;
  }

  return { assigned, agentCount: agents.length };
}
