-- The picker uses the same parameter resolver as creation, without creating
-- an Instance. No client-side approximation of scientific compatibility.
CREATE FUNCTION api.dataset_sheet_options(p_dataset_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  dataset api.datasets;
  candidate record;
  parameter jsonb;
  inputs jsonb;
  options jsonb := '[]'::jsonb;
  refusal text;
  chosen_id text;
BEGIN
  SELECT * INTO dataset FROM api.datasets
    WHERE id = p_dataset_id AND workspace_id = api.current_workspace_id()
      AND lifecycle = 'active';
  IF dataset.id IS NULL OR NOT api.is_workspace_member(dataset.workspace_id) THEN
    RAISE EXCEPTION 'Dataset unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_object_access('dataset', dataset.id, 'view');
  FOR candidate IN
    SELECT DISTINCT ON (d.id) d.id AS definition_id, d.name, v.id, v.version, v.configuration
      FROM api.sheet_definitions d JOIN api.sheet_definition_versions v ON v.definition_id = d.id
      WHERE d.workspace_id = dataset.workspace_id AND d.lifecycle = 'active' AND v.lifecycle = 'published'
      ORDER BY d.id, v.version DESC
  LOOP
    refusal := NULL;
    chosen_id := NULL;
    FOR parameter IN SELECT value FROM jsonb_array_elements(candidate.configuration->'parameters')
      WHERE value->'type'->>'kind' = 'dataset'
    LOOP
      inputs := jsonb_build_array(jsonb_build_object(
        'parameterId', parameter->>'id', 'kind', 'dataset', 'datasetId', dataset.id));
      BEGIN
        PERFORM internal.resolve_sheet_parameters(dataset.workspace_id, candidate.id, inputs);
        chosen_id := parameter->>'id';
        refusal := NULL;
        EXIT;
      EXCEPTION WHEN SQLSTATE 'SB074' THEN
        refusal := SQLERRM;
      END;
    END LOOP;
    IF chosen_id IS NOT NULL OR refusal IS NOT NULL THEN
      options := options || jsonb_build_array(jsonb_build_object(
        'versionId', candidate.id, 'definitionId', candidate.definition_id,
        'definitionName', candidate.name, 'version', candidate.version,
        'datasetParameterId', chosen_id, 'unavailableReason', refusal));
    END IF;
  END LOOP;
  RETURN options;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.dataset_sheet_options(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.dataset_sheet_options(uuid) TO authenticated;
--> statement-breakpoint
-- Qualify the source column: the extraction builder also declares a local
-- configuration variable, making Definition-backed extraction ambiguous.
DO $migration$
DECLARE
  definition text := pg_get_functiondef('internal.build_sheet_definition_extraction_preview(api.sheet_instances,jsonb)'::regprocedure);
  original text := 'SELECT configuration INTO source_config
      FROM api.sheet_definition_versions
      WHERE id=p_instance.source_definition_version_id;';
BEGIN
  IF position(original IN definition) = 0 THEN
    RAISE EXCEPTION 'Sheet Definition extraction source lookup changed';
  END IF;
  EXECUTE replace(definition, original, 'SELECT source_version.configuration INTO source_config
      FROM api.sheet_definition_versions source_version
      WHERE source_version.id=p_instance.source_definition_version_id;');
END $migration$;
