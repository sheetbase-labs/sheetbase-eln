-- H3: store an immutable composed grid on revision_sheet_evidence. The REV-002
-- envelope stays untouched after digest. Historical render reads this table.

ALTER TABLE api.revision_sheet_evidence
  ADD COLUMN IF NOT EXISTS composed_grid jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION internal.prevent_revision_sheet_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'revision Sheet evidence is immutable' USING ERRCODE = 'SB092';
END
$$;

DROP TRIGGER IF EXISTS prevent_revision_sheet_evidence_mutation ON api.revision_sheet_evidence;
CREATE TRIGGER prevent_revision_sheet_evidence_mutation
  BEFORE UPDATE OR DELETE ON api.revision_sheet_evidence
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_revision_sheet_evidence_mutation();

CREATE FUNCTION internal.dataset_version_source_values(p_dataset_version_id uuid, p_row_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(jsonb_object_agg(f.field_id::text,
    CASE WHEN f.cardinality='many' THEN coalesce((
      SELECT jsonb_agg(coalesce(
        to_jsonb(v.text_value), to_jsonb(v.integer_value), to_jsonb(v.numeric_value),
        to_jsonb(v.boolean_value), to_jsonb(v.date_value), to_jsonb(v.timestamp_value),
        to_jsonb(v.category_option_id), to_jsonb(v.reference_id)
      ) ORDER BY v.ordinal)
      FROM api.dataset_version_values v
      WHERE v.dataset_version_id = p_dataset_version_id
        AND v.row_id = p_row_id AND v.field_id = f.field_id
    ), '[]'::jsonb)
    ELSE (
      SELECT coalesce(
        to_jsonb(v.text_value), to_jsonb(v.integer_value), to_jsonb(v.numeric_value),
        to_jsonb(v.boolean_value), to_jsonb(v.date_value), to_jsonb(v.timestamp_value),
        to_jsonb(v.category_option_id), to_jsonb(v.reference_id)
      )
      FROM api.dataset_version_values v
      WHERE v.dataset_version_id = p_dataset_version_id
        AND v.row_id = p_row_id AND v.field_id = f.field_id
      ORDER BY v.ordinal LIMIT 1
    ) END), '{}'::jsonb)
  FROM api.dataset_schema_version_fields f
  JOIN api.dataset_versions version ON version.schema_version_id = f.schema_version_id
  WHERE version.id = p_dataset_version_id AND f.lifecycle = 'active'
$$;

CREATE FUNCTION internal.build_frozen_composed_sheet_grid(
  p_instance_state jsonb,
  p_definition_version_id uuid,
  p_dataset_versions jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  config jsonb;
  identity jsonb;
  columns jsonb := '[]'::jsonb;
  column_item jsonb;
  hidden text[] := '{}';
  ordered text[] := '{}';
  column_id text;
  rows jsonb := '[]'::jsonb;
  cells jsonb;
  row_key text;
  local_row jsonb;
  root_binding text;
  root_version uuid;
  root_row record;
  join_item jsonb;
  left_field uuid;
  right_field uuid;
  right_version uuid;
  right_rows uuid[];
  left_key uuid;
  include_row boolean;
  sources jsonb;
  source_values jsonb;
  identity_values jsonb;
  identity_column text;
  identity_binding text;
  identity_field uuid;
  value_item jsonb;
  label text;
  cell_value jsonb;
  binding_id text;
  source_field text;
BEGIN
  IF p_definition_version_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT configuration INTO config
    FROM api.sheet_definition_versions
   WHERE id = p_definition_version_id AND lifecycle = 'published';
  IF config IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(value), '{}') INTO hidden
    FROM jsonb_array_elements_text(coalesce(p_instance_state->'presentation'->'hiddenColumnIds', '[]'::jsonb));
  ordered := ARRAY(
    SELECT value FROM jsonb_array_elements_text(
      coalesce(p_instance_state->'presentation'->'columnOrder', config->'presentation'->'columnOrder', '[]'::jsonb)
    )
  );
  FOR column_item IN SELECT value FROM jsonb_array_elements(config->'columns') LOOP
    column_id := column_item->>'id';
    IF column_id = ANY (hidden) THEN CONTINUE; END IF;
    IF column_id <> ALL (ordered) THEN ordered := array_append(ordered, column_id); END IF;
  END LOOP;
  FOR column_item IN SELECT value FROM jsonb_array_elements(coalesce(p_instance_state->'localFields', '[]'::jsonb)) LOOP
    column_id := column_item->>'fieldId';
    IF column_id = ANY (hidden) THEN CONTINUE; END IF;
    IF column_id <> ALL (ordered) THEN ordered := array_append(ordered, column_id); END IF;
  END LOOP;
  FOREACH column_id IN ARRAY ordered LOOP
    SELECT value INTO column_item FROM jsonb_array_elements(config->'columns') WHERE value->>'id' = column_id;
    IF column_item IS NULL THEN
      SELECT value INTO column_item
        FROM jsonb_array_elements(coalesce(p_instance_state->'localFields', '[]'::jsonb))
       WHERE value->>'fieldId' = column_id;
      label := coalesce(nullif(column_item->>'label', ''), column_item->>'key', 'Column');
    ELSE
      label := coalesce(nullif(column_item->'field'->>'label', ''), column_item->'field'->>'key', 'Column');
    END IF;
    columns := columns || jsonb_build_array(jsonb_build_object('id', column_id, 'label', label));
  END LOOP;

  identity := p_instance_state->'resolvedRowIdentity';
  IF identity IS NULL OR identity = 'null'::jsonb THEN
    identity := config->'rowIdentity';
    SELECT value INTO column_item
      FROM jsonb_array_elements(config->'columns')
     WHERE value->>'id' = identity->'columnIds'->>0;
    identity := identity || jsonb_build_object(
      'formatVersion', 1,
      'logicalTypes', (
        SELECT jsonb_agg(col->'field'->>'logicalType' ORDER BY ids.ordinality)
          FROM jsonb_array_elements(identity->'columnIds') WITH ORDINALITY ids
          JOIN LATERAL jsonb_array_elements(config->'columns') col
            ON col->>'id' = ids.value#>>'{}'
      ),
      'sourceBindingId', CASE
        WHEN identity->>'kind' = 'source' THEN column_item->'source'->>'bindingId'
        ELSE NULL
      END,
      'sourceFieldId', CASE
        WHEN identity->>'kind' = 'source' THEN column_item->'source'->>'sourceFieldId'
        ELSE NULL
      END
    );
  END IF;
  IF identity->>'kind' IN ('source', 'composite') THEN
    SELECT coalesce((config->'joins')->0->>'leftBindingId', (config->'bindings')->0->>'id') INTO root_binding;
    SELECT (value->>'datasetVersionId')::uuid INTO root_version
      FROM jsonb_array_elements(coalesce(p_dataset_versions, '[]'::jsonb))
     WHERE value->>'bindingId' = root_binding;
    IF root_version IS NOT NULL THEN
      FOR root_row IN
        SELECT row_id, revision
          FROM api.dataset_version_rows
         WHERE dataset_version_id = root_version
         ORDER BY row_id
         LIMIT 200
      LOOP
        include_row := true;
        sources := jsonb_build_array(jsonb_build_object(
          'bindingId', root_binding,
          'values', internal.dataset_version_source_values(root_version, root_row.row_id)
        ));
        FOR join_item IN SELECT value FROM jsonb_array_elements(coalesce(config->'joins', '[]'::jsonb)) LOOP
          SELECT (c.value->'source'->>'sourceFieldId')::uuid INTO left_field
            FROM jsonb_array_elements(config->'columns') c
           WHERE c.value->>'id' = join_item->>'leftColumnId';
          SELECT (c.value->'source'->>'sourceFieldId')::uuid INTO right_field
            FROM jsonb_array_elements(config->'columns') c
           WHERE c.value->>'id' = join_item->>'rightColumnId';
          SELECT (value->>'datasetVersionId')::uuid INTO right_version
            FROM jsonb_array_elements(coalesce(p_dataset_versions, '[]'::jsonb))
           WHERE value->>'bindingId' = join_item->>'rightBindingId';
          SELECT reference_id INTO left_key
            FROM api.dataset_version_values
           WHERE dataset_version_id = root_version
             AND row_id = root_row.row_id
             AND field_id = left_field
           ORDER BY ordinal
           LIMIT 1;
          IF left_key IS NULL THEN
            IF join_item->>'joinType' = 'inner' THEN include_row := false; END IF;
            CONTINUE;
          END IF;
          SELECT array_agg(r.row_id ORDER BY r.row_id) INTO right_rows
            FROM api.dataset_version_rows r
            JOIN api.dataset_version_values rv
              ON rv.dataset_version_id = r.dataset_version_id
             AND rv.row_id = r.row_id
             AND rv.field_id = right_field
           WHERE r.dataset_version_id = right_version
             AND rv.reference_id = left_key;
          IF coalesce(array_length(right_rows, 1), 0) = 1 THEN
            sources := sources || jsonb_build_array(jsonb_build_object(
              'bindingId', join_item->>'rightBindingId',
              'values', internal.dataset_version_source_values(right_version, right_rows[1])
            ));
          ELSIF join_item->>'joinType' = 'inner' THEN
            include_row := false;
          ELSE
            sources := sources || jsonb_build_array(jsonb_build_object(
              'bindingId', join_item->>'rightBindingId',
              'values', '{}'::jsonb
            ));
          END IF;
        END LOOP;
        IF NOT include_row THEN CONTINUE; END IF;
        identity_values := '[]'::jsonb;
        FOR identity_column IN SELECT value FROM jsonb_array_elements_text(identity->'columnIds') LOOP
          SELECT c.value->'source'->>'bindingId', (c.value->'source'->>'sourceFieldId')::uuid
            INTO identity_binding, identity_field
            FROM jsonb_array_elements(config->'columns') c
           WHERE c.value->>'id' = identity_column;
          SELECT s.value->'values'->identity_field::text INTO value_item
            FROM jsonb_array_elements(sources) s
           WHERE s.value->>'bindingId' = identity_binding;
          identity_values := identity_values || jsonb_build_array(coalesce(value_item, 'null'::jsonb));
        END LOOP;
        row_key := internal.sheet_row_identity_key(identity, identity_values);
        cells := '[]'::jsonb;
        FOR column_item IN SELECT value FROM jsonb_array_elements(columns) LOOP
          column_id := column_item->>'id';
          SELECT value INTO column_item FROM jsonb_array_elements(config->'columns') WHERE value->>'id' = column_id;
          IF column_item IS NOT NULL AND column_item->'source'->>'kind' = 'bound' THEN
            binding_id := column_item->'source'->>'bindingId';
            source_field := column_item->'source'->>'sourceFieldId';
            SELECT s.value->'values'->source_field INTO cell_value
              FROM jsonb_array_elements(sources) s
             WHERE s.value->>'bindingId' = binding_id;
          ELSE
            cell_value := p_instance_state->'localValues'->row_key->column_id;
          END IF;
          cells := cells || jsonb_build_array(cell_value);
        END LOOP;
        rows := rows || jsonb_build_array(cells);
      END LOOP;
    END IF;
  END IF;

  FOR row_key, local_row IN SELECT key, value FROM jsonb_each(coalesce(p_instance_state->'localValues', '{}'::jsonb)) LOOP
    IF row_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      CONTINUE;
    END IF;
    cells := '[]'::jsonb;
    FOR column_item IN SELECT value FROM jsonb_array_elements(columns) LOOP
      cells := cells || jsonb_build_array(local_row->(column_item->>'id'));
    END LOOP;
    rows := rows || jsonb_build_array(cells);
  END LOOP;

  RETURN jsonb_build_object('columns', columns, 'rows', rows);
END
$$;

CREATE OR REPLACE FUNCTION internal.persist_revision_sheet_evidence(p_revision_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  revision api.revisions;
  item jsonb;
  binding jsonb;
  frozen jsonb;
  snapshot api.dataset_versions;
  dataset_row api.datasets;
  version_id uuid;
  seen jsonb := '{}'::jsonb;
  grid jsonb;
BEGIN
  SELECT * INTO revision FROM api.revisions WHERE id = p_revision_id;
  IF revision.id IS NULL THEN
    RAISE EXCEPTION 'revision not found' USING ERRCODE = '22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(revision.canonical_snapshot->'sheetEvidence','[]'::jsonb)) LOOP
    frozen := '[]'::jsonb;
    FOR binding IN SELECT value FROM jsonb_array_elements(coalesce(item->'datasetBindings','[]'::jsonb)) LOOP
      IF binding->>'datasetId' IS NULL THEN
        CONTINUE;
      END IF;
      version_id := NULL;
      IF binding->>'policyMode' = 'version' AND binding->>'datasetVersionId' IS NOT NULL THEN
        version_id := (binding->>'datasetVersionId')::uuid;
      ELSE
        IF seen ? (binding->>'datasetId') THEN
          version_id := (seen->> (binding->>'datasetId'))::uuid;
        ELSE
          SELECT * INTO dataset_row FROM api.datasets WHERE id = (binding->>'datasetId')::uuid;
          IF dataset_row.id IS NULL THEN
            RAISE EXCEPTION 'Dataset for Sheet evidence is missing' USING ERRCODE = 'SB092';
          END IF;
          snapshot := api.snapshot_dataset(
            dataset_row.id,
            (binding->>'datasetRevision')::bigint,
            'Notebook revision sheet evidence'
          );
          version_id := snapshot.id;
          seen := seen || jsonb_build_object(binding->>'datasetId', version_id);
        END IF;
      END IF;
      frozen := frozen || jsonb_build_array(jsonb_build_object(
        'bindingId', binding->>'bindingId',
        'datasetId', binding->>'datasetId',
        'datasetVersionId', version_id,
        'policyMode', binding->>'policyMode'
      ));
    END LOOP;
    grid := coalesce(
      internal.build_frozen_composed_sheet_grid(
        item->'instanceState',
        nullif(item->>'sourceDefinitionVersionId','')::uuid,
        frozen
      ),
      '{}'::jsonb
    );
    INSERT INTO api.revision_sheet_evidence(
      workspace_id, revision_id, block_id, instance_id,
      source_definition_version_id, instance_revision, instance_state, dataset_versions,
      composed_grid
    ) VALUES (
      revision.workspace_id,
      revision.id,
      (item->>'blockId')::uuid,
      (item->>'instanceId')::uuid,
      nullif(item->>'sourceDefinitionVersionId','')::uuid,
      (item->>'instanceRevision')::bigint,
      item->'instanceState',
      frozen,
      grid
    )
    ON CONFLICT (revision_id, block_id) DO NOTHING;
  END LOOP;
END
$$;

REVOKE EXECUTE ON FUNCTION
  internal.prevent_revision_sheet_evidence_mutation(),
  internal.dataset_version_source_values(uuid, uuid),
  internal.build_frozen_composed_sheet_grid(jsonb, uuid, jsonb)
  FROM PUBLIC, authenticated, api_client;
NOTIFY pgrst, 'reload schema';
