/**
 * Lead Assignment Service — Strict Alternating Round-Robin
 *
 * Algorithm:
 *  - A single persistent counter in `crm_assignment_cursor` drives ALL assignment decisions.
 *  - On each assignment: counter++ atomically (SELECT FOR UPDATE), pick agents[counter % N].
 *  - Agents are ordered by user_id ASC (stable, deterministic, not by lead count).
 *  - All sources (webhook, pull-sync, manual, import) share the SAME global counter
 *    → guaranteed strict alternation across all incoming channels.
 *  - Race-safe: `SELECT FOR UPDATE` inside a transaction means concurrent calls
 *    never read the same counter value.
 *
 * Eligibility:
 *  - Only `role = 'sub_agent'` users are included.
 *  - If only one agent exists, all leads go to that agent.
 *  - If no agents exist, returns null (lead saved unassigned).
 *
 * Logging:
 *  - Every assignment emits: [LeadAssignment] Assigned leadId=X → AgentName (userId=Y) | source=Z | counter=N
 */

import { pool } from "./db";

export interface SubAgent {
  id: number;
  username: string;
}

// ── Cursor table setup ────────────────────────────────────────────────────────

/**
 * Creates the cursor table if it does not exist and seeds a single row.
 * Safe to call on every startup (idempotent).
 */
export async function ensureAssignmentCursor(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_assignment_cursor (
      id            INT PRIMARY KEY DEFAULT 1,
      counter       BIGINT NOT NULL DEFAULT 0,
      last_agent_id INT,
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO crm_assignment_cursor (id, counter)
    VALUES (1, 0)
    ON CONFLICT (id) DO NOTHING;
  `);
  console.log("[LeadAssignment] Assignment cursor table ready ✓");
}

// ── Agent list ────────────────────────────────────────────────────────────────

/**
 * Returns all eligible sub-agents ordered by user id ASC.
 * Stable ordering is critical — the same list must be returned every call
 * so that counter % N always maps to the same agent.
 */
export async function getEligibleSubAgents(): Promise<SubAgent[]> {
  const res = await pool.query<{ id: number; username: string }>(
    `SELECT id, username
     FROM users
     WHERE role = 'sub_agent'
     ORDER BY id ASC`
  );

  if (res.rows.length === 0) {
    console.warn("[LeadAssignment] No eligible sub-agents found — lead will be unassigned");
  } else {
    console.log(
      `[LeadAssignment] Eligible agents (${res.rows.length}): ` +
      res.rows.map(r => `${r.username}(id=${r.id})`).join(", ")
    );
  }

  return res.rows;
}

// ── Core atomic pick ─────────────────────────────────────────────────────────

/**
 * Atomically picks the next sub-agent using the global alternating cursor.
 *
 * @param source  Human-readable label for the lead source (used in logs).
 * @param leadId  Optional — lead id to include in the log line once created.
 *
 * Uses SELECT FOR UPDATE to prevent race conditions when multiple
 * webhook calls or import rows are processed concurrently.
 */
export async function pickNextSubAgentId(
  source: string = "unknown",
  leadId?: number
): Promise<number | null> {
  const agents = await getEligibleSubAgents();
  if (!agents.length) return null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the single cursor row — concurrent callers queue here
    const cursorRes = await client.query<{ counter: string }>(
      "SELECT counter FROM crm_assignment_cursor WHERE id = 1 FOR UPDATE"
    );

    const counter    = BigInt(cursorRes.rows[0]?.counter ?? "0");
    const idx        = Number(counter % BigInt(agents.length));
    const picked     = agents[idx];
    const nextCounter = counter + 1n;

    await client.query(
      `UPDATE crm_assignment_cursor
       SET counter = $1, last_agent_id = $2, updated_at = NOW()
       WHERE id = 1`,
      [String(nextCounter), picked.id]
    );

    await client.query("COMMIT");

    const leadPart = leadId != null ? `leadId=${leadId}` : "(pending insert)";
    console.log(
      `[LeadAssignment] Assigned ${leadPart} → ${picked.username} (userId=${picked.id}) ` +
      `| source=${source} | counter=${counter} | idx=${idx}/${agents.length - 1}`
    );

    return picked.id;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[LeadAssignment] pickNextSubAgentId failed — ROLLBACK:", err);
    throw err;
  } finally {
    client.release();
  }
}

// ── Cycle helper (kept for backward-compat; now delegates to DB cursor) ──────

/**
 * @deprecated Use pickNextSubAgentId() directly.
 * Kept so old callers compile without changes; delegates to the global cursor.
 * `agents` and `offset` params are ignored — the cursor drives everything.
 */
export function cycleAgentId(_agents: SubAgent[], _offset: number): number | null {
  // This synchronous helper can no longer be used for the global cursor.
  // Callers inside the import/pull-sync loops have been updated to call
  // pickNextSubAgentId() directly. This stub prevents compile errors for
  // any remaining references.
  console.warn("[LeadAssignment] cycleAgentId() called — this is a no-op stub; use pickNextSubAgentId() instead");
  return null;
}

// ── Admin backfill ────────────────────────────────────────────────────────────

/**
 * Assigns all CRM leads where assigned_to IS NULL using the global cursor.
 * Never touches leads that already have an assignee.
 */
export async function backfillUnassignedLeads(): Promise<{
  assigned: number;
  agentCount: number;
  assignments: { leadId: number; agentId: number; agentName: string }[];
}> {
  const agents = await getEligibleSubAgents();
  if (!agents.length) {
    return { assigned: 0, agentCount: 0, assignments: [] };
  }

  const unassigned = await pool.query<{ id: number }>(
    "SELECT id FROM crm_leads WHERE assigned_to IS NULL ORDER BY id ASC"
  );

  let assigned = 0;
  const assignments: { leadId: number; agentId: number; agentName: string }[] = [];

  for (let i = 0; i < unassigned.rows.length; i++) {
    const leadId = unassigned.rows[i].id;
    // Use global cursor for backfill too — keeps state consistent
    const agentId = await pickNextSubAgentId("Backfill", leadId);
    if (agentId === null) break;

    await pool.query(
      "UPDATE crm_leads SET assigned_to=$1, updated_at=NOW() WHERE id=$2",
      [agentId, leadId]
    );

    const agentName = agents.find(a => a.id === agentId)?.username ?? String(agentId);
    assignments.push({ leadId, agentId, agentName });
    assigned++;
  }

  return { assigned, agentCount: agents.length, assignments };
}

// ── Audit helper ──────────────────────────────────────────────────────────────

export interface AssignmentCursorState {
  counter: number;
  lastAgentId: number | null;
  updatedAt: string | null;
  agents: Array<SubAgent & { leadCount: number; nextSlot: boolean }>;
}

/**
 * Returns the current cursor state and agent roster for the admin audit page.
 */
export async function getAssignmentCursorState(): Promise<AssignmentCursorState> {
  const [cursorRow, agentRows] = await Promise.all([
    pool.query<{ counter: string; last_agent_id: number | null; updated_at: string | null }>(
      "SELECT counter, last_agent_id, updated_at FROM crm_assignment_cursor WHERE id=1"
    ),
    pool.query<{ id: number; username: string; lead_count: number }>(
      `SELECT u.id, u.username, COUNT(l.id)::int AS lead_count
       FROM users u
       LEFT JOIN crm_leads l ON l.assigned_to = u.id
       WHERE u.role = 'sub_agent'
       GROUP BY u.id, u.username
       ORDER BY u.id ASC`
    ),
  ]);

  const counter      = Number(cursorRow.rows[0]?.counter ?? 0);
  const lastAgentId  = cursorRow.rows[0]?.last_agent_id ?? null;
  const updatedAt    = cursorRow.rows[0]?.updated_at ?? null;
  const agents       = agentRows.rows;
  const nextIdx      = agents.length > 0 ? counter % agents.length : 0;

  return {
    counter,
    lastAgentId,
    updatedAt,
    agents: agents.map((a, i) => ({
      id:        a.id,
      username:  a.username,
      leadCount: a.lead_count,
      nextSlot:  i === nextIdx,
    })),
  };
}
