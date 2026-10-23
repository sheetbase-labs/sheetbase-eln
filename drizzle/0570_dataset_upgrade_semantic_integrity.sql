-- A version-pointer move never transforms values. Refuse semantic changes,
-- including defaults that change validation and future write semantics.
CREATE OR REPLACE FUNCTION api.preview_dataset_model_upgrade(
  p_dataset_id uuid, p_target_version_id uuid
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
  v_semantic jsonb;
  v_reason text;
  v_rows bigint;
BEGIN
  SELECT * INTO v_dataset FROM api.datasets WHERE id = p_dataset_id;
  IF v_dataset.id IS NULL OR NOT api.is_workspace_member(v_dataset.workspace_id)
    OR NOT internal.can_access_object('dataset', v_dataset.id, 'view') THEN
    RAISE EXCEPTION 'dataset not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_current FROM api.dataset_schema_versions WHERE id = v_dataset.schema_version_id;
  SELECT v.* INTO v_target FROM api.dataset_schema_versions v
    JOIN api.dataset_schema_definitions d ON d.id = v.schema_id
    WHERE v.id = p_target_version_id AND d.workspace_id = v_dataset.workspace_id;
  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'model version not found' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'label', t.label, 'type', t.logical_type)
    ORDER BY t.display_order), '[]'::jsonb) INTO v_added
    FROM api.dataset_schema_version_fields t
    WHERE t.schema_version_id = v_target.id AND t.lifecycle = 'active'
      AND NOT EXISTS (SELECT 1 FROM api.dataset_schema_version_fields c
        WHERE c.schema_version_id = v_current.id AND c.field_id = t.field_id AND c.lifecycle = 'active');
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label)
    ORDER BY c.display_order), '[]'::jsonb) INTO v_removed
    FROM api.dataset_schema_version_fields c
    WHERE c.schema_version_id = v_current.id AND c.lifecycle = 'active'
      AND NOT EXISTS (SELECT 1 FROM api.dataset_schema_version_fields t
        WHERE t.schema_version_id = v_target.id AND t.field_id = c.field_id AND t.lifecycle = 'active');
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label,
    'from', c.logical_type, 'to', t.logical_type) ORDER BY c.display_order), '[]'::jsonb) INTO v_retyped
    FROM api.dataset_schema_version_fields c
    JOIN api.dataset_schema_version_fields t ON t.schema_version_id = v_target.id AND t.field_id = c.field_id
    WHERE c.schema_version_id = v_current.id AND t.logical_type <> c.logical_type;
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'label', t.label)
    ORDER BY t.display_order), '[]'::jsonb) INTO v_required
    FROM api.dataset_schema_version_fields t
    WHERE t.schema_version_id = v_target.id AND t.lifecycle = 'active' AND NOT t.nullable
      AND nullif(t.default_value, 'null'::jsonb) IS NULL
      AND NOT EXISTS (SELECT 1 FROM api.dataset_schema_version_fields c
        WHERE c.schema_version_id = v_current.id AND c.field_id = t.field_id AND c.lifecycle = 'active');

  SELECT coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'label', t.label)
    ORDER BY t.display_order), '[]'::jsonb) INTO v_semantic
    FROM api.dataset_schema_version_fields t
    LEFT JOIN api.dataset_schema_version_fields c
      ON c.schema_version_id = v_current.id AND c.field_id = t.field_id
    WHERE t.schema_version_id = v_target.id AND t.lifecycle = 'active' AND (
      -- This operation does not backfill defaults. A default-bearing addition
      -- needs an explicit migration rather than pretending old rows received it.
      (c.field_id IS NULL AND nullif(t.default_value, 'null'::jsonb) IS NOT NULL)
      OR (c.field_id IS NOT NULL AND (
        c.quantity IS DISTINCT FROM t.quantity
        OR c.validation IS DISTINCT FROM t.validation
        OR c.category IS DISTINCT FROM t.category
        OR c.relationship IS DISTINCT FROM t.relationship
        OR c.cardinality IS DISTINCT FROM t.cardinality
        OR c.lifecycle IS DISTINCT FROM t.lifecycle
        OR c.nullable IS DISTINCT FROM t.nullable
        OR nullif(c.default_value, 'null'::jsonb) IS DISTINCT FROM nullif(t.default_value, 'null'::jsonb)
      )));
  SELECT count(*) INTO v_rows FROM api.dataset_rows WHERE dataset_id = v_dataset.id;
  v_reason := CASE
    WHEN v_target.id = v_current.id THEN 'This dataset is already on that version.'
    WHEN v_target.schema_id <> v_current.schema_id THEN 'That version belongs to a different model. A dataset can only follow its own model.'
    WHEN v_target.lifecycle <> 'active' THEN 'That version is not published. A steward publishes it before datasets can move to it.'
    WHEN v_target.version < v_current.version THEN 'That version is older than the one the dataset is on.'
    WHEN jsonb_array_length(v_removed) > 0 THEN 'The newer version drops fields this dataset holds values for. A steward can publish a version that keeps them.'
    WHEN jsonb_array_length(v_retyped) > 0 THEN 'The newer version changes the type of fields this dataset already holds. Migrate those values first, or ask a steward for a compatible version.'
    WHEN jsonb_array_length(v_required) > 0 AND v_rows > 0 THEN 'The newer version adds required fields. Existing rows need an explicit validated backfill before moving, even when a default is defined.'
    WHEN jsonb_array_length(v_semantic) > 0 THEN 'The newer version changes units, constraints, categories, reference targets, cardinality, nullability or defaults. This move does not transform values. An explicit validated migration is required.'
    ELSE NULL
  END;
  RETURN jsonb_build_object(
    'ok', v_reason IS NULL, 'blocked', v_reason IS NOT NULL, 'reason', v_reason,
    'datasetId', v_dataset.id, 'fromVersionId', v_current.id, 'fromVersion', v_current.version,
    'toVersionId', v_target.id, 'toVersion', v_target.version,
    'added', v_added, 'removed', v_removed, 'retyped', v_retyped,
    'requiredWithoutDefault', v_required, 'semanticChanges', v_semantic,
    'rowCount', v_rows, 'datasetRevision', v_dataset.revision);
END $$;
--> statement-breakpoint

-- Browser payloads use JSON null for absent optional metadata. Persist SQL NULL
-- so publication and all other canonical callers see the same field contract.
CREATE OR REPLACE FUNCTION internal.replace_dataset_schema_version_fields(
  p_schema_version_id uuid, p_fields jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  item jsonb;
  ordinal integer := 0;
  field_key text;
  field_label text;
  logical_type text;
  field_id uuid;
  display_order integer;
BEGIN
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Dataset Schema fields must be an array' USING ERRCODE = '22023';
  END IF;
  DELETE FROM api.dataset_schema_version_fields WHERE schema_version_id = p_schema_version_id;
  FOR item IN SELECT value FROM jsonb_array_elements(p_fields) LOOP
    ordinal := ordinal + 1;
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid Dataset Schema field' USING ERRCODE = '22023';
    END IF;
    field_key := coalesce(item->>'key', item->>'field_key');
    field_label := coalesce(item->>'label', item->>'name');
    logical_type := coalesce(item->>'logical_type', item->>'logicalType');
    IF field_key IS NULL OR field_key !~ '^[a-z][a-z0-9_]{0,59}$'
      OR field_label IS NULL OR length(btrim(field_label)) NOT BETWEEN 1 AND 200
      OR logical_type IS NULL THEN
      RAISE EXCEPTION 'invalid Dataset Schema field metadata' USING ERRCODE = 'SB071';
    END IF;
    BEGIN
      field_id := coalesce(nullif(item->>'field_id','')::uuid, nullif(item->>'fieldId','')::uuid, gen_random_uuid());
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid Dataset Schema field id' USING ERRCODE = '22023';
    END;
    display_order := coalesce((item->>'display_order')::integer, (item->>'displayOrder')::integer, ordinal);
    INSERT INTO api.dataset_schema_version_fields(
      schema_version_id, field_id, key, label, description, logical_type, nullable,
      default_value, quantity, validation, category, relationship, cardinality, lifecycle, display_order
    ) VALUES (
      p_schema_version_id, field_id, field_key, btrim(field_label),
      nullif(btrim(coalesce(item->>'description','')), ''), logical_type,
      coalesce((item->>'nullable')::boolean, true),
      nullif(CASE WHEN item ? 'default_value' THEN item->'default_value' ELSE item->'defaultValue' END, 'null'::jsonb),
      nullif(item->'quantity', 'null'::jsonb),
      coalesce(nullif(item->'validation', 'null'::jsonb), '{}'::jsonb),
      nullif(item->'category', 'null'::jsonb), nullif(item->'relationship', 'null'::jsonb),
      coalesce(item->>'cardinality', 'one'), coalesce(item->>'lifecycle', 'active'), display_order
    );
  END LOOP;
END $$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
