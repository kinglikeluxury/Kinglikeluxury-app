-- Additive, non-destructive schema for private AI editorial drafts.
-- Apply only after selecting the intended non-production database.
CREATE TABLE IF NOT EXISTS ai_blog_drafts (
  id SERIAL PRIMARY KEY,
  business_date TEXT NOT NULL,
  country TEXT NOT NULL CHECK (country IN ('georgia','turkey','syria','azerbaijan','northern-cyprus')),
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','needs_verification','ready_for_review','rejected','published','failed')),
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  seo_description TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  cover_image TEXT NOT NULL DEFAULT '',
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_note TEXT,
  safe_error_code TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  published_post_id INTEGER REFERENCES blog_posts(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_blog_drafts_business_date_country_uq UNIQUE (business_date,country)
);
CREATE INDEX IF NOT EXISTS ai_blog_drafts_status_idx ON ai_blog_drafts(status);

CREATE TABLE IF NOT EXISTS ai_blog_schedule_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  time_georgia TEXT NOT NULL DEFAULT '09:00'
    CHECK (time_georgia ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
INSERT INTO ai_blog_schedule_settings (id, enabled, time_georgia)
VALUES (1, FALSE, '09:00')
ON CONFLICT (id) DO NOTHING;
