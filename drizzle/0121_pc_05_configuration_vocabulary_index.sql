CREATE OR REPLACE FUNCTION api.list_configuration_vocabularies(
  p_workspace_id uuid,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF p_limit < 1 OR p_limit > 200 OR p_offset < 0 THEN
    RAISE EXCEPTION 'invalid vocabulary page' USING ERRCODE='22023';
  END IF;
  IF NOT api.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501';
  END IF;
  WITH sources AS (
    SELECT 'model:' || f.id AS id, f.label, 'model' AS source_kind, f.kind AS source_id,
      coalesce(k.label, f.kind) AS source_label, f.field_name AS field_key,
      coalesce(f.category_source->>'kind', 'embedded') AS category_kind,
      f.category_source->>'vocabularyId' AS vocabulary_id,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'key',o.key,'label',o.label,'lifecycle',o.lifecycle) ORDER BY o.display_order)
        FROM api.model_field_options o WHERE o.definition_id=f.id), '[]'::jsonb) AS terms
    FROM api.record_field_definitions f LEFT JOIN api.model_kinds k ON k.key=f.kind
    WHERE f.workspace_id=p_workspace_id AND f.logical_type='category'
    UNION ALL
    SELECT 'schema:' || f.field_id, f.label, 'schema', s.id::text, s.name, f.key,
      f.category->>'kind', f.category->>'vocabularyId', coalesce(f.category->'options','[]'::jsonb)
    FROM api.dataset_schema_version_fields f JOIN api.dataset_schema_versions v ON v.id=f.schema_version_id
      JOIN api.dataset_schema_definitions s ON s.id=v.schema_id
    WHERE s.workspace_id=p_workspace_id AND f.logical_type='category'
      AND v.version=(SELECT max(v2.version) FROM api.dataset_schema_versions v2 WHERE v2.schema_id=s.id)
    UNION ALL
    SELECT 'definition:' || c.value->>'id', c.value->'field'->>'label', 'definition', d.id::text, d.name,
      c.value->'field'->>'key', c.value->'field'->'category'->>'kind', c.value->'field'->'category'->>'vocabularyId',
      coalesce(c.value->'field'->'category'->'options','[]'::jsonb)
    FROM api.sheet_definition_versions v JOIN api.sheet_definitions d ON d.id=v.definition_id
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(v.configuration->'columns','[]'::jsonb)) c(value)
    WHERE d.workspace_id=p_workspace_id AND c.value->'field'->>'logicalType'='category'
      AND v.version=(SELECT max(v2.version) FROM api.sheet_definition_versions v2 WHERE v2.definition_id=d.id)
  ) SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.label, s.id), '[]'::jsonb) INTO result
  FROM (SELECT * FROM sources ORDER BY label, id LIMIT p_limit OFFSET p_offset) s;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION api.list_configuration_vocabularies(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.list_configuration_vocabularies(uuid,integer,integer) TO authenticated;
