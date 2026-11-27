-- Dedicated persistent sessions for the isolated VIP QA application.
-- The runtime role receives DML only through the owner provisioning step.
BEGIN;
CREATE TABLE public.vip_qa_sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL
);
CREATE INDEX vip_qa_sessions_expire_idx
  ON public.vip_qa_sessions(expire);
COMMIT;
