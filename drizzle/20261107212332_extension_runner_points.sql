-- Extensions that do work: pipeline actions, assistant tools and analysis kinds.
--
-- Three more contribution points join object actions, panels and commands. The
-- manifest declares each one (inputs, outputs, how it runs), an administrator
-- can switch each point off per extension, and a webhook runner is signed with a
-- key sealed by the app. Direct-SQL installs are validated the same way the
-- TypeScript manifest check validates them (src/lib/extensions/points.ts).

-- Events ----------------------------------------------------------------------
INSERT INTO internal.webhook_event_names (name) VALUES
  ('extension.point.enabled'), ('extension.point.disabled'), ('extension.invoked')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Per-point switches ------------------------------------------------------------
ALTER TABLE api.extensions
  ADD COLUMN disabled_points text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE api.extensions
  ADD CONSTRAINT chk_extensions_disabled_points CHECK (
    disabled_points <@ ARRAY['pipeline-actions', 'assistant-tools', 'analysis-kinds']::text[]);
--> statement-breakpoint

CREATE FUNCTION api.set_extension_point_enabled(
    p_workspace_id uuid, p_extension_id uuid, p_point text, p_enabled boolean)
    RETURNS api.extensions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.extensions;
  v_next text[];
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'extensions.manage');
  IF p_point IS NULL OR p_point NOT IN ('pipeline-actions', 'assistant-tools', 'analysis-kinds') THEN
    RAISE EXCEPTION 'unknown extension point' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM api.extensions
   WHERE id = p_extension_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'extension not found' USING ERRCODE = 'SB036';
  END IF;
  IF coalesce(p_enabled, false) THEN
    v_next := array_remove(v.disabled_points, p_point);
  ELSIF p_point = ANY (v.disabled_points) THEN
    v_next := v.disabled_points;
  ELSE
    v_next := v.disabled_points || p_point;
  END IF;
  IF v_next IS NOT DISTINCT FROM v.disabled_points THEN
    RETURN v;
  END IF;
  UPDATE api.extensions SET
    disabled_points = v_next,
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
  WHERE id = p_extension_id
  RETURNING * INTO v;
  PERFORM internal.emit_change_event(p_workspace_id, 'extension', v.id, 'update', NULL, NULL,
    jsonb_build_object(
      'change', CASE WHEN coalesce(p_enabled, false) THEN 'point_enabled' ELSE 'point_disabled' END,
      'extensionKey', v.key, 'point', p_point));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_extension_point_enabled(uuid, uuid, text, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_extension_point_enabled(uuid, uuid, text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_extension_point_enabled(uuid, uuid, text, boolean) TO authenticated;
--> statement-breakpoint

-- The signing key a webhook runner's service checks. Sealed by the app, one per
-- extension, never readable through the API.
CREATE TABLE internal.extension_secrets (
    extension_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    ciphertext bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    CONSTRAINT extension_secrets_pkey PRIMARY KEY (extension_id)
);
--> statement-breakpoint
ALTER TABLE internal.extension_secrets OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE ONLY internal.extension_secrets
    ADD CONSTRAINT extension_secrets_extension_id_fk FOREIGN KEY (extension_id) REFERENCES api.extensions(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY internal.extension_secrets
    ADD CONSTRAINT extension_secrets_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint

-- Manifest validation ---------------------------------------------------------
CREATE FUNCTION internal.extension_fields_ok(p_fields jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_entry jsonb;
  v_seen text[] := '{}';
BEGIN
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields) > 24 THEN
    RETURN false;
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_fields) LOOP
    IF jsonb_typeof(v_entry) <> 'object'
       OR jsonb_typeof(v_entry->'name') IS DISTINCT FROM 'string'
       OR (v_entry->>'name') !~ '^[a-z][a-z0-9_]{0,47}$'
       OR jsonb_typeof(v_entry->'type') IS DISTINCT FROM 'string'
       OR (v_entry->>'type') NOT IN ('text', 'number', 'integer', 'boolean', 'date', 'json')
       OR jsonb_typeof(v_entry->'required') IS DISTINCT FROM 'boolean'
       OR ((v_entry ? 'description')
           AND (jsonb_typeof(v_entry->'description') IS DISTINCT FROM 'string'
                OR length(btrim(v_entry->>'description')) NOT BETWEEN 1 AND 300))
       OR (v_entry->>'name') = ANY (v_seen) THEN
      RETURN false;
    END IF;
    v_seen := v_seen || (v_entry->>'name');
  END LOOP;
  RETURN true;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.extension_fields_ok(jsonb) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.extension_runner_ok(p_runner jsonb, p_python_only boolean) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
BEGIN
  IF jsonb_typeof(p_runner) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  IF p_runner->>'kind' = 'webhook' AND NOT p_python_only THEN
    RETURN jsonb_typeof(p_runner->'url') = 'string'
       AND length(p_runner->>'url') <= 500
       AND (p_runner->>'url') ~ '^https://[^\s/@]+(/[^\s]*)?$';
  ELSIF p_runner->>'kind' = 'python' THEN
    RETURN jsonb_typeof(p_runner->'code') = 'string'
       AND length(btrim(p_runner->>'code')) >= 1
       AND length(p_runner->>'code') <= 20000;
  END IF;
  RETURN false;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.extension_runner_ok(jsonb, boolean) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.validate_extension_runner_points(p_manifest jsonb) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_point text;
  v_list jsonb;
  v_entry jsonb;
  v_item jsonb;
  v_seen text[];
  v_names text[];
  v_columns text[];
  v_numeric text[];
  v_chart jsonb;
  v_result jsonb;
BEGIN
  FOREACH v_point IN ARRAY ARRAY['pipeline-actions', 'assistant-tools', 'analysis-kinds'] LOOP
    IF (p_manifest->'contributions' ? v_point) IS DISTINCT FROM true THEN
      CONTINUE;
    END IF;
    v_list := p_manifest->'contributions'->v_point;
    IF jsonb_typeof(v_list) <> 'array' OR jsonb_array_length(v_list) > 25 THEN
      RAISE EXCEPTION 'invalid extension contributions' USING ERRCODE = 'SB034';
    END IF;
    v_seen := '{}';
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_list) LOOP
      IF jsonb_typeof(v_entry) <> 'object'
         OR jsonb_typeof(v_entry->'id') IS DISTINCT FROM 'string'
         OR (v_entry->>'id') !~ '^[a-z][a-z0-9-]{0,48}$'
         OR jsonb_typeof(v_entry->'title') IS DISTINCT FROM 'string'
         OR length(btrim(v_entry->>'title')) NOT BETWEEN 1 AND 120
         OR ((v_entry ? 'description')
             AND (jsonb_typeof(v_entry->'description') IS DISTINCT FROM 'string'
                  OR length(btrim(v_entry->>'description')) NOT BETWEEN 1 AND 600))
         OR (v_point = 'assistant-tools' AND (v_entry ? 'description') IS DISTINCT FROM true) THEN
        RAISE EXCEPTION 'invalid extension contributions' USING ERRCODE = 'SB034';
      END IF;
      IF (v_entry->>'id') = ANY (v_seen) THEN
        RAISE EXCEPTION 'duplicate extension contribution id' USING ERRCODE = 'SB034';
      END IF;
      v_seen := v_seen || (v_entry->>'id');
      IF v_point = 'pipeline-actions' THEN
        IF NOT internal.extension_fields_ok(v_entry->'inputs')
           OR NOT internal.extension_fields_ok(v_entry->'outputs')
           OR NOT internal.extension_runner_ok(v_entry->'runner', false) THEN
          RAISE EXCEPTION 'invalid extension pipeline action' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'assistant-tools' THEN
        IF (v_entry->>'access') IS NULL OR (v_entry->>'access') NOT IN ('read', 'write')
           OR jsonb_typeof(v_entry->'access') <> 'string'
           OR NOT internal.extension_fields_ok(v_entry->'inputs')
           OR NOT internal.extension_runner_ok(v_entry->'runner', false) THEN
          RAISE EXCEPTION 'invalid extension assistant tool' USING ERRCODE = 'SB034';
        END IF;
      ELSE
        IF jsonb_typeof(v_entry->'inputs') IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_entry->'inputs') NOT BETWEEN 1 AND 24
           OR NOT internal.extension_runner_ok(v_entry->'runner', true)
           OR jsonb_typeof(v_entry->'result') IS DISTINCT FROM 'object'
           OR jsonb_typeof(v_entry->'result'->'columns') IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_entry->'result'->'columns') NOT BETWEEN 1 AND 24 THEN
          RAISE EXCEPTION 'invalid extension analysis kind' USING ERRCODE = 'SB034';
        END IF;
        v_names := '{}';
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_entry->'inputs') LOOP
          IF jsonb_typeof(v_item) <> 'object'
             OR jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
             OR (v_item->>'name') !~ '^[a-z][a-z0-9_]{0,47}$'
             OR (v_item->>'name') = ANY (v_names)
             OR jsonb_typeof(v_item->'label') IS DISTINCT FROM 'string'
             OR length(btrim(v_item->>'label')) NOT BETWEEN 1 AND 80
             OR jsonb_typeof(v_item->'type') IS DISTINCT FROM 'string'
             OR (v_item->>'type') NOT IN ('number', 'category')
             OR jsonb_typeof(v_item->'required') IS DISTINCT FROM 'boolean' THEN
            RAISE EXCEPTION 'invalid extension analysis kind' USING ERRCODE = 'SB034';
          END IF;
          v_names := v_names || (v_item->>'name');
        END LOOP;
        v_result := v_entry->'result';
        v_columns := '{}';
        v_numeric := '{}';
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_result->'columns') LOOP
          IF jsonb_typeof(v_item) <> 'object'
             OR jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
             OR (v_item->>'name') !~ '^[a-z][a-z0-9_]{0,47}$'
             OR (v_item->>'name') = ANY (v_columns)
             OR jsonb_typeof(v_item->'type') IS DISTINCT FROM 'string'
             OR (v_item->>'type') NOT IN ('number', 'text') THEN
            RAISE EXCEPTION 'invalid extension analysis kind' USING ERRCODE = 'SB034';
          END IF;
          v_columns := v_columns || (v_item->>'name');
          IF (v_item->>'type') = 'number' THEN
            v_numeric := v_numeric || (v_item->>'name');
          END IF;
        END LOOP;
        IF v_result ? 'chart' THEN
          v_chart := v_result->'chart';
          IF jsonb_typeof(v_chart) <> 'object'
             OR jsonb_typeof(v_chart->'type') IS DISTINCT FROM 'string'
             OR (v_chart->>'type') NOT IN ('line', 'scatter', 'bar')
             OR jsonb_typeof(v_chart->'x') IS DISTINCT FROM 'string'
             OR NOT ((v_chart->>'x') = ANY (v_columns))
             OR jsonb_typeof(v_chart->'y') IS DISTINCT FROM 'string'
             OR NOT ((v_chart->>'y') = ANY (v_numeric))
             OR ((v_chart ? 'group')
                 AND (jsonb_typeof(v_chart->'group') IS DISTINCT FROM 'string'
                      OR NOT ((v_chart->>'group') = ANY (v_columns)))) THEN
            RAISE EXCEPTION 'invalid extension analysis kind' USING ERRCODE = 'SB034';
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.validate_extension_runner_points(jsonb) OWNER TO migrator;
--> statement-breakpoint

-- The main validator now knows the three points and checks them.
DO $$
DECLARE
  v_sig regprocedure := 'internal.validate_extension_manifest(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_points_old constant text := $q$NOT IN ('object-actions', 'panels', 'commands', 'event-subscriptions')$q$;
  v_points_new constant text := $q$NOT IN ('object-actions', 'panels', 'commands', 'event-subscriptions', 'pipeline-actions', 'assistant-tools', 'analysis-kinds')$q$;
  v_tail_old constant text := $q$  IF (p_manifest->'contributions' ? 'event-subscriptions') IS DISTINCT FROM true THEN$q$;
  v_tail_new constant text := $q$  PERFORM internal.validate_extension_runner_points(p_manifest);
  IF (p_manifest->'contributions' ? 'event-subscriptions') IS DISTINCT FROM true THEN$q$;
BEGIN
  IF position(v_points_old IN v_def) = 0 OR position(v_tail_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.validate_extension_manifest';
  END IF;
  v_def := replace(v_def, v_points_old, v_points_new);
  v_def := replace(v_def, v_tail_old, v_tail_new);
  EXECUTE v_def;
END $$;
