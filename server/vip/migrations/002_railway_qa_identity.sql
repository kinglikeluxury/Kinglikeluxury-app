-- Isolated VIP QA only. Run on a new, empty vipqa_* database after 000/001/003.
-- This migration refuses customer/CRM/Kay objects and all existing rows.
BEGIN;
DO $$
DECLARE
  allowed_tables TEXT[] := ARRAY[
    'users',
    'vip_projects','vip_units','vip_unit_access','vip_progress_updates',
    'vip_installments','vip_receipts','vip_payment_postings','vip_finance_permissions',
    'vip_private_documents','vip_statement_requests','vip_invitations',
    'vip_project_photos','vip_project_cameras','vip_handover',
    'vip_handover_key_receipts','vip_handover_appointments','vip_handover_snags',
    'vip_member_cards','vip_referrals','vip_referral_links','vip_referral_rewards',
    'vip_notifications','vip_notification_preferences','vip_journey_milestones',
    'vip_benefits','vip_service_requests','vip_financial_adjustments',
    'vip_support_tickets','vip_support_messages','vip_exchange_rates',
    'vip_internal_commissions','vip_crm_sale_links','vip_audit_events',
    'vip_qa_sessions'
  ];
  table_name TEXT;
  has_rows BOOLEAN;
BEGIN
  IF to_regclass('public.users') IS NULL OR
     to_regclass('public.vip_projects') IS NULL OR
     to_regclass('public.vip_audit_events') IS NULL OR
     to_regclass('public.vip_qa_environment_identity') IS NOT NULL OR
     to_regclass('public.vip_qa_file_objects') IS NOT NULL OR
     to_regclass('public.vip_qa_sessions') IS NULL THEN
    RAISE EXCEPTION 'VIP QA identity migration requires the expected unseeded schema';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p')
      AND NOT (c.relname = ANY(allowed_tables))
  ) THEN
    RAISE EXCEPTION 'VIP QA identity migration refused an unexpected public table';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind NOT IN ('r','p','S','i','I')
  ) OR EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
  ) OR EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'VIP QA identity migration refused an unexpected public object';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class seq
    JOIN pg_namespace sn ON sn.oid = seq.relnamespace
    LEFT JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a','i')
    LEFT JOIN pg_class tbl ON tbl.oid = d.refobjid
    LEFT JOIN pg_namespace tn ON tn.oid = tbl.relnamespace
    WHERE sn.nspname = 'public' AND seq.relkind = 'S'
      AND (tn.nspname IS DISTINCT FROM 'public'
        OR tbl.relname IS NULL
        OR NOT (tbl.relname = ANY(allowed_tables)))
  ) THEN
    RAISE EXCEPTION 'VIP QA identity migration refused an unexpected public sequence';
  END IF;

  FOREACH table_name IN ARRAY allowed_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'VIP QA identity migration found an incomplete schema';
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', table_name)
      INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'VIP QA identity migration requires every business table to be empty';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.vip_qa_sessions) THEN
    RAISE EXCEPTION 'VIP QA identity migration requires an empty session table';
  END IF;
END;
$$;

CREATE TABLE public.vip_qa_environment_identity (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  environment_id UUID NOT NULL UNIQUE,
  classification TEXT NOT NULL CHECK (classification = 'synthetic-only'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.vip_qa_file_objects (
  object_key TEXT PRIMARY KEY
    CHECK (length(object_key) <= 512 AND object_key LIKE 'kinglike-vip/%'
      AND object_key !~ '(^|/)\.\.?(/|$)'),
  content_type TEXT NOT NULL
    CHECK (content_type IN ('application/pdf','image/jpeg','image/png')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  object_bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (size_bytes = octet_length(object_bytes))
);
COMMIT;
