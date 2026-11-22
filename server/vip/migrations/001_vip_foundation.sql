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
-- The unit's selling agent is the only non-admin staff member authorized to
-- view this buyer's file. Reassignments revoke the previous grant first.
CREATE UNIQUE INDEX IF NOT EXISTS vip_unit_access_one_active_seller_per_unit_idx
  ON vip_unit_access(unit_id) WHERE revoked_at IS NULL AND access_role = 'seller';

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
  source_note VARCHAR(200),
  mime_type TEXT CHECK(mime_type IS NULL OR mime_type='application/pdf'),
  size_bytes INTEGER CHECK(size_bytes IS NULL OR size_bytes BETWEEN 10 AND 10485760),
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
  status TEXT NOT NULL DEFAULT 'not_ready'
    CHECK (status IN ('not_ready','ready_for_appointment','appointment_scheduled',
      'inspection_completed','snags_open','handover_approved','keys_delivered')),
  scheduled_at TIMESTAMPTZ,
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  inspection_note TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Appointment times proposed by clients require explicit Kinglike confirmation.
CREATE TABLE IF NOT EXISTS vip_handover_appointments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_id BIGINT NOT NULL REFERENCES vip_units(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  preferred_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','confirmed','declined')),
  handled_by INTEGER REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vip_one_pending_handover_appointment_per_unit
  ON vip_handover_appointments(unit_id) WHERE status='requested';
CREATE INDEX IF NOT EXISTS vip_handover_appointments_by_unit
  ON vip_handover_appointments(unit_id,requested_at DESC);
-- Issues are tracked independently of the checklist, and resolution is audited.
CREATE TABLE IF NOT EXISTS vip_handover_snags (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_id BIGINT NOT NULL REFERENCES vip_units(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  resolution_note TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vip_handover_snags_by_unit
  ON vip_handover_snags(unit_id,status,created_at DESC);
-- Anonymous member cards are not proofs of identity or guaranteed benefits.
CREATE TABLE IF NOT EXISTS vip_member_cards (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  member_code VARCHAR(28) NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'VIP' CHECK (tier IN ('VIP','Silver','Gold','Platinum')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vip_referrals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referrer_user_id INTEGER NOT NULL REFERENCES users(id),
  lead_name VARCHAR(100) NOT NULL,
  lead_phone_e164 VARCHAR(16) NOT NULL CHECK (lead_phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  contact_consent BOOLEAN NOT NULL CHECK (contact_consent=TRUE),
  consented_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','contacted','qualified','converted','declined')),
  source TEXT NOT NULL DEFAULT 'direct' CHECK(source IN ('direct','share_link')),
  sale_reference VARCHAR(80),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(referrer_user_id,lead_phone_e164)
);
CREATE UNIQUE INDEX IF NOT EXISTS vip_referral_unique_sale_reference
  ON vip_referrals(sale_reference) WHERE sale_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS vip_referrals_status_idx ON vip_referrals(status,created_at DESC);

-- Rewards require a documented conversion and separate administrative approval.
-- One random anonymous share link per VIP owner.
CREATE TABLE IF NOT EXISTS vip_referral_links (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  code VARCHAR(36) NOT NULL UNIQUE CHECK (code ~ '^KLR-[A-F0-9]{32}$'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS vip_referral_rewards (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referral_id BIGINT NOT NULL UNIQUE REFERENCES vip_referrals(id),
  description VARCHAR(250) NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','approved','declined','fulfilled')),
  proposed_by INTEGER NOT NULL REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- In-app customer messages. No SMS, email, push or WhatsApp is sent.
CREATE TABLE IF NOT EXISTS vip_notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  unit_id BIGINT REFERENCES vip_units(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('admin_update')),
  title VARCHAR(90) NOT NULL,
  body VARCHAR(700) NOT NULL,
  created_by INTEGER REFERENCES users(id),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vip_notifications_by_owner
  ON vip_notifications(user_id,created_at DESC);

-- Stage history can be edited by management, but only published events appear
-- in the owner's timeline. This is not a legal signature or payment receipt.
CREATE TABLE IF NOT EXISTS vip_journey_milestones (
  unit_id BIGINT NOT NULL REFERENCES vip_units(id),
  stage_code TEXT NOT NULL CHECK (stage_code IN ('reservation','contract','down_payment','construction','inspection','handover')),
  status TEXT NOT NULL CHECK (status IN ('planned','in_progress','completed')),
  planned_date DATE,
  actual_date DATE,
  note VARCHAR(600),
  published BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by INTEGER NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(unit_id,stage_code),
  CHECK (status <> 'completed' OR actual_date IS NOT NULL)
);
-- Promotional terms are not contractual guarantees.
CREATE TABLE IF NOT EXISTS vip_benefits (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('second_purchase','fit_out','furnishing','after_sales','other')),
  title VARCHAR(120) NOT NULL,
  details VARCHAR(1300) NOT NULL,
  valid_until DATE,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Service requests are owner-only, per-property and do not auto-accept offers.
CREATE TABLE IF NOT EXISTS vip_service_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_id BIGINT NOT NULL REFERENCES vip_units(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  service_type TEXT NOT NULL CHECK (service_type IN ('fit_out','furnishing','utilities','rental_management','other')),
  details VARCHAR(1200) NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','reviewing','offered','in_progress','completed','closed')),
  admin_reply VARCHAR(900),
  reviewed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vip_service_requests_by_unit ON vip_service_requests(unit_id,created_at DESC);

-- A documented fee or adjustment is not automatically a payment obligation.
-- Draft notes cannot be published to a buyer.
CREATE TABLE IF NOT EXISTS vip_financial_adjustments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_id BIGINT NOT NULL REFERENCES vip_units(id),
  category TEXT NOT NULL CHECK(category IN ('tax','penalty','maintenance','service_fee','credit','discount','other')),
  amount NUMERIC(16,2) NOT NULL CHECK(amount>0),
  currency VARCHAR(3) NOT NULL,
  description VARCHAR(300) NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('developer_statement','signed_contract','internal_note')),
  source_reference VARCHAR(180),
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at TIMESTAMPTZ,
  voided_by INTEGER REFERENCES users(id),
  CHECK(NOT published OR (source<>'internal_note' AND length(coalesce(source_reference,''))>=8))
);
CREATE INDEX IF NOT EXISTS vip_financial_adjustments_by_unit
 ON vip_financial_adjustments(unit_id,created_at DESC);
CREATE TABLE IF NOT EXISTS vip_audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id),
  event_type TEXT NOT NULL,
  unit_id BIGINT REFERENCES vip_units(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
