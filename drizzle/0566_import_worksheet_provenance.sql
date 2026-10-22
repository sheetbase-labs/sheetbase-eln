-- Keep the retained file's identity authoritative. Only its interpretation
-- comes from the mapping, which the import server checks against those bytes.
DO $$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('api.commit_dataset_import(uuid,bigint,jsonb,text,uuid,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
  IF position('source := jsonb_build_object(''fileId'', f.id' IN definition) = 0 THEN
    RAISE EXCEPTION 'import provenance anchor not found';
  END IF;
  definition := replace(definition,
    'source := jsonb_build_object(''fileId'', f.id, ''filename'', f.filename, ''checksum'', f.checksum, ''storageKey'', f.storage_key);',
    $patch$
    IF p_mapping ? 'sheetName' AND
      (jsonb_typeof(p_mapping->'sheetName') <> 'string' OR length(btrim(p_mapping->>'sheetName')) = 0) THEN
      RAISE EXCEPTION 'valid worksheet name required' USING ERRCODE = '22023';
    END IF;
    source := jsonb_build_object('fileId', f.id, 'filename', f.filename, 'checksum', f.checksum, 'storageKey', f.storage_key)
      || jsonb_strip_nulls(jsonb_build_object('sheetName', p_mapping->'sheetName'));
    $patch$);
  definition := replace(definition,
    'existing.connector_run_id IS DISTINCT FROM p_connector_run_id THEN',
    'existing.connector_run_id IS DISTINCT FROM p_connector_run_id OR
       (p_file_id IS NOT NULL AND existing.mapping IS DISTINCT FROM coalesce(p_mapping, ''{}''::jsonb)) THEN');
  EXECUTE definition;
END $$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
