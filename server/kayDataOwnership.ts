export type KayDataOwner = "CRM_OWNED" | "KAY_OWNED" | "AUDIT_ONLY" | "EXTERNAL_SYSTEM" | "UNKNOWN";

export interface KayDataObject {
  name: string;
  owner: KayDataOwner;
  runtimeWrite: boolean;
  note: string;
}

/** Ownership is assigned by business domain, never by a column prefix. */
export const KAY_DATA_OWNERSHIP: readonly KayDataObject[] = Object.freeze([
  { name: "crm_leads", owner: "CRM_OWNED", runtimeWrite: false, note: "Lead and customer business record." },
  { name: "crm_tasks", owner: "CRM_OWNED", runtimeWrite: false, note: "Human CRM task record." },
  { name: "crm_notes", owner: "CRM_OWNED", runtimeWrite: false, note: "Human CRM notes." },
  { name: "crm_projects", owner: "CRM_OWNED", runtimeWrite: false, note: "CRM project relationship." },
  { name: "lead_assignment_history", owner: "CRM_OWNED", runtimeWrite: false, note: "CRM ownership history." },
  { name: "users", owner: "CRM_OWNED", runtimeWrite: false, note: "Human identity and employee account data." },

  { name: "kay_events", owner: "KAY_OWNED", runtimeWrite: true, note: "Append-only internal observations." },
  { name: "kay_decisions", owner: "KAY_OWNED", runtimeWrite: true, note: "Internal recommendations and lifecycle state." },
  { name: "kay_evaluator_queue", owner: "KAY_OWNED", runtimeWrite: true, note: "Read-analysis work queue; no external consumer." },
  { name: "kay_missions", owner: "KAY_OWNED", runtimeWrite: true, note: "Internal advisor recommendations." },
  { name: "kay_commitments", owner: "KAY_OWNED", runtimeWrite: true, note: "Internal workflow commitments." },
  { name: "kay_promises", owner: "KAY_OWNED", runtimeWrite: true, note: "Internal promise tracking." },
  { name: "kay_internal_briefings", owner: "KAY_OWNED", runtimeWrite: true, note: "Internal employee briefings." },
  { name: "kay_internal_call_sessions", owner: "KAY_OWNED", runtimeWrite: true, note: "Internal Kay browser call sessions only; no audio or customer data." },
  { name: "kay_recording_sessions", owner: "KAY_OWNED", runtimeWrite: true, note: "Internal Kay recording metadata only; audio is outside PostgreSQL." },
  { name: "kay_manager_reviews", owner: "KAY_OWNED", runtimeWrite: true, note: "Internal manager review queue." },
  { name: "kay_runtime_state", owner: "KAY_OWNED", runtimeWrite: true, note: "Worker leases, health, and availability only." },

  { name: "kay_settings", owner: "KAY_OWNED", runtimeWrite: false, note: "Frozen policy/configuration; not a worker target." },
  { name: "kay_lead_protection", owner: "KAY_OWNED", runtimeWrite: false, note: "Admin-controlled review state." },
  { name: "kay_lead_status_history", owner: "KAY_OWNED", runtimeWrite: false, note: "Historical observation; grants withheld." },
  { name: "kay_legacy_baseline_init_runs", owner: "KAY_OWNED", runtimeWrite: false, note: "Frozen historical baseline process." },
  { name: "kay_legacy_rescue_baselines", owner: "KAY_OWNED", runtimeWrite: false, note: "Frozen historical observation records." },
  { name: "kay_operational_launch_audit", owner: "KAY_OWNED", runtimeWrite: false, note: "Immutable operational-scope audit." },
  { name: "kay_auto_rescue_queue", owner: "KAY_OWNED", runtimeWrite: false, note: "Execution-linked queue; permanently excluded." },
  { name: "kay_rescue_executions", owner: "KAY_OWNED", runtimeWrite: false, note: "Historical execution table; frozen." },
  { name: "kay_promise_handoffs", owner: "KAY_OWNED", runtimeWrite: false, note: "Execution-linked handoff history; frozen." },
  { name: "phase_e24_first_canary_state", owner: "KAY_OWNED", runtimeWrite: false, note: "Permanently FROZEN_NO_EXECUTION." },

  { name: "kay_action_audit", owner: "AUDIT_ONLY", runtimeWrite: false, note: "KAY_AUDIT_DATABASE_URL only." },
  { name: "user_notifications", owner: "EXTERNAL_SYSTEM", runtimeWrite: false, note: "Shared application notification state." },
  { name: "sessions", owner: "EXTERNAL_SYSTEM", runtimeWrite: false, note: "Application authentication sessions." },
]);

const ownershipByName = new Map(KAY_DATA_OWNERSHIP.map(item => [item.name, item]));

export const KAY_INTERNAL_OPTIONAL_WRITABLE_TABLES: readonly string[] = Object.freeze([
  "kay_internal_call_sessions",
  "kay_recording_sessions",
]);

export const KAY_INTERNAL_WRITABLE_TABLES = Object.freeze(
  KAY_DATA_OWNERSHIP
    .filter(item =>
      item.owner === "KAY_OWNED" &&
      item.runtimeWrite &&
      !KAY_INTERNAL_OPTIONAL_WRITABLE_TABLES.includes(item.name)
    )
    .map(item => item.name),
);

export const KAY_INTERNAL_APPROVED_WRITABLE_TABLES = Object.freeze([
  ...KAY_INTERNAL_WRITABLE_TABLES,
  ...KAY_INTERNAL_OPTIONAL_WRITABLE_TABLES,
]);

export function getKayDataOwnership(name: string): KayDataObject {
  return ownershipByName.get(String(name).trim().toLowerCase()) ?? {
    name: String(name).trim().toLowerCase(),
    owner: "UNKNOWN",
    runtimeWrite: false,
    note: "Unclassified objects fail closed.",
  };
}

export function isKayInternalWritableTable(name: string): boolean {
  const item = getKayDataOwnership(name);
  return item.owner === "KAY_OWNED" && item.runtimeWrite;
}