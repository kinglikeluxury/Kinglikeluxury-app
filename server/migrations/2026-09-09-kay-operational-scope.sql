ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS business_received_at TIMESTAMPTZ;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS business_received_at_source TEXT;
ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS crm_leads_business_received_at_provenance_chk;
ALTER TABLE crm_leads ADD CONSTRAINT crm_leads_business_received_at_provenance_chk
  CHECK ((business_received_at IS NULL) = (business_received_at_source IS NULL)
    AND (business_received_at_source IS NULL OR business_received_at_source IN ('ORIGINAL_BUSINESS_TIMESTAMP','TRUSTED_SOURCE_CREATED_AT')));

CREATE TABLE IF NOT EXISTS kay_operational_launch_audit (
  id BIGSERIAL PRIMARY KEY, actor_admin_id INTEGER NOT NULL REFERENCES users(id),
  old_value JSONB, new_value JSONB NOT NULL, launch_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL, cutoff_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION reject_kay_launch_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'kay_operational_launch_audit is append-only'; END $$;
DROP TRIGGER IF EXISTS kay_launch_audit_immutable ON kay_operational_launch_audit;
CREATE TRIGGER kay_launch_audit_immutable BEFORE UPDATE OR DELETE ON kay_operational_launch_audit
  FOR EACH ROW EXECUTE FUNCTION reject_kay_launch_audit_mutation();

CREATE INDEX IF NOT EXISTS crm_leads_scope_owner_status_created_idx ON crm_leads(assigned_to,status,created_at);
CREATE INDEX IF NOT EXISTS crm_leads_scope_owner_business_received_idx ON crm_leads(assigned_to,business_received_at);
CREATE INDEX IF NOT EXISTS crm_tasks_lead_completed_due_idx ON crm_tasks(lead_id,completed_at,due_date);
CREATE INDEX IF NOT EXISTS kay_status_lead_status_entered_idx ON kay_lead_status_history(lead_id,status,entered_at DESC);
CREATE INDEX IF NOT EXISTS lead_assignment_reason_date_owner_idx ON lead_assignment_history(reason,assigned_at,from_user_id,to_user_id);