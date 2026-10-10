-- DSET-01.1 — value flags.
--
-- A flag records that a recorded value is out of range, missing a unit, above
-- a curve or a high replicate CV. The value is unchanged; the flag excludes it
-- from criteria and analyses until cleared. Written through the RPCs below;
-- rows are read under RLS for workspace members.

CREATE UNIQUE INDEX uq_dataset_value_flags_active
  ON api.dataset_value_flags (dataset_id, row_id, field_id, kind)
  WHERE cleared_at IS NULL;
--> statement-breakpoint

REVOKE ALL ON api.dataset_value_flags FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT SELECT ON api.dataset_value_flags TO authenticated;
--> statement-breakpoint
ALTER TABLE api.dataset_value_flags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY dataset_value_flags_select ON api.dataset_value_flags
  FOR SELECT TO authenticated
  USING (
    workspace_id = api.current_workspace_id()
    AND api.is_workspace_member(workspace_id)
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.flag_dataset_value(
  p_dataset_id uuid,
  p_row_id uuid,
  p_field_id uuid,
  p_kind text,
  p_reason text,
  p_comment text DEFAULT NULL
)
RETURNS api.dataset_value_flags
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  d api.datasets;
  v api.dataset_value_flags;
BEGIN
  IF p_kind NOT IN ('out_of_range', 'missing_unit', 'above_curve', 'high_cv') THEN
    RAISE EXCEPTION 'unknown flag kind' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'a reason is required to flag a value' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM api.datasets
    WHERE id = p_dataset_id AND workspace_id = api.current_workspace_id()
      AND api.is_workspace_writer(workspace_id) AND api.has_write_actor()
    FOR UPDATE;
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'Dataset denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.dataset_rows r
    WHERE r.id = p_row_id AND r.dataset_id = d.id
  ) THEN
    RAISE EXCEPTION 'row not found in Dataset' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.dataset_schema_version_fields f
    WHERE f.schema_version_id = d.schema_version_id AND f.field_id = p_field_id
  ) THEN
    RAISE EXCEPTION 'field not found in Dataset schema' USING ERRCODE = '22023';
  END IF;

  INSERT INTO api.dataset_value_flags
    (workspace_id, dataset_id, row_id, field_id, kind, reason, comment,
     set_by_user_id, set_at)
  VALUES
    (d.workspace_id, d.id, p_row_id, p_field_id, p_kind, btrim(p_reason),
     nullif(btrim(coalesce(p_comment, '')), ''), api.current_user_id(), now())
  ON CONFLICT (dataset_id, row_id, field_id, kind) WHERE cleared_at IS NULL
  DO UPDATE SET reason = EXCLUDED.reason, comment = EXCLUDED.comment,
                set_by_user_id = EXCLUDED.set_by_user_id, set_at = now()
  RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.flag_dataset_value(uuid, uuid, uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.flag_dataset_value(uuid, uuid, uuid, text, text, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.clear_dataset_value_flag(p_flag_id uuid)
RETURNS api.dataset_value_flags
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.dataset_value_flags;
BEGIN
  SELECT f.* INTO v FROM api.dataset_value_flags f
    WHERE f.id = p_flag_id AND f.workspace_id = api.current_workspace_id()
      AND api.is_workspace_writer(f.workspace_id) AND api.has_write_actor()
    FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'flag not found in active workspace' USING ERRCODE = '42501';
  END IF;
  UPDATE api.dataset_value_flags
    SET cleared_at = now(), cleared_by_user_id = api.current_user_id()
    WHERE id = v.id
    RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.clear_dataset_value_flag(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.clear_dataset_value_flag(uuid) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
