-- R5-CONFIG-03 — a draft Dataset Schema Version can only be replaced by a
-- caller that believes it still holds the revision it read.
--
-- MDL-03 put the expected-revision pattern on Record Model versions
-- (`api.replace_record_model_version_definition(p_version_id, p_expected_revision, ...)`).
-- The Dataset Schema path never had one, so the model editor's debounced
-- autosave was last-write-wins: a second editor silently replaced a draft
-- someone else had already changed, and neither side was told. The editor now
-- reads the revision with the fields and sends it back on every save; a save
-- that lost the race is refused with SB001 and the client reconciles.
--
-- Decision (owner may overrule): `p_expected_revision` is OPTIONAL and defaults
-- to NULL, meaning "no revision expectation". Two canonical RPCs call this
-- function SQL-side while already holding the version row lock — column
-- promotion (`api.apply_column_promotion`) and dataset evolution
-- (`api.apply_dataset_schema_evolution`) — and have no editor revision to send.
-- Requiring the argument would have meant rewriting both in this migration and
-- would not have added protection they do not already have from the lock. The
-- browser boundary always sends the revision it loaded, so the untrusted client
-- cannot overwrite a changed version. This is the conservative, reversible
-- option: it closes the editor race without changing internal callers, and it
-- can be tightened to NOT NULL later once those callers are migrated.
--
-- The function also RETURNS the updated version, so the client persists the
-- authoritative revision as its next baseline instead of incrementing a number
-- it guessed. Existing SQL callers use PERFORM/SELECT and ignore the result.

DROP FUNCTION IF EXISTS api.replace_dataset_schema_version_fields(uuid, jsonb);
--> statement-breakpoint
CREATE FUNCTION api.replace_dataset_schema_version_fields(
  p_schema_version_id uuid,
  p_fields jsonb,
  p_expected_revision bigint DEFAULT NULL
) RETURNS api.dataset_schema_versions
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
    RAISE EXCEPTION 'only draft Dataset Schema Versions may be updated' USING ERRCODE = 'SB072';
  END IF;
  IF EXISTS(SELECT 1 FROM api.approval_requests r WHERE r.workspace_id=workspace
    AND r.object_kind='dataset_schema_version' AND r.object_id=version.id AND r.state='pending') THEN
    RAISE EXCEPTION 'draft is locked while approval is pending' USING ERRCODE = 'SB085';
  END IF;
  IF p_expected_revision IS NOT NULL AND p_expected_revision IS DISTINCT FROM version.revision THEN
    RAISE EXCEPTION 'stale Dataset Schema Version revision' USING ERRCODE = 'SB001';
  END IF;
  PERFORM internal.replace_dataset_schema_version_fields(version.id, p_fields);
  UPDATE api.dataset_schema_versions
     SET revision = revision + 1, updated_at = now()
   WHERE id = version.id
  RETURNING * INTO version;
  RETURN version;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.replace_dataset_schema_version_fields(uuid, jsonb, bigint)
  FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.replace_dataset_schema_version_fields(uuid, jsonb, bigint)
  TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
