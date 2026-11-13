-- REVIEW ONLY — DO NOT RUN AUTOMATICALLY OR ON PRODUCTION.
-- Dedicated encrypted contact-state intake for a ONE-employee Staging pilot.
-- The associated application module is not mounted by server/index.ts.
-- Existing app, production, Neon and CRM databases must never be used.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'kinglike_whatsapp_archive' THEN
    RAISE EXCEPTION 'Expected isolated kinglike_whatsapp_archive database';
  END IF;
  IF current_user <> 'postgres' AND NOT pg_has_role(current_user,'pg_database_owner','member') THEN
    RAISE EXCEPTION 'Manual review requires a dedicated staging database owner';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kinglike_whatsapp.whatsapp_employee_contact_sync_inbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id BIGINT NOT NULL CHECK(employee_id > 0),
  waba_id TEXT NOT NULL CHECK(waba_id ~ '^[0-9]{4,24}$'),
  phone_number_id TEXT NOT NULL CHECK(phone_number_id ~ '^[0-9]{4,24}$'),
  display_phone_number TEXT NOT NULL CHECK(display_phone_number ~ '^[0-9]{8,24}$'),
  delivery_key TEXT NOT NULL CHECK(delivery_key ~ '^[a-f0-9]{64}$'),
  payload_ciphertext BYTEA NOT NULL,
  payload_iv BYTEA NOT NULL CHECK(octet_length(payload_iv)=12),
  payload_tag BYTEA NOT NULL CHECK(octet_length(payload_tag)=16),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','processing','processed','retry','blocked')),
  CONSTRAINT whatsapp_employee_contact_sync_dedupe
    UNIQUE(employee_id,waba_id,phone_number_id,delivery_key)
);
REVOKE ALL ON TABLE kinglike_whatsapp.whatsapp_employee_contact_sync_inbox FROM PUBLIC;
-- Do NOT grant writer access until company number, employee notice, customer
-- notice, retention, audit roles, and contact consumer are verified.
-- Explicit grants and retention/purge jobs need a separate reviewed migration.
COMMIT;
