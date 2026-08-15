-- CORE-03.10: configuration must resolve one durable source target per
-- editable bound column. Keep the established parser as the canonical base.
ALTER FUNCTION internal.validate_sheet_definition_configuration(jsonb)
  RENAME TO validate_sheet_definition_configuration_core039;

CREATE FUNCTION internal.validate_sheet_definition_configuration(p_config jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE rule jsonb; mapping jsonb; column_item jsonb; mapped_columns text[]:='{}'; mapped_targets text[]:='{}'; target text;
BEGIN
  PERFORM internal.validate_sheet_definition_configuration_core039(p_config);
  FOR rule IN SELECT value FROM jsonb_array_elements(p_config->'writeBackRules') LOOP
    FOR mapping IN SELECT value FROM jsonb_array_elements(rule->'mappings') LOOP
      IF mapping->>'columnId'=ANY(mapped_columns) THEN
        RAISE EXCEPTION 'ambiguous Sheet write-back column' USING ERRCODE='SB071';
      END IF;
      mapped_columns:=array_append(mapped_columns,mapping->>'columnId');
      target:=(rule->>'bindingId')||':'||(mapping->>'targetFieldId');
      IF target=ANY(mapped_targets) THEN
        RAISE EXCEPTION 'ambiguous Sheet write-back source target' USING ERRCODE='SB071';
      END IF;
      mapped_targets:=array_append(mapped_targets,target);
      SELECT value INTO column_item FROM jsonb_array_elements(p_config->'columns')
        WHERE value->>'id'=mapping->>'columnId';
      IF column_item->'source'->>'kind'<>'bound'
         OR column_item->'source'->>'bindingId'<>rule->>'bindingId'
         OR column_item->'source'->>'sourceFieldId'<>mapping->>'targetFieldId'
      THEN
        RAISE EXCEPTION 'write-back must target its exact bound source field' USING ERRCODE='SB071';
      END IF;
    END LOOP;
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION internal.validate_sheet_definition_configuration_core039(jsonb),internal.validate_sheet_definition_configuration(jsonb) FROM PUBLIC,authenticated,api_client;

ALTER FUNCTION api.query_sheet_instance_rows(uuid,integer,integer)
  RENAME TO query_sheet_instance_rows_core037;
CREATE FUNCTION api.query_sheet_instance_rows(p_instance_id uuid,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  result:=api.query_sheet_instance_rows_core037(p_instance_id,p_limit,p_offset);
  RETURN result||jsonb_build_object(
    'localFieldIds',(
      SELECT coalesce(jsonb_agg(field_item->>'fieldId'),'[]'::jsonb)
      FROM api.sheet_instances instance_row
      CROSS JOIN LATERAL jsonb_array_elements(instance_row.state->'localFields') field_item
      WHERE instance_row.id=(result->>'instanceId')::uuid
        AND field_item->>'lifecycle'='active'
    ),
    'rows',(
    SELECT coalesce(jsonb_agg(row_item||jsonb_build_object('sources',(
      SELECT coalesce(jsonb_agg(source_item||CASE
        WHEN source_item->>'sourceKind'='dataset'
          THEN jsonb_build_object('datasetRevision',d.revision)
        WHEN source_item->>'sourceKind'='record'
          THEN jsonb_build_object(
            'metadataVersion',r.metadata_version,
            'fieldNames',(
              SELECT coalesce(jsonb_object_agg(
                column_item->'source'->>'sourceFieldId',field_definition.field_name
              ),'{}'::jsonb)
              FROM jsonb_array_elements(result->'definitionConfiguration'->'columns') column_item
              JOIN api.record_field_definitions field_definition
                ON field_definition.id=(column_item->'source'->>'sourceFieldId')::uuid
               AND field_definition.workspace_id=r.workspace_id
               AND field_definition.kind=r.kind
               AND field_definition.lifecycle='active'
              WHERE column_item->'source'->>'kind'='bound'
                AND column_item->'source'->>'bindingId'=source_item->>'bindingId'
            )
          )
        ELSE '{}'::jsonb END),'[]'::jsonb)
      FROM jsonb_array_elements(row_item->'sources') source_item
      LEFT JOIN api.datasets d ON d.id=(source_item->>'datasetId')::uuid
      LEFT JOIN api.records r ON r.id=(source_item->>'recordId')::uuid
    ))),'[]'::jsonb) FROM jsonb_array_elements(result->'rows') row_item));
END $$;
REVOKE EXECUTE ON FUNCTION api.query_sheet_instance_rows_core037(uuid,integer,integer) FROM PUBLIC,authenticated,api_client;
REVOKE EXECUTE ON FUNCTION api.query_sheet_instance_rows(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.query_sheet_instance_rows(uuid,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
