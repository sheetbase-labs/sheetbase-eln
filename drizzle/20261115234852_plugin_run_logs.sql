-- What each plugin run did, for the administrators who manage plugins: when,
-- which function, whether it worked, how long it took, the error text and what
-- the plugin printed. Never the inputs or the answers. Kept 14 days and the
-- newest 200 runs per plugin. Written only by the app (internal.record_extension_run).
CREATE TABLE api.extension_run_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    extension_id uuid NOT NULL,
    extension_key text NOT NULL,
    -- What was run: operation, analysis, screen, column, action, step, rows ...
    kind text NOT NULL,
    -- The plugin's own function, as its manifest names it.
    entry text NOT NULL,
    ok boolean NOT NULL,
    duration_ms integer NOT NULL,
    error text,
    -- What the plugin printed, one line each.
    output text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT extension_run_logs_pkey PRIMARY KEY (id),
    CONSTRAINT extension_run_logs_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT extension_run_logs_extension_fk FOREIGN KEY (extension_id) REFERENCES api.extensions(id) ON DELETE CASCADE,
    CONSTRAINT chk_extension_run_logs_duration CHECK (duration_ms >= 0)
);
--> statement-breakpoint
ALTER TABLE api.extension_run_logs OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_extension_run_logs_extension ON api.extension_run_logs (extension_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE api.extension_run_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY extension_run_logs_select ON api.extension_run_logs FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.has_capability(workspace_id, 'extensions.manage'));
--> statement-breakpoint
CREATE POLICY extension_run_logs_select_api_client ON api.extension_run_logs FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id() AND api.has_capability(workspace_id, 'extensions.manage'));
--> statement-breakpoint
GRANT SELECT ON TABLE api.extension_run_logs TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION internal.record_extension_run(
    p_workspace_id uuid, p_extension_id uuid, p_extension_key text, p_kind text, p_entry text,
    p_ok boolean, p_duration_ms integer, p_error text, p_output text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO api.extension_run_logs
    (workspace_id, extension_id, extension_key, kind, entry, ok, duration_ms, error, output)
  VALUES
    (p_workspace_id, p_extension_id, p_extension_key, left(p_kind, 40), left(p_entry, 200), p_ok,
     greatest(p_duration_ms, 0), left(p_error, 4000), coalesce(p_output, '{}'::text[]));
  DELETE FROM api.extension_run_logs
   WHERE extension_id = p_extension_id
     AND (created_at < now() - interval '14 days'
          OR id NOT IN (SELECT id FROM api.extension_run_logs
                         WHERE extension_id = p_extension_id
                         ORDER BY created_at DESC, id DESC LIMIT 200));
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.record_extension_run(uuid, uuid, text, text, text, boolean, integer, text, text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_extension_run(uuid, uuid, text, text, text, boolean, integer, text, text[]) FROM PUBLIC;
