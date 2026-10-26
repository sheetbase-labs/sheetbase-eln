-- Give a Dataset column that was recorded without a unit one.
--
-- Moving a dataset to a schema version that changes units is refused: a unit
-- change is semantic and values are never transformed. Assigning a unit to a
-- numeric column that never had one is the one case that needs no
-- transformation, only a statement of what the recorded numbers always were. It
-- is a deliberate, reasoned act, so it is its own RPC: it forks the schema
-- version with the unit set, publishes it, moves the dataset (every row keeps
-- its value), records who did it and why, and clears the missing-unit flags on
-- the column with that reason. Snapshots already taken stay on their version.

CREATE FUNCTION api.set_dataset_column_unit(p_dataset_id uuid, p_field_key text, p_unit text, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_dataset api.datasets;
  v_current api.dataset_schema_versions;
  v_latest_version integer;
  v_field api.dataset_schema_version_fields;
  v_next jsonb;
  v_next_id uuid;
  v_next_version integer;
  v_fields jsonb;
  v_flag record;
  v_cleared integer := 0;
BEGIN
  SELECT * INTO v_dataset FROM api.datasets WHERE id = p_dataset_id FOR UPDATE;
  IF v_dataset.id IS NULL OR NOT api.is_workspace_writer(v_dataset.workspace_id)
    OR NOT internal.can_access_object('dataset', v_dataset.id, 'edit') THEN
    RAISE EXCEPTION 'dataset not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(v_dataset.workspace_id, 'schema.publish');
  IF v_dataset.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'an archived dataset cannot be changed' USING ERRCODE = '55000';
  END IF;
  IF p_unit IS NULL OR length(btrim(p_unit)) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'a unit of 1 to 40 characters is required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_current FROM api.dataset_schema_versions WHERE id = v_dataset.schema_version_id;
  SELECT max(version) INTO v_latest_version FROM api.dataset_schema_versions WHERE schema_id = v_current.schema_id;
  IF v_current.version <> v_latest_version THEN
    RAISE EXCEPTION 'move the dataset to the latest schema version first' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_field FROM api.dataset_schema_version_fields
   WHERE schema_version_id = v_current.id AND key = p_field_key AND lifecycle = 'active';
  IF v_field.id IS NULL THEN
    RAISE EXCEPTION 'that column is not in the schema' USING ERRCODE = '22023';
  END IF;
  IF v_field.logical_type NOT IN ('integer', 'decimal') THEN
    RAISE EXCEPTION 'only a numeric column carries a unit' USING ERRCODE = '22023';
  END IF;
  IF v_field.quantity IS NOT NULL THEN
    RAISE EXCEPTION 'that column already has a unit; a unit is never reassigned' USING ERRCODE = '22023';
  END IF;

  v_next := api.create_next_dataset_schema_version(v_current.schema_id);
  v_next_id := (v_next->>'schema_version_id')::uuid;
  v_next_version := (v_next->>'version')::integer;
  SELECT jsonb_agg(jsonb_build_object(
      'field_id', f.field_id, 'key', f.key, 'label', f.label, 'description', f.description,
      'logical_type', f.logical_type, 'nullable', f.nullable, 'default_value', f.default_value,
      'quantity', CASE WHEN f.key = p_field_key
        THEN jsonb_build_object('kind', 'quantity', 'symbol', btrim(p_unit), 'dimension', btrim(p_unit), 'storageUnit', btrim(p_unit))
        ELSE f.quantity END,
      'validation', f.validation, 'category', f.category, 'relationship', f.relationship,
      'cardinality', f.cardinality, 'lifecycle', f.lifecycle, 'display_order', f.display_order
    ) ORDER BY f.display_order)
    INTO v_fields
    FROM api.dataset_schema_version_fields f WHERE f.schema_version_id = v_next_id;
  PERFORM api.replace_dataset_schema_version_fields(v_next_id, v_fields);
  PERFORM api.publish_dataset_schema_version(v_next_id);

  UPDATE api.datasets
     SET schema_version_id = v_next_id, revision = revision + 1, updated_at = now()
   WHERE id = v_dataset.id;
  PERFORM internal.emit_change_event(v_dataset.workspace_id, 'dataset', v_dataset.id, 'update',
    NULL, v_dataset.primary_project_id,
    jsonb_build_object(
      'effect', 'dataset_column_unit',
      'datasetId', v_dataset.id,
      'datasetRevision', v_dataset.revision + 1,
      'reason', btrim(p_reason),
      'changes', jsonb_build_object(
        'unit', jsonb_build_object('from', NULL, 'to', btrim(p_unit), 'label', 'Unit of ' || v_field.label))));

  FOR v_flag IN
    SELECT id FROM api.dataset_value_flags
     WHERE dataset_id = v_dataset.id AND field_id = v_field.field_id
       AND kind = 'missing_unit' AND cleared_at IS NULL
  LOOP
    PERFORM api.clear_dataset_value_flag(v_flag.id, btrim(p_reason));
    v_cleared := v_cleared + 1;
  END LOOP;

  RETURN jsonb_build_object('schemaVersion', v_next_version, 'clearedFlags', v_cleared);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_dataset_column_unit(p_dataset_id uuid, p_field_key text, p_unit text, p_reason text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_dataset_column_unit(p_dataset_id uuid, p_field_key text, p_unit text, p_reason text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_dataset_column_unit(p_dataset_id uuid, p_field_key text, p_unit text, p_reason text) TO authenticated;
