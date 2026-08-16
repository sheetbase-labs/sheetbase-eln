-- CORE-03.7: retain CORE-03.6's bounded source composition, while attaching
-- the pinned immutable Definition configuration needed to project bound fields.
ALTER FUNCTION api.query_sheet_instance_rows(uuid,integer,integer)
  RENAME TO query_sheet_instance_rows_core036;

CREATE FUNCTION api.query_sheet_instance_rows(
  p_instance_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; definition_configuration jsonb; definition_version_id uuid;
  instance api.sheet_instances; binding_item jsonb; row_item jsonb;
  record_source jsonb; record_sources jsonb:='[]'::jsonb; field_values jsonb;
  record_field_count integer; bound_column_count integer; result_rows jsonb:='[]'::jsonb;
BEGIN
  result := api.query_sheet_instance_rows_core036(p_instance_id, p_limit, p_offset);
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id;
  SELECT version.id, version.configuration
    INTO definition_version_id, definition_configuration
  FROM api.sheet_instances instance_row
  JOIN api.sheet_definition_versions version
    ON version.id = instance_row.source_definition_version_id
  WHERE instance_row.id = p_instance_id
    AND version.lifecycle = 'published';

  IF definition_configuration IS NULL THEN
    RAISE EXCEPTION 'Sheet Instance definition configuration is unavailable'
      USING ERRCODE='SB076';
  END IF;

  -- A resolved Record binding is a constant source projection, not a join. It
  -- is rechecked here so deleted/cross-workspace Records cannot leak through a
  -- previously resolved Instance state.
  FOR binding_item IN SELECT value FROM jsonb_array_elements(instance.state->'bindings') WHERE value->>'kind'='record' LOOP
    SELECT jsonb_build_object(
      'sourceKind','record', 'bindingId',binding_item->>'bindingId',
      'recordId',r.id, 'values',coalesce(field_values,'{}'::jsonb), 'matched',true
    ) INTO record_source
    FROM api.records r
    JOIN api.model_kinds model ON model.record_kind=r.kind AND model.identity_table='api.records'
    WHERE r.id=(binding_item->>'recordId')::uuid
      AND r.workspace_id=instance.workspace_id AND r.deleted_at IS NULL
      AND model.key=binding_item->>'modelKey';
    IF record_source IS NULL THEN
      RAISE EXCEPTION 'resolved Record binding is unavailable' USING ERRCODE='SB076';
    END IF;
    SELECT count(*) INTO bound_column_count FROM jsonb_array_elements(definition_configuration->'columns') column_item
    WHERE column_item->'source'->>'kind'='bound'
      AND column_item->'source'->>'bindingId'=binding_item->>'bindingId';
    SELECT count(*), jsonb_object_agg(column_item->'source'->>'sourceFieldId', r.custom_fields->field_definition.field_name)
      INTO record_field_count, field_values
    FROM api.records r
    JOIN LATERAL jsonb_array_elements(definition_configuration->'columns') column_item
      ON column_item->'source'->>'kind'='bound'
      AND column_item->'source'->>'bindingId'=binding_item->>'bindingId'
    JOIN api.record_field_definitions field_definition
      ON field_definition.id=(column_item->'source'->>'sourceFieldId')::uuid
      AND field_definition.workspace_id=r.workspace_id
      AND field_definition.kind=r.kind
      AND field_definition.lifecycle='active'
    WHERE r.id=(binding_item->>'recordId')::uuid;
    IF record_field_count<>bound_column_count THEN
      RAISE EXCEPTION 'resolved Record binding has an unknown or inactive source field mapping' USING ERRCODE='SB076';
    END IF;
    record_sources:=record_sources||jsonb_build_array(record_source || jsonb_build_object('values',coalesce(field_values,'{}'::jsonb)));
  END LOOP;
  FOR row_item IN SELECT value FROM jsonb_array_elements(result->'rows') LOOP
    result_rows:=result_rows||jsonb_build_array(
      (row_item-'sources') || jsonb_build_object('sources',
        (SELECT coalesce(jsonb_agg(source_item || jsonb_build_object('sourceKind','dataset')),'[]'::jsonb)
         FROM jsonb_array_elements(row_item->'sources') source_item) || record_sources
      )
    );
  END LOOP;

  RETURN result || jsonb_build_object(
    'definitionVersionId', definition_version_id,
    'definitionConfiguration', definition_configuration,
    'rows', result_rows
  );
END $$;

-- The canonical composition function already verifies membership and lifecycle.
-- Keep the historical implementation private so this is the sole public entry.
REVOKE EXECUTE ON FUNCTION api.query_sheet_instance_rows_core036(uuid,integer,integer)
  FROM PUBLIC,authenticated,api_client;
REVOKE EXECUTE ON FUNCTION api.query_sheet_instance_rows(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.query_sheet_instance_rows(uuid,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
