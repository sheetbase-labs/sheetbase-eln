-- API-002: exposed surface and privilege model.
--
-- Roles themselves are created once per cluster by docker/db/init/00-roles.sh
-- (they carry passwords from the environment, which migrations must not
-- contain). The database is owned by migrator, which also runs this
-- migration. This file defines what the request and service roles can reach.

-- internal: everything PostgREST must never see. api: the exposed surface.
CREATE SCHEMA IF NOT EXISTS internal;
CREATE SCHEMA IF NOT EXISTS api;

-- Nothing user-owned lives in public; strip the broad defaults.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM anon;
REVOKE ALL ON SCHEMA public FROM authenticated;

-- authenticator only connects and switches role; it holds no table rights.
GRANT USAGE ON SCHEMA api TO authenticator;

-- Request roles can see the exposed schema exists and nothing more. Table,
-- view and RPC grants are per-object in the migration that creates them.
GRANT USAGE ON SCHEMA api TO anon;
GRANT USAGE ON SCHEMA api TO authenticated;

-- No default privileges: a table that forgets its GRANTs fails closed.
ALTER DEFAULT PRIVILEGES IN SCHEMA api REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA api REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- service_role reaches internal for narrowly controlled service operations;
-- per-object grants arrive with the operations that need them.
GRANT USAGE ON SCHEMA internal TO service_role;
