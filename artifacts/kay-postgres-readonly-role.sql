-- Kay PostgreSQL read-only role template.
--
-- Provision this on the production CRM database using an existing dedicated
-- login whose credential is stored only as KAY_ANALYSIS_DATABASE_URL.
-- It is intentionally a template: replace psql variables at deploy time and
-- never commit credentials. Review with the database owner before execution.
-- This file is not an instruction to run DDL against production.
--
-- Required variables:
--   readonly_role (for example kay_readonly)
--   target_database
--   target_schema (normally public)

\set ON_ERROR_STOP on
\if :{?readonly_role}
\else
\echo 'readonly_role is required' >&2
\quit 2
\endif
\if :{?target_database}
\else
\echo 'target_database is required' >&2
\quit 2
\endif
\if :{?target_schema}
\else
\echo 'target_schema is required' >&2
\quit 2
\endif

BEGIN;
SELECT format('CREATE ROLE %I LOGIN', :'readonly_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'readonly_role') \gexec
ALTER ROLE :"readonly_role" NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
ALTER ROLE :"readonly_role" SET default_transaction_read_only = on;
REVOKE TEMPORARY ON DATABASE :"target_database" FROM PUBLIC;
REVOKE CREATE ON SCHEMA :"target_schema" FROM PUBLIC;
REVOKE ALL ON DATABASE :"target_database" FROM :"readonly_role";
GRANT CONNECT ON DATABASE :"target_database" TO :"readonly_role";
REVOKE CREATE, TEMPORARY ON DATABASE :"target_database" FROM :"readonly_role";
REVOKE ALL ON SCHEMA :"target_schema" FROM :"readonly_role";
GRANT USAGE ON SCHEMA :"target_schema" TO :"readonly_role";
REVOKE CREATE ON SCHEMA :"target_schema" FROM :"readonly_role";
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA :"target_schema" FROM :"readonly_role";
GRANT SELECT ON ALL TABLES IN SCHEMA :"target_schema" TO :"readonly_role";
REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA :"target_schema" FROM :"readonly_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA :"target_schema"
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM :"readonly_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA :"target_schema"
  GRANT SELECT ON TABLES TO :"readonly_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA :"target_schema"
  REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM :"readonly_role";
COMMIT;

-- To retire the role, review ownership/dependencies first, then explicitly:
-- REVOKE CONNECT ON DATABASE :"target_database" FROM :"readonly_role";
-- DROP ROLE :"readonly_role";