-- What a plugin's Python needs and how much room it gets.
--
-- The packages a plugin installs and the hosts it may reach are copied from its
-- package when an administrator adds or updates it. The limits are the
-- administrator's own per-plugin settings and survive updates. The environment
-- columns record the build of the plugin's pip packages in the Python runner,
-- keyed by a hash of the base image and the package list, so two plugins that
-- need the same packages share one build.
ALTER TABLE internal.extension_packages
    ADD COLUMN requirements text[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN network_hosts text[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN limit_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN environment_id text,
    ADD COLUMN environment_state text NOT NULL DEFAULT 'none',
    ADD COLUMN environment_error text,
    ADD COLUMN environment_updated_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE internal.extension_packages
    ADD CONSTRAINT chk_extension_packages_limit_overrides CHECK (jsonb_typeof(limit_overrides) = 'object'),
    ADD CONSTRAINT chk_extension_packages_environment_state CHECK (environment_state IN ('none', 'building', 'ready', 'failed'));
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES ('extension.settings.changed')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Declaration bounds in the manifest validator were chosen by the build, not by
-- the lab. They stay as sanity bounds far above any real plugin.
DO $$
DECLARE
  v_sig regprocedure := 'internal.extension_fields_ok(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := 'jsonb_array_length(p_fields) > 24';
  v_new constant text := 'jsonb_array_length(p_fields) > 500';
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.extension_fields_ok';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
--> statement-breakpoint
DO $$
DECLARE
  v_sig regprocedure := 'internal.validate_extension_runner_points(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
BEGIN
  IF position('jsonb_array_length(v_list) > 25' IN v_def) = 0
     OR position($q$jsonb_array_length(v_entry->'inputs') NOT BETWEEN 1 AND 24$q$ IN v_def) = 0
     OR position($q$jsonb_array_length(v_entry->'result'->'columns') NOT BETWEEN 1 AND 24$q$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.validate_extension_runner_points';
  END IF;
  v_def := replace(v_def, 'jsonb_array_length(v_list) > 25', 'jsonb_array_length(v_list) > 1000');
  v_def := replace(v_def, $q$jsonb_array_length(v_entry->'inputs') NOT BETWEEN 1 AND 24$q$, $q$jsonb_array_length(v_entry->'inputs') NOT BETWEEN 1 AND 500$q$);
  v_def := replace(v_def, $q$jsonb_array_length(v_entry->'result'->'columns') NOT BETWEEN 1 AND 24$q$, $q$jsonb_array_length(v_entry->'result'->'columns') NOT BETWEEN 1 AND 500$q$);
  EXECUTE v_def;
END $$;
