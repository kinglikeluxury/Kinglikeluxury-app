-- KINGLIKE VIP foundation. REVIEW AND APPLY IN ISOLATED STAGING ONLY.
-- Never run automatically during application startup. No existing table is modified.
BEGIN;
CREATE TABLE IF NOT EXISTS vip_projects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  developer_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vip_units (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES vip_projects(id),
  unit_number TEXT NOT NULL,
  floor_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, unit_number)
);
CREATE TABLE IF NOT EXISTS vip_unit_access (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_id BIGINT NOT NULL REFERENCES vip_units(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  access_role TEXT NOT NULL CHECK (access_role IN ('owner','seller')),
  granted_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS vip_unit_access_active_unique
  ON vip_unit_access(unit_id,user_id,access_role) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS vip_unit_access_member_idx
  ON vip_unit_access(user_id,access_role,unit_id) WHERE revoked_at IS NULL;
-- The initial VIP release assigns exactly one active buyer to each unit.
CREATE UNIQUE INDEX IF NOT EXISTS vip_unit_access_one_active_owner_per_unit_idx
  ON vip_unit_access(unit_id) WHERE revoked_at IS NULL AND access_role = 'owner';

CREATE TABLE IF NOT EXISTS vip_progress_updates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES vip_projects(id),
  percent_complete INTEGER NOT NULL CHECK (percent_complete BETWEEN 0 AND 100),
  stage TEXT NOT NULL,
  note TEXT,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vip_progress_by_project_idx
  ON vip_progress_updates(project_id,created_at DESC);

CREATE TABLE IF NOT EXISTS vip_installments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_id BIGINT NOT NULL REFERENCES vip_units(id),
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  due_date DATE NOT NULL,
  amount NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(unit_id,sequence_number)
);
CREATE TABLE IF NOT EXISTS vip_receipts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  installment_id BIGINT NOT NULL REFERENCES vip_installments(id),
  object_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  upload_source TEXT NOT NULL CHECK (upload_source IN ('client','admin','whatsapp','email')),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vip_receipts_pending_idx ON vip_receipts(review_status,created_at);

CREATE TABLE IF NOT EXISTS vip_payment_postings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  installment_id BIGINT NOT NULL REFERENCES vip_installments(id),
  receipt_id BIGINT REFERENCES vip_receipts(id),
  amount NUMERIC(16,2) NOT NULL CHECK (amount <> 0),
  currency VARCHAR(3) NOT NULL,
  verified_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A receipt may credit an installment only once.
CREATE UNIQUE INDEX IF NOT EXISTS vip_payment_postings_unique_receipt
  ON vip_payment_postings(receipt_id) WHERE receipt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS vip_finance_permissions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  can_approve BOOLEAN NOT NULL DEFAULT FALSE,
  granted_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vip_private_documents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_id BIGINT NOT NULL REFERENCES vip_units(id),
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  object_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  category TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vip_statement_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_id BIGINT NOT NULL REFERENCES vip_units(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  month_start DATE NOT NULL CHECK (EXTRACT(DAY FROM month_start) = 1),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','following_up','received','available','closed')),
  official_document_id BIGINT REFERENCES vip_private_documents(id),
  handled_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(unit_id,requested_by,month_start)
);
-- Email-based account invitations; invite tokens are stored only as SHA-256 hashes.
-- The pending row is the only unclaimed invitation for a unit.
CREATE TABLE IF NOT EXISTS vip_invitations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_id BIGINT NOT NULL REFERENCES vip_units(id),
  invited_email TEXT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','revoked')),
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','sent','failed')),
  invited_by INTEGER NOT NULL REFERENCES users(id),
  claimed_by INTEGER REFERENCES users(id),
  sent_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vip_one_pending_invitation_per_unit
  ON vip_invitations(unit_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS vip_invitations_recent_idx ON vip_invitations(unit_id,created_at DESC);

CREATE TABLE IF NOT EXISTS vip_project_photos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES vip_projects(id),
  object_path TEXT NOT NULL UNIQUE,
  photo_date DATE NOT NULL,
  caption TEXT,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 8 AND 8388608),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vip_project_cameras (
  project_id BIGINT PRIMARY KEY REFERENCES vip_projects(id),
  label TEXT NOT NULL,
  embed_url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by INTEGER NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vip_handover (
  unit_id BIGINT PRIMARY KEY REFERENCES vip_units(id),
  status TEXT NOT NULL DEFAULT 'not_ready',
  scheduled_at TIMESTAMPTZ,
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vip_referrals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referrer_user_id INTEGER NOT NULL REFERENCES users(id),
  lead_name TEXT NOT NULL,
  lead_phone_e164 TEXT NOT NULL,
  contact_consent BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vip_audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id),
  event_type TEXT NOT NULL,
  unit_id BIGINT REFERENCES vip_units(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
