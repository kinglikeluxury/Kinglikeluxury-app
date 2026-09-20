BEGIN;

CREATE TABLE IF NOT EXISTS kay_internal_call_sessions (
  id SERIAL PRIMARY KEY,
  caller TEXT NOT NULL DEFAULT 'KAY' CHECK (caller = 'KAY'),
  target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  initiated_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'RINGING'
    CHECK (status IN ('RINGING', 'ACTIVE', 'REJECTED', 'BUSY', 'ENDED')),
  reason_code TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMP,
  ended_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS kay_internal_call_sessions_target_created_idx
  ON kay_internal_call_sessions(target_user_id, created_at);

CREATE TABLE IF NOT EXISTS kay_voice_one_turn_sessions (
  call_session_id INTEGER PRIMARY KEY REFERENCES kay_internal_call_sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PROCESSING'
    CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  failure_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMP
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kay_internal_writer') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE kay_internal_call_sessions TO kay_internal_writer;
    GRANT USAGE, SELECT ON SEQUENCE kay_internal_call_sessions_id_seq TO kay_internal_writer;
    GRANT SELECT, INSERT, UPDATE ON TABLE kay_voice_one_turn_sessions TO kay_internal_writer;
    REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON TABLE kay_internal_call_sessions FROM kay_internal_writer;
    REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON TABLE kay_voice_one_turn_sessions FROM kay_internal_writer;
  END IF;
END
$$;

COMMIT;