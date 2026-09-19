BEGIN;

-- Kay recording metadata only. Audio remains in private S3-compatible storage.
-- This artifact is intentionally separate from the CRM database and is not
-- startup-wired by the application.
CREATE TABLE IF NOT EXISTS kay_recording_sessions (
  id SERIAL PRIMARY KEY,
  archive_type TEXT NOT NULL
    CHECK (archive_type IN ('EMPLOYEE_CALL', 'MANAGER_DEBRIEF')),
  call_session_id INTEGER UNIQUE,
  employee_id INTEGER,
  employee_name TEXT,
  counterpart_name TEXT,
  call_started_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  recording_status TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (recording_status IN ('NOT_STARTED', 'NOTICE_PENDING', 'NOTICE_PLAYED',
      'NOTICE_FAILED', 'RECORDING', 'FINALIZING', 'UPLOADING', 'READY', 'FAILED')),
  notice_status TEXT NOT NULL DEFAULT 'NOT_PLAYED'
    CHECK (notice_status IN ('NOT_PLAYED', 'PLAYED', 'FAILED')),
  notice_played_at TIMESTAMPTZ,
  notice_failure_reason TEXT,
  storage_object_key TEXT,
  media_type TEXT,
  storage_upload_status TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (storage_upload_status IN ('NOT_STARTED', 'PENDING', 'COMPLETE', 'FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kay_recording_sessions_archive_created_idx
  ON kay_recording_sessions(archive_type, created_at DESC);
CREATE INDEX IF NOT EXISTS kay_recording_sessions_employee_created_idx
  ON kay_recording_sessions(employee_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kay_internal_writer') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE kay_recording_sessions TO kay_internal_writer;
    GRANT USAGE, SELECT ON SEQUENCE kay_recording_sessions_id_seq TO kay_internal_writer;
    REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON TABLE kay_recording_sessions FROM kay_internal_writer;
  END IF;
END
$$;

COMMIT;