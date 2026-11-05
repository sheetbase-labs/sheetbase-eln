-- Result limits: a lab can say what a good result looks like.
--
-- A number field on a record model (a titre, a purity, a pH) can carry limits:
-- a lowest and highest acceptable value, and an optional alert band inside
-- them. A result outside the limits is out of specification; a result inside
-- the limits but outside the alert band is an alert; anything else passes.
-- Nothing is stored per result: the verdict is worked out from the limits and
-- the value every time it is read, so changing a limit re-judges every record.
--
-- The feature is a lab choice (Settings > General, "Result limits"). With it
-- off the view returns nothing and nobody is shown a verdict.

ALTER TABLE api.workspace_settings
    ADD COLUMN spec_limits_enabled boolean DEFAULT false NOT NULL;
--> statement-breakpoint

CREATE TABLE api.field_spec_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    kind text NOT NULL,
    field_name text NOT NULL,
    lower_limit numeric,
    upper_limit numeric,
    alert_lower numeric,
    alert_upper numeric,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text NOT NULL,
    updated_by_user_id text,
    CONSTRAINT field_spec_limits_pkey PRIMARY KEY (id),
    CONSTRAINT field_spec_limits_unique UNIQUE (workspace_id, kind, field_name),
    CONSTRAINT chk_field_spec_limits_some CHECK (
      lower_limit IS NOT NULL OR upper_limit IS NOT NULL),
    CONSTRAINT chk_field_spec_limits_order CHECK (
      (lower_limit IS NULL OR upper_limit IS NULL OR lower_limit <= upper_limit)
      AND (alert_lower IS NULL OR lower_limit IS NULL OR alert_lower >= lower_limit)
      AND (alert_upper IS NULL OR upper_limit IS NULL OR alert_upper <= upper_limit)
      AND (alert_lower IS NULL OR alert_upper IS NULL OR alert_lower <= alert_upper)),
    CONSTRAINT chk_field_spec_limits_note CHECK (note IS NULL OR length(note) <= 500)
);
--> statement-breakpoint
ALTER TABLE api.field_spec_limits OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.field_spec_limits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY field_spec_limits_select ON api.field_spec_limits FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.field_spec_limits TO authenticated;
--> statement-breakpoint

