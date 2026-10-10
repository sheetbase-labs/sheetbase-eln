-- MDL-02: discard a draft Dataset Schema Version. Only a draft can be
-- discarded; a published version is immutable (start a new draft instead).
-- The rule lives in the database, gated by the schema.edit capability.
CREATE OR REPLACE FUNCTION api.delete_dataset_schema_version(p_schema_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  version api.dataset_schema_versions;
  workspace uuid;
BEGIN
  SELECT * INTO version FROM api.dataset_schema_versions WHERE id = p_schema_version_id FOR UPDATE;
  IF version.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Schema Version not found' USING ERRCODE = '42501';
  END IF;
  SELECT s.workspace_id INTO workspace
    FROM api.dataset_schema_definitions s WHERE s.id = version.schema_id;
  PERFORM api.require_capability(workspace, 'schema.edit');
  IF version.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Dataset Schema Versions may be discarded' USING ERRCODE = 'SB073';
  END IF;
  DELETE FROM api.dataset_schema_versions WHERE id = version.id;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.delete_dataset_schema_version(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.delete_dataset_schema_version(uuid) TO authenticated;
