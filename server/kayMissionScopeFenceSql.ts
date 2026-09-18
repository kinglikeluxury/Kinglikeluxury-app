export const KAY_MISSION_SCOPE_FENCE_SQL = String.raw`
CREATE OR REPLACE FUNCTION public.kay_lock_mission_scope(p_lead_id integer, p_employee_id integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $kay_scope_fence$
DECLARE
  lead_row public.crm_leads%ROWTYPE;
  owner_row public.users%ROWTYPE;
  launch_text text;
  launch_at timestamptz;
  received_at timestamptz;
BEGIN
  SELECT * INTO lead_row FROM public.crm_leads WHERE id=p_lead_id FOR SHARE;
  IF NOT FOUND OR lead_row.assigned_to IS DISTINCT FROM p_employee_id THEN RETURN false; END IF;

  SELECT * INTO owner_row FROM public.users WHERE id=p_employee_id FOR SHARE;
  IF NOT FOUND OR owner_row.is_active IS DISTINCT FROM true OR owner_row.is_admin IS DISTINCT FROM false
     OR owner_row.role IS DISTINCT FROM 'sub_agent' OR lower(COALESCE(owner_row.username,''))='kinglike_admin' THEN
    RETURN false;
  END IF;

  SELECT value #>> '{}' INTO launch_text FROM public.kay_settings WHERE key='kay_operational_launch_at';
  IF launch_text IS NULL OR launch_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+04:00$' THEN
    RETURN false;
  END IF;
  launch_at := launch_text::timestamptz;

  IF lead_row.business_received_at IS NOT NULL THEN
    IF lead_row.business_received_at_source NOT IN ('ORIGINAL_BUSINESS_TIMESTAMP','TRUSTED_SOURCE_CREATED_AT') THEN
      RETURN false;
    END IF;
    received_at := lead_row.business_received_at;
  ELSE
    IF COALESCE(lower(lead_row.lead_source),'') ~ '(excel|csv|import|migration|admin|legacy|backfill|seed|system)' THEN
      RETURN false;
    END IF;
    received_at := lead_row.created_at AT TIME ZONE 'UTC';
  END IF;

  RETURN received_at IS NOT NULL AND received_at >= launch_at - interval '3 months';
END
$kay_scope_fence$;
REVOKE ALL ON FUNCTION public.kay_lock_mission_scope(integer,integer) FROM PUBLIC;
DO $grant_kay_scope_fence$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kay_internal_writer') THEN
    GRANT EXECUTE ON FUNCTION public.kay_lock_mission_scope(integer,integer) TO kay_internal_writer;
  END IF;
END $grant_kay_scope_fence$;
`;