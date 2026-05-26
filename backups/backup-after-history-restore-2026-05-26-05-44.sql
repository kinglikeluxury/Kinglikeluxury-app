-- ============================================================
-- Kinglike Luxury Real Estate — Full Database Backup
-- Created: 2026-05-26T05:44:23.832Z
-- PostgreSQL server version 17 (Neon)
-- Includes: schema + sequences + indexes + data
-- ============================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;
SET search_path TO public;

-- ── Sequences ─────────────────────────────────────────────────
-- Skipped sequence ai_conversations_id_seq: column "increment_by" does not exist
-- Skipped sequence ai_lead_scores_id_seq: column "increment_by" does not exist
-- Skipped sequence ai_messages_id_seq: column "increment_by" does not exist
-- Skipped sequence blog_posts_id_seq: column "increment_by" does not exist
-- Skipped sequence consultation_bookings_id_seq: column "increment_by" does not exist
-- Skipped sequence consultation_time_slots_id_seq: column "increment_by" does not exist
-- Skipped sequence contact_logs_id_seq: column "increment_by" does not exist
-- Skipped sequence investor_profiles_id_seq: column "increment_by" does not exist
-- Skipped sequence notification_logs_id_seq: column "increment_by" does not exist
-- Skipped sequence notification_templates_id_seq: column "increment_by" does not exist
-- Skipped sequence payments_id_seq: column "increment_by" does not exist
-- Skipped sequence projects_id_seq: column "increment_by" does not exist
-- Skipped sequence properties_id_seq: column "increment_by" does not exist
-- Skipped sequence push_subscriptions_id_seq: column "increment_by" does not exist
-- Skipped sequence user_notifications_id_seq: column "increment_by" does not exist
-- Skipped sequence users_id_seq: column "increment_by" does not exist
-- Skipped sequence verification_codes_id_seq: column "increment_by" does not exist

-- ── Table Schemas ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."ai_conversations" (
  "id" integer DEFAULT nextval('ai_conversations_id_seq'::regclass) NOT NULL,
  "user_id" integer NOT NULL,
  "language" text DEFAULT 'en'::text,
  "status" text DEFAULT 'active'::text,
  "message_count" integer DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."ai_lead_scores" (
  "id" integer DEFAULT nextval('ai_lead_scores_id_seq'::regclass) NOT NULL,
  "investor_profile_id" integer NOT NULL,
  "score" text NOT NULL,
  "reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."ai_messages" (
  "id" integer DEFAULT nextval('ai_messages_id_seq'::regclass) NOT NULL,
  "conversation_id" integer NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."blog_posts" (
  "id" integer DEFAULT nextval('blog_posts_id_seq'::regclass) NOT NULL,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "content" text NOT NULL,
  "excerpt" text NOT NULL,
  "cover_image" text NOT NULL,
  "author_id" integer NOT NULL,
  "categories" jsonb NOT NULL,
  "published" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "country" text DEFAULT 'georgia'::text NOT NULL,
  "translations" jsonb,
  "cover_video" text,
  "old_slugs" text[]
);

CREATE TABLE IF NOT EXISTS public."consultation_bookings" (
  "id" integer DEFAULT nextval('consultation_bookings_id_seq'::regclass) NOT NULL,
  "user_id" integer,
  "property_id" integer,
  "property_title" text,
  "slot_id" integer,
  "country" text NOT NULL,
  "consultation_type" text NOT NULL,
  "consultation_method" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "budget" text,
  "notes" text,
  "email" text,
  "whatsapp_contact_number" text,
  "meeting_link" text,
  "user_phone" text NOT NULL,
  "user_language" text DEFAULT 'en'::text,
  "admin_notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."consultation_time_slots" (
  "id" integer DEFAULT nextval('consultation_time_slots_id_seq'::regclass) NOT NULL,
  "date" text NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "is_available" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."contact_logs" (
  "id" integer DEFAULT nextval('contact_logs_id_seq'::regclass) NOT NULL,
  "property_id" integer NOT NULL,
  "contactor_id" integer,
  "contactor_name" text DEFAULT 'زائر'::text NOT NULL,
  "contactor_phone" text,
  "owner_name" text,
  "owner_phone" text,
  "property_title" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."investor_profiles" (
  "id" integer DEFAULT nextval('investor_profiles_id_seq'::regclass) NOT NULL,
  "conversation_id" integer,
  "user_id" integer NOT NULL,
  "account_phone" text,
  "whatsapp_contact_number" text,
  "email" text,
  "language" text,
  "goal" text,
  "budget" text,
  "payment_preference" text,
  "country" text,
  "city" text,
  "interested_project" text,
  "timeline" text,
  "communication_method" text,
  "summary" text,
  "lead_score" text DEFAULT 'cold'::text,
  "score_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."notification_logs" (
  "id" integer DEFAULT nextval('notification_logs_id_seq'::regclass) NOT NULL,
  "user_id" integer,
  "type" text NOT NULL,
  "trigger" text NOT NULL,
  "recipient" text,
  "status" text NOT NULL,
  "error" text,
  "sent_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."notification_templates" (
  "id" integer DEFAULT nextval('notification_templates_id_seq'::regclass) NOT NULL,
  "type" text NOT NULL,
  "trigger" text NOT NULL,
  "subject" text,
  "body_html" text,
  "body_text" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."payments" (
  "id" integer DEFAULT nextval('payments_id_seq'::regclass) NOT NULL,
  "property_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "amount" integer NOT NULL,
  "currency" text DEFAULT 'USD'::text NOT NULL,
  "payment_method" text NOT NULL,
  "payment_intent_id" text,
  "paypal_order_id" text,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "duration_days" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."projects" (
  "id" integer DEFAULT nextval('projects_id_seq'::regclass) NOT NULL,
  "property_id" integer NOT NULL,
  "developer" text NOT NULL,
  "completion_date" text NOT NULL,
  "project_status" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."properties" (
  "id" integer DEFAULT nextval('properties_id_seq'::regclass) NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "price" integer NOT NULL,
  "location" text NOT NULL,
  "area" text NOT NULL,
  "bedrooms" integer,
  "bathrooms" integer,
  "property_type" text NOT NULL,
  "images" jsonb NOT NULL,
  "features" jsonb NOT NULL,
  "status" text DEFAULT 'approved'::text NOT NULL,
  "owner_id" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "listing_type" text DEFAULT 'regular'::text NOT NULL,
  "listing_expires_at" timestamp,
  "videos" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "floor_number" integer,
  "amenities" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "location_score" integer DEFAULT 70,
  "value_score" integer DEFAULT 65,
  "amenities_score" integer DEFAULT 60,
  "condition_score" integer DEFAULT 75,
  "investment_score" integer DEFAULT 68,
  "overall_score" integer DEFAULT 70,
  "latitude" text,
  "longitude" text,
  "top_rated" boolean DEFAULT false,
  "ready_status" text,
  "is_sold" boolean DEFAULT false NOT NULL,
  "price_max" integer,
  "land_type" text,
  "land_features" jsonb DEFAULT '[]'::jsonb,
  "payment_method" text,
  "down_payment_percent" integer,
  "installment_duration" text,
  "best_price" boolean DEFAULT false,
  "title_en" text,
  "description_en" text,
  "acceptable_price" boolean DEFAULT false,
  "high_price" boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public."push_subscriptions" (
  "id" integer DEFAULT nextval('push_subscriptions_id_seq'::regclass) NOT NULL,
  "user_id" integer NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."session" (
  "sid" varchar NOT NULL,
  "sess" json NOT NULL,
  "expire" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS public."user_notifications" (
  "id" integer DEFAULT nextval('user_notifications_id_seq'::regclass) NOT NULL,
  "user_id" integer NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "data" jsonb,
  "is_read" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."users" (
  "id" integer DEFAULT nextval('users_id_seq'::regclass) NOT NULL,
  "username" text NOT NULL,
  "password" text,
  "email" text,
  "phone_number" text,
  "whatsapp_number" text,
  "facebook_id" text,
  "auth_method" text DEFAULT 'email'::text NOT NULL,
  "is_verified" boolean DEFAULT false NOT NULL,
  "is_admin" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."verification_codes" (
  "id" integer DEFAULT nextval('verification_codes_id_seq'::regclass) NOT NULL,
  "phone_number" text NOT NULL,
  "code" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "verified" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- ── Unique Constraints ─────────────────────────────────────────
DO $$ BEGIN ALTER TABLE public."push_subscriptions" ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint"); EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- ── Indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON public.push_subscriptions USING btree (endpoint);

-- ── Data ──────────────────────────────────────────────────────
-- users: 0 rows

-- properties: 0 rows

-- projects: 0 rows

-- blog_posts: 0 rows

-- verification_codes: 0 rows

-- contact_logs: 0 rows

-- payments: 0 rows

-- notification_logs: 0 rows

-- notification_templates: 0 rows

-- session: 0 rows

-- consultation_time_slots: 0 rows

-- consultation_bookings: 0 rows

-- user_notifications: 0 rows

-- push_subscriptions: 0 rows

-- ai_conversations: 0 rows

-- ai_messages: 0 rows

-- investor_profiles: 0 rows

-- ai_lead_scores: 0 rows

-- ── Sequence Reset (after data import) ─────────────────────────
SELECT setval('public."ai_conversations_id_seq"', COALESCE((SELECT MAX(id) FROM public."ai_conversations"), 1), true);
SELECT setval('public."ai_lead_scores_id_seq"', COALESCE((SELECT MAX(id) FROM public."ai_lead_scores"), 1), true);
SELECT setval('public."ai_messages_id_seq"', COALESCE((SELECT MAX(id) FROM public."ai_messages"), 1), true);
SELECT setval('public."blog_posts_id_seq"', COALESCE((SELECT MAX(id) FROM public."blog_posts"), 1), true);
SELECT setval('public."consultation_bookings_id_seq"', COALESCE((SELECT MAX(id) FROM public."consultation_bookings"), 1), true);
SELECT setval('public."consultation_time_slots_id_seq"', COALESCE((SELECT MAX(id) FROM public."consultation_time_slots"), 1), true);
SELECT setval('public."contact_logs_id_seq"', COALESCE((SELECT MAX(id) FROM public."contact_logs"), 1), true);
SELECT setval('public."investor_profiles_id_seq"', COALESCE((SELECT MAX(id) FROM public."investor_profiles"), 1), true);
SELECT setval('public."notification_logs_id_seq"', COALESCE((SELECT MAX(id) FROM public."notification_logs"), 1), true);
SELECT setval('public."notification_templates_id_seq"', COALESCE((SELECT MAX(id) FROM public."notification_templates"), 1), true);
SELECT setval('public."payments_id_seq"', COALESCE((SELECT MAX(id) FROM public."payments"), 1), true);
SELECT setval('public."projects_id_seq"', COALESCE((SELECT MAX(id) FROM public."projects"), 1), true);
SELECT setval('public."properties_id_seq"', COALESCE((SELECT MAX(id) FROM public."properties"), 1), true);
SELECT setval('public."push_subscriptions_id_seq"', COALESCE((SELECT MAX(id) FROM public."push_subscriptions"), 1), true);
SELECT setval('public."user_notifications_id_seq"', COALESCE((SELECT MAX(id) FROM public."user_notifications"), 1), true);
SELECT setval('public."users_id_seq"', COALESCE((SELECT MAX(id) FROM public."users"), 1), true);
SELECT setval('public."verification_codes_id_seq"', COALESCE((SELECT MAX(id) FROM public."verification_codes"), 1), true);

-- ============================================================
-- End of backup — 2026-05-26T05:44:26.098Z
-- Total tables: 18 | Total rows: 0
-- ============================================================