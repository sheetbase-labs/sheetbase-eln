-- One connections table for every place a pipeline reaches: a web call's https
-- address and an HPC cluster are both `api.pipeline_connections`, told apart by
-- `kind`. A cluster keeps its scheduler user, queues and callback address in
-- `settings`; its token is a named sealed secret beside the connection, like a
-- web call's (`HPC_SUBMIT_KEY`). Cluster connections that were registered as
-- connectors move here, with their secret, and the old connector is archived.

ALTER TABLE api.pipeline_connections
  ADD COLUMN kind text DEFAULT 'web' NOT NULL,
  ADD COLUMN settings jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE api.pipeline_connections
  ADD CONSTRAINT chk_pipeline_connections_kind CHECK (kind IN ('web', 'hpc'));
--> statement-breakpoint

-- What is wrong with a connection's settings for its kind, or null.
CREATE FUNCTION internal.pipeline_connection_settings_error(p_kind text, p_settings jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_queue jsonb;
BEGIN
  IF jsonb_typeof(p_settings) IS DISTINCT FROM 'object' THEN
    RETURN 'A connection''s settings are an object.';
  END IF;
  IF p_kind = 'web' THEN
    IF p_settings <> '{}'::jsonb THEN
      RETURN 'A web connection has no settings beyond its address.';
    END IF;
    RETURN NULL;
  END IF;
  IF coalesce(p_settings->>'scheduler', 'slurm') <> 'slurm' THEN
    RETURN 'Slurm is the only scheduler a cluster connection supports.';
  END IF;
  IF jsonb_typeof(p_settings->'user') IS DISTINCT FROM 'string'
    OR length(btrim(p_settings->>'user')) NOT BETWEEN 1 AND 64 THEN
    RETURN 'A cluster connection needs the user jobs run as.';
  END IF;
  IF jsonb_typeof(p_settings->'queues') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_settings->'queues') NOT BETWEEN 1 AND 50 THEN
    RETURN 'A cluster connection offers 1 to 50 queues.';
  END IF;
  FOR v_queue IN SELECT value FROM jsonb_array_elements(p_settings->'queues') LOOP
    IF jsonb_typeof(v_queue) IS DISTINCT FROM 'object'
      OR jsonb_typeof(v_queue->'name') IS DISTINCT FROM 'string'
      OR v_queue->>'name' !~ '^[a-z0-9][a-z0-9_.-]{0,62}$' THEN
      RETURN 'A queue is named with lowercase letters, digits, dots, underscores and hyphens.';
    END IF;
    IF v_queue ? 'maxMinutes' AND (
      jsonb_typeof(v_queue->'maxMinutes') IS DISTINCT FROM 'number'
      OR (v_queue->>'maxMinutes')::numeric <> trunc((v_queue->>'maxMinutes')::numeric)
      OR (v_queue->>'maxMinutes')::numeric < 1) THEN
      RETURN 'A queue''s longest job is a whole number of minutes.';
    END IF;
  END LOOP;
  IF p_settings ? 'callbackUrl' AND (
    jsonb_typeof(p_settings->'callbackUrl') IS DISTINCT FROM 'string'
    OR p_settings->>'callbackUrl' !~ '^https?://[^\s/@?#]+(/[^\s?#]*)?$') THEN
    RETURN 'The address jobs call back on is an http or https address.';
  END IF;
  IF p_settings ? 'apiVersion' AND (
    jsonb_typeof(p_settings->'apiVersion') IS DISTINCT FROM 'string'
    OR p_settings->>'apiVersion' !~ '^v[0-9]+\.[0-9]+\.[0-9]+$') THEN
    RETURN 'The scheduler API version looks like v0.0.40.';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.pipeline_connection_settings_error(text, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.pipeline_connection_settings_error(text, jsonb) FROM PUBLIC;
--> statement-breakpoint

ALTER TABLE api.pipeline_connections DROP CONSTRAINT chk_pipeline_connections_url;
--> statement-breakpoint
ALTER TABLE api.pipeline_connections
  ADD CONSTRAINT chk_pipeline_connections_url CHECK (
    length(base_url) <= 2048 AND (
      (kind = 'web' AND base_url ~ '^https://[^\s/@?#]+(/[^\s?#]*)?$')
      OR (kind = 'hpc' AND base_url ~ '^https?://[^\s/@?#]+(/[^\s?#]*)?$')
    )
  ),
  ADD CONSTRAINT chk_pipeline_connections_settings CHECK (
    internal.pipeline_connection_settings_error(kind, settings) IS NULL
  );
--> statement-breakpoint
COMMENT ON COLUMN api.pipeline_connections.kind IS 'web: an https address a web call step reaches. hpc: a cluster scheduler a remote job step sends jobs to.';
--> statement-breakpoint
COMMENT ON COLUMN api.pipeline_connections.settings IS 'hpc only: scheduler, user, queues [{name, maxMinutes}], callbackUrl, apiVersion. Never a secret.';
--> statement-breakpoint

-- The calls people and agents make learn the kind and the settings.
DROP FUNCTION api.create_pipeline_connection(uuid, text, text, text, text, text, text);
--> statement-breakpoint
CREATE FUNCTION api.create_pipeline_connection(
    p_workspace_id uuid, p_key text, p_name text, p_base_url text,
    p_description text DEFAULT NULL, p_auth_header text DEFAULT NULL, p_auth_scheme text DEFAULT NULL,
    p_kind text DEFAULT 'web', p_settings jsonb DEFAULT NULL
) RETURNS api.pipeline_connections
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.pipeline_connections;
  v_kind text := coalesce(p_kind, 'web');
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_error text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  IF v_kind NOT IN ('web', 'hpc') THEN
    RAISE EXCEPTION 'A connection is a web address or an HPC cluster.' USING ERRCODE = 'SB034';
  END IF;
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9-]{0,48}$' THEN
    RAISE EXCEPTION 'A connection key is lowercase letters, digits and hyphens.' USING ERRCODE = 'SB034';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A connection needs a name.' USING ERRCODE = 'SB034';
  END IF;
  IF p_base_url IS NULL
    OR length(p_base_url) > 2048
    OR (v_kind = 'web' AND p_base_url !~ '^https://[^\s/@?#]+(/[^\s?#]*)?$')
    OR (v_kind = 'hpc' AND p_base_url !~ '^https?://[^\s/@?#]+(/[^\s?#]*)?$') THEN
    RAISE EXCEPTION 'A connection address is an https address with no password, query or fragment.' USING ERRCODE = 'SB034';
  END IF;
  v_error := internal.pipeline_connection_settings_error(v_kind, v_settings);
  IF v_error IS NOT NULL THEN
    RAISE EXCEPTION '%', v_error USING ERRCODE = 'SB034';
  END IF;
  INSERT INTO api.pipeline_connections(
    workspace_id, key, name, description, base_url, auth_header, auth_scheme, kind, settings,
    created_by_user_id, updated_by_user_id
  ) VALUES (
    p_workspace_id, p_key, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
    rtrim(p_base_url, '/'),
    coalesce(nullif(btrim(p_auth_header), ''), 'Authorization'),
    coalesce(p_auth_scheme, 'Bearer'),
    v_kind, v_settings,
    api.current_user_id(), api.current_user_id()
  ) RETURNING * INTO v;
  PERFORM internal.emit_change_event(p_workspace_id, 'pipeline_connection', v.id, 'create', NULL, NULL,
    jsonb_build_object('connectionId', v.id, 'key', v.key, 'name', v.name, 'kind', v.kind, 'baseUrl', v.base_url));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_pipeline_connection(uuid, text, text, text, text, text, text, text, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_pipeline_connection(uuid, text, text, text, text, text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_pipeline_connection(uuid, text, text, text, text, text, text, text, jsonb) TO authenticated, api_client;
--> statement-breakpoint

DROP FUNCTION api.update_pipeline_connection(uuid, uuid, text, text, text, text, text, text);
--> statement-breakpoint
CREATE FUNCTION api.update_pipeline_connection(
    p_workspace_id uuid, p_connection_id uuid, p_name text DEFAULT NULL, p_base_url text DEFAULT NULL,
    p_description text DEFAULT NULL, p_status text DEFAULT NULL,
    p_auth_header text DEFAULT NULL, p_auth_scheme text DEFAULT NULL, p_settings jsonb DEFAULT NULL
) RETURNS api.pipeline_connections
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.pipeline_connections;
  v_error text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  SELECT * INTO v FROM api.pipeline_connections
   WHERE id = p_connection_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_name IS NOT NULL AND length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A connection needs a name.' USING ERRCODE = 'SB034';
  END IF;
  IF p_base_url IS NOT NULL AND (
    length(p_base_url) > 2048
    OR (v.kind = 'web' AND p_base_url !~ '^https://[^\s/@?#]+(/[^\s?#]*)?$')
    OR (v.kind = 'hpc' AND p_base_url !~ '^https?://[^\s/@?#]+(/[^\s?#]*)?$')) THEN
    RAISE EXCEPTION 'A connection address is an https address with no password, query or fragment.' USING ERRCODE = 'SB034';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'off') THEN
    RAISE EXCEPTION 'A connection is active or off.' USING ERRCODE = 'SB034';
  END IF;
  IF p_settings IS NOT NULL THEN
    v_error := internal.pipeline_connection_settings_error(v.kind, p_settings);
    IF v_error IS NOT NULL THEN
      RAISE EXCEPTION '%', v_error USING ERRCODE = 'SB034';
    END IF;
  END IF;
  UPDATE api.pipeline_connections SET
    name = coalesce(btrim(p_name), name),
    base_url = coalesce(rtrim(p_base_url, '/'), base_url),
    description = CASE WHEN p_description IS NULL THEN description ELSE nullif(btrim(p_description), '') END,
    status = coalesce(p_status, status),
    auth_header = coalesce(nullif(btrim(p_auth_header), ''), auth_header),
    auth_scheme = coalesce(p_auth_scheme, auth_scheme),
    settings = coalesce(p_settings, settings),
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
   WHERE id = v.id
   RETURNING * INTO v;
  PERFORM internal.emit_change_event(p_workspace_id, 'pipeline_connection', v.id, 'update', NULL, NULL,
    jsonb_build_object('connectionId', v.id, 'key', v.key, 'name', v.name, 'kind', v.kind, 'baseUrl', v.base_url, 'status', v.status));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.update_pipeline_connection(uuid, uuid, text, text, text, text, text, text, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_pipeline_connection(uuid, uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_pipeline_connection(uuid, uuid, text, text, text, text, text, text, jsonb) TO authenticated, api_client;
--> statement-breakpoint

-- Removing a connection is refused while a published version still uses it,
-- whichever step kind that is.
CREATE OR REPLACE FUNCTION api.delete_pipeline_connection(p_workspace_id uuid, p_connection_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.pipeline_connections;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  SELECT * INTO v FROM api.pipeline_connections
   WHERE id = p_connection_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'SB036';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM api.pipeline_definition_versions pv,
           jsonb_array_elements(pv.configuration->'steps') s
     WHERE pv.workspace_id = p_workspace_id
       AND pv.lifecycle = 'published'
       AND (
         (s->>'kind' = 'web_call' AND s->'webCall'->>'connection' = v.key)
         OR (s->>'kind' = 'remote_job' AND s->'remoteJob'->>'connection' = v.key)
       )
  ) THEN
    RAISE EXCEPTION 'A published pipeline uses this connection. Switch it off instead, or publish a version without it first.' USING ERRCODE = 'SB034';
  END IF;
  DELETE FROM api.pipeline_connections WHERE id = v.id;
  PERFORM internal.emit_change_event(p_workspace_id, 'pipeline_connection', v.id, 'delete', NULL, NULL,
    jsonb_build_object('connectionId', v.id, 'key', v.key, 'name', v.name, 'kind', v.kind));
END $$;
--> statement-breakpoint

-- Cluster connections that were registered as connectors move across, with
-- their token sealed under the secret name steps use by default.
INSERT INTO api.pipeline_connections (
    workspace_id, key, name, base_url, kind, settings, status,
    created_by_user_id, updated_by_user_id, created_at, updated_at
  )
  SELECT c.workspace_id, c.key, c.name, rtrim(c.config->>'baseUrl', '/'), 'hpc',
         jsonb_strip_nulls(jsonb_build_object(
           'scheduler', coalesce(c.config->>'scheduler', 'slurm'),
           'user', c.config->>'user',
           'queues', c.config->'queues',
           'callbackUrl', nullif(c.config->>'callbackUrl', ''),
           'apiVersion', c.config->>'apiVersion')),
         CASE WHEN c.status = 'active' THEN 'active' ELSE 'off' END,
         c.created_by_user_id, c.updated_by_user_id, c.created_at, c.updated_at
    FROM api.connectors c
   WHERE c.connector_type = 'custom'
     AND c.config->>'adapter' = 'hpc'
     AND c.status <> 'archived'
     AND coalesce(c.config->>'baseUrl', '') ~ '^https?://[^\s/@?#]+(/[^\s?#]*)?$'
     AND internal.pipeline_connection_settings_error('hpc', jsonb_strip_nulls(jsonb_build_object(
           'scheduler', coalesce(c.config->>'scheduler', 'slurm'),
           'user', c.config->>'user',
           'queues', c.config->'queues',
           'callbackUrl', nullif(c.config->>'callbackUrl', ''),
           'apiVersion', c.config->>'apiVersion'))) IS NULL
  ON CONFLICT (workspace_id, key) DO NOTHING;
--> statement-breakpoint
INSERT INTO internal.pipeline_connection_secrets (workspace_id, connection_id, secret_name, ciphertext, created_at, updated_at)
  SELECT DISTINCT ON (pc.id) s.workspace_id, pc.id, 'HPC_SUBMIT_KEY', s.ciphertext, s.created_at, s.updated_at
    FROM internal.connector_secrets s
    JOIN api.connectors c ON c.id = s.connector_id AND c.workspace_id = s.workspace_id
    JOIN api.pipeline_connections pc ON pc.workspace_id = c.workspace_id AND pc.key = c.key AND pc.kind = 'hpc'
   WHERE s.secret_name IN ('hpc_submit_key', 'submit_key')
   ORDER BY pc.id, (s.secret_name = 'hpc_submit_key') DESC
  ON CONFLICT (connection_id, secret_name) DO NOTHING;
--> statement-breakpoint
UPDATE api.pipeline_connections pc
   SET secret_names = ARRAY(
     SELECT s.secret_name FROM internal.pipeline_connection_secrets s
      WHERE s.connection_id = pc.id ORDER BY s.secret_name)
 WHERE pc.kind = 'hpc';
--> statement-breakpoint
UPDATE api.connectors c
   SET status = 'archived', updated_at = now()
  FROM api.pipeline_connections pc
 WHERE pc.kind = 'hpc' AND pc.workspace_id = c.workspace_id AND pc.key = c.key
   AND c.connector_type = 'custom' AND c.config->>'adapter' = 'hpc';
