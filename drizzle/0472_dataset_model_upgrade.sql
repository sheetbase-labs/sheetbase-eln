-- Move a dataset onto a newer published version of its model, after a preview.
--
-- Row values are keyed by the field's stable id, so a dataset can follow its
-- model to a later version without touching a single value when the change only
-- adds fields. The preview says what the new version adds, drops or retypes; the
-- upgrade is allowed only for a version of the same model that is published,
-- newer, drops nothing, retypes nothing, and adds only fields that existing rows
-- can leave empty. Anything else is refused with the cause, so the person knows
-- whether to ask a steward for a different version or to migrate the data.
-- Snapshots already taken keep the version they were taken on.
CREATE OR REPLACE FUNCTION "api"."preview_dataset_model_upgrade"(
  p_dataset_id uuid,
  p_target_version_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_dataset api.datasets;
  v_current api.dataset_schema_versions;
  v_target api.dataset_schema_versions;
  v_added jsonb;
  v_removed jsonb;
  v_retyped jsonb;
  v_required jsonb;
  v_reason text;
  v_rows bigint;
BEGIN
  SELECT * INTO v_dataset FROM api.datasets WHERE id = p_dataset_id;
  IF v_dataset.id IS NULL OR NOT api.is_workspace_member(v_dataset.workspace_id)
    OR NOT internal.can_access_object('dataset', v_dataset.id, 'view') THEN
    RAISE EXCEPTION 'dataset not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_current FROM api.dataset_schema_versions WHERE id = v_dataset.schema_version_id;
  SELECT v.* INTO v_target
    FROM api.dataset_schema_versions v
    JOIN api.dataset_schema_definitions d ON d.id = v.schema_id
   WHERE v.id = p_target_version_id AND d.workspace_id = v_dataset.workspace_id;
  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'model version not found' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'label', t.label, 'type', t.logical_type)
                            ORDER BY t.display_order), '[]'::jsonb)
    INTO v_added
    FROM api.dataset_schema_version_fields t
   WHERE t.schema_version_id = v_target.id AND t.lifecycle = 'active'
     AND NOT EXISTS (SELECT 1 FROM api.dataset_schema_version_fields c
                      WHERE c.schema_version_id = v_current.id AND c.field_id = t.field_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label)
                            ORDER BY c.display_order), '[]'::jsonb)
    INTO v_removed
    FROM api.dataset_schema_version_fields c
   WHERE c.schema_version_id = v_current.id AND c.lifecycle = 'active'
     AND NOT EXISTS (SELECT 1 FROM api.dataset_schema_version_fields t
                      WHERE t.schema_version_id = v_target.id AND t.field_id = c.field_id
                        AND t.lifecycle = 'active');
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label,
                                               'from', c.logical_type, 'to', t.logical_type)
                            ORDER BY c.display_order), '[]'::jsonb)
    INTO v_retyped
    FROM api.dataset_schema_version_fields c
    JOIN api.dataset_schema_version_fields t
      ON t.schema_version_id = v_target.id AND t.field_id = c.field_id
   WHERE c.schema_version_id = v_current.id AND t.logical_type <> c.logical_type;
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'label', t.label)
                            ORDER BY t.display_order), '[]'::jsonb)
    INTO v_required
    FROM api.dataset_schema_version_fields t
   WHERE t.schema_version_id = v_target.id AND t.lifecycle = 'active'
     AND NOT t.nullable AND t.default_value IS NULL
     AND NOT EXISTS (SELECT 1 FROM api.dataset_schema_version_fields c
                      WHERE c.schema_version_id = v_current.id AND c.field_id = t.field_id);
  SELECT count(*) INTO v_rows FROM api.dataset_rows WHERE dataset_id = v_dataset.id;

  v_reason := CASE
    WHEN v_target.id = v_current.id THEN 'This dataset is already on that version.'
    WHEN v_target.schema_id <> v_current.schema_id THEN
      'That version belongs to a different model. A dataset can only follow its own model.'
    WHEN v_target.lifecycle <> 'active' THEN
      'That version is not published. A steward publishes it before datasets can move to it.'
    WHEN v_target.version < v_current.version THEN
      'That version is older than the one the dataset is on.'
    WHEN jsonb_array_length(v_removed) > 0 THEN
      'The newer version drops fields this dataset holds values for. A steward can publish a version that keeps them.'
    WHEN jsonb_array_length(v_retyped) > 0 THEN
      'The newer version changes the type of fields this dataset already holds. Migrate those values first, or ask a steward for a compatible version.'
    WHEN jsonb_array_length(v_required) > 0 AND v_rows > 0 THEN
      'The newer version adds required fields with no default, so existing rows would be invalid. A steward can make them optional or give them a default.'
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'ok', v_reason IS NULL,
    'blocked', v_reason IS NOT NULL,
    'reason', v_reason,
    'datasetId', v_dataset.id,
    'fromVersionId', v_current.id,
    'fromVersion', v_current.version,
    'toVersionId', v_target.id,
    'toVersion', v_target.version,
    'added', v_added,
    'removed', v_removed,
    'retyped', v_retyped,
    'requiredWithoutDefault', v_required,
    'rowCount', v_rows,
    'datasetRevision', v_dataset.revision
  );
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."apply_dataset_model_upgrade"(
  p_dataset_id uuid,
  p_target_version_id uuid,
  p_expected_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_dataset api.datasets;
  v_preview jsonb;
BEGIN
  SELECT * INTO v_dataset FROM api.datasets WHERE id = p_dataset_id FOR UPDATE;
  IF v_dataset.id IS NULL OR NOT api.is_workspace_writer(v_dataset.workspace_id)
    OR NOT internal.can_access_object('dataset', v_dataset.id, 'edit') THEN
    RAISE EXCEPTION 'dataset not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(v_dataset.workspace_id, 'schema.edit');
  IF p_expected_revision IS NOT NULL AND v_dataset.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'dataset revision conflict' USING ERRCODE = 'SB001';
  END IF;
  IF v_dataset.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'an archived dataset cannot be upgraded' USING ERRCODE = '55000';
  END IF;
  v_preview := api.preview_dataset_model_upgrade(p_dataset_id, p_target_version_id);
  IF (v_preview->>'blocked')::boolean THEN
    RAISE EXCEPTION '%', v_preview->>'reason' USING ERRCODE = '22023';
  END IF;

  UPDATE api.datasets
     SET schema_version_id = p_target_version_id,
         revision = revision + 1,
         updated_at = now()
   WHERE id = v_dataset.id;

  PERFORM internal.emit_change_event(v_dataset.workspace_id, 'dataset', v_dataset.id, 'update',
    NULL, v_dataset.primary_project_id,
    jsonb_build_object(
      'effect', 'dataset_model_upgrade',
      'datasetId', v_dataset.id,
      'datasetRevision', v_dataset.revision + 1,
      'changes', jsonb_build_object(
        'model_version', jsonb_build_object(
          'from', v_preview->>'fromVersion',
          'to', v_preview->>'toVersion',
          'label', 'Model version'))));

  RETURN v_preview || jsonb_build_object('applied', true, 'datasetRevision', v_dataset.revision + 1);
END $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION "api"."preview_dataset_model_upgrade"(uuid, uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."preview_dataset_model_upgrade"(uuid, uuid) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."apply_dataset_model_upgrade"(uuid, uuid, bigint) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."apply_dataset_model_upgrade"(uuid, uuid, bigint) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