CREATE FUNCTION internal.spec_limits_on(p_workspace_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce((SELECT s.spec_limits_enabled FROM api.workspace_settings s
                    WHERE s.workspace_id = p_workspace_id), false);
$$;
--> statement-breakpoint
ALTER FUNCTION internal.spec_limits_on(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.spec_limits_on(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION internal.spec_limits_on(uuid) TO authenticated;
--> statement-breakpoint

-- The verdict for one value. No value, no verdict.
CREATE FUNCTION internal.spec_verdict(
    p_value numeric, p_lower numeric, p_upper numeric, p_alert_lower numeric, p_alert_upper numeric)
RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN (p_lower IS NOT NULL AND p_value < p_lower)
      OR (p_upper IS NOT NULL AND p_value > p_upper) THEN 'fail'
    WHEN (p_alert_lower IS NOT NULL AND p_value < p_alert_lower)
      OR (p_alert_upper IS NOT NULL AND p_value > p_alert_upper) THEN 'alert'
    ELSE 'pass'
  END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.spec_verdict(numeric, numeric, numeric, numeric, numeric) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.spec_verdict(numeric, numeric, numeric, numeric, numeric) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION internal.spec_verdict(numeric, numeric, numeric, numeric, numeric) TO authenticated;
--> statement-breakpoint

-- One row per record per limited field that holds a number. Reads under the
-- caller's own row-level security, so a person sees verdicts only for records
-- they can already see.
CREATE VIEW api.record_spec_results WITH (security_invoker = 'true') AS
SELECT r.id AS record_id,
       r.workspace_id,
       r.kind,
       r.identifier,
       r.title,
       r.project_id,
       r.archived_at,
       s.field_name,
       v.value,
       s.lower_limit,
       s.upper_limit,
       s.alert_lower,
       s.alert_upper,
       internal.spec_verdict(v.value, s.lower_limit, s.upper_limit, s.alert_lower, s.alert_upper) AS verdict
  FROM api.records r
  JOIN api.field_spec_limits s ON s.workspace_id = r.workspace_id AND s.kind = r.kind
 CROSS JOIN LATERAL (
   SELECT CASE
            WHEN jsonb_typeof(r.custom_fields -> s.field_name) = 'number'
              THEN (r.custom_fields ->> s.field_name)::numeric
            WHEN jsonb_typeof(r.custom_fields -> s.field_name) = 'string'
             AND btrim(r.custom_fields ->> s.field_name) ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
              THEN btrim(r.custom_fields ->> s.field_name)::numeric
          END AS value
 ) v
 WHERE r.deleted_at IS NULL
   AND v.value IS NOT NULL
   AND internal.spec_limits_on(r.workspace_id);
--> statement-breakpoint
ALTER VIEW api.record_spec_results OWNER TO migrator;
--> statement-breakpoint
GRANT SELECT ON api.record_spec_results TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.set_spec_limits_enabled(p_workspace_id uuid, p_enabled boolean) RETURNS api.workspace_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v api.workspace_settings;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid result limits setting' USING ERRCODE = 'SB057';
  END IF;
  INSERT INTO api.workspace_settings (workspace_id, spec_limits_enabled, created_by_user_id)
  VALUES (p_workspace_id, p_enabled, api.current_user_id())
  ON CONFLICT (workspace_id) DO UPDATE SET spec_limits_enabled = p_enabled, updated_at = now()
  RETURNING * INTO v;
  PERFORM internal.emit_change_event(v.workspace_id, 'workspace_settings', v.workspace_id, 'update', NULL, NULL,
    jsonb_build_object('effect', 'spec_limits', 'specLimitsEnabled', v.spec_limits_enabled));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_spec_limits_enabled(uuid, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_spec_limits_enabled(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_spec_limits_enabled(uuid, boolean) TO authenticated;
--> statement-breakpoint

-- Set, change or clear the limits on one number field. Clearing is "all four
-- values empty".
CREATE FUNCTION api.set_field_spec_limits(
    p_kind text, p_field_name text,
    p_lower numeric DEFAULT NULL, p_upper numeric DEFAULT NULL,
    p_alert_lower numeric DEFAULT NULL, p_alert_upper numeric DEFAULT NULL,
    p_note text DEFAULT NULL)
RETURNS api.field_spec_limits
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_row api.field_spec_limits;
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  IF NOT EXISTS (SELECT 1 FROM api.record_field_definitions d
                  WHERE d.workspace_id = v_workspace_id AND d.kind = p_kind
                    AND d.field_name = p_field_name AND d.lifecycle = 'active'
                    AND d.logical_type IN ('integer', 'decimal')) THEN
    RAISE EXCEPTION 'limits can only be set on an active number field' USING ERRCODE = '22023';
  END IF;
  IF p_lower IS NULL AND p_upper IS NULL AND p_alert_lower IS NULL AND p_alert_upper IS NULL THEN
    DELETE FROM api.field_spec_limits
     WHERE workspace_id = v_workspace_id AND kind = p_kind AND field_name = p_field_name
    RETURNING * INTO v_row;
    IF v_row.id IS NOT NULL THEN
      PERFORM internal.emit_change_event(v_workspace_id, 'record_field_definition', v_row.id, 'update', NULL, NULL,
        jsonb_build_object('effect', 'spec_limits_cleared', 'kind', p_kind, 'fieldName', p_field_name));
    END IF;
    RETURN v_row;
  END IF;
  IF p_lower IS NULL AND p_upper IS NULL THEN
    RAISE EXCEPTION 'set a lowest or highest acceptable value' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.field_spec_limits
    (workspace_id, kind, field_name, lower_limit, upper_limit, alert_lower, alert_upper, note,
     created_by_user_id, updated_by_user_id)
  VALUES (v_workspace_id, p_kind, p_field_name, p_lower, p_upper, p_alert_lower, p_alert_upper,
          nullif(btrim(p_note), ''), api.current_user_id(), api.current_user_id())
  ON CONFLICT (workspace_id, kind, field_name) DO UPDATE
     SET lower_limit = EXCLUDED.lower_limit, upper_limit = EXCLUDED.upper_limit,
         alert_lower = EXCLUDED.alert_lower, alert_upper = EXCLUDED.alert_upper,
         note = EXCLUDED.note, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
  RETURNING * INTO v_row;
  PERFORM internal.emit_change_event(v_workspace_id, 'record_field_definition', v_row.id, 'update', NULL, NULL,
    jsonb_build_object('effect', 'spec_limits', 'kind', p_kind, 'fieldName', p_field_name));
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_field_spec_limits(text, text, numeric, numeric, numeric, numeric, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_field_spec_limits(text, text, numeric, numeric, numeric, numeric, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_field_spec_limits(text, text, numeric, numeric, numeric, numeric, text) TO authenticated;
