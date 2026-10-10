-- MDL-02.3 — "also migrate open experiments" is a real, audited migration.
--
-- The field editor records the steward's choice, but nothing honoured it: the existing
-- RPCs upgrade one record at a time, so choosing "also migrate open experiments" changed
-- nothing. This is the batch the choice promises.
--
-- **Open** is defined here, because the design says "open experiments" without saying
-- which states those are: not archived, not deleted, and not `approved`. An approved
-- experiment's evidence is frozen — rewriting which model version it is pinned to would
-- change frozen scientific history, which is exactly what this must not do silently.
--
-- It upgrades nothing itself: every record goes through the canonical
-- api.upgrade_record_model_record, so each migration is attributed, audited in
-- api.record_model_version_upgrades and emits its own change event. One bad record does
-- not silently skip: the loop stops and the transaction rolls back, so the batch is
-- all-or-nothing and the caller learns which record refused.

CREATE OR REPLACE FUNCTION api.migrate_open_experiments_to_model_version(
  p_model_id uuid,
  p_version_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_version api.record_model_versions;
  v_model api.record_models;
  v_record api.records;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT * INTO v_version FROM api.record_model_versions WHERE id = p_version_id;
  IF v_version.id IS NULL
     OR v_version.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR v_version.lifecycle <> 'published' THEN
    RAISE EXCEPTION 'published Record Model version not found' USING ERRCODE = '42501';
  END IF;
  IF v_version.model_id IS DISTINCT FROM p_model_id THEN
    RAISE EXCEPTION 'version does not belong to the Record model' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_model FROM api.record_models WHERE id = p_model_id;
  PERFORM api.require_capability(v_model.workspace_id, 'schema.edit');
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'a migration reason is required' USING ERRCODE = '22023';
  END IF;

  FOR v_record IN
    SELECT r.*
      FROM api.records r
      JOIN api.record_model_versions mv ON mv.id = r.model_version_id
     WHERE r.workspace_id = v_model.workspace_id
       AND r.kind = v_model.key
       AND mv.model_id = p_model_id
       AND r.model_version_id IS DISTINCT FROM p_version_id
       AND r.archived_at IS NULL
       AND r.deleted_at IS NULL
       AND r.status IN ('draft', 'planned', 'in_progress', 'on_hold', 'in_review')
     ORDER BY r.created_at
  LOOP
    PERFORM api.upgrade_record_model_record(
      v_record.id, p_version_id, v_record.metadata_version, p_reason
    );
    v_ids := v_ids || v_record.id;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'migrated', coalesce(array_length(v_ids, 1), 0),
    'recordIds', to_jsonb(v_ids)
  );
END $function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.migrate_open_experiments_to_model_version(uuid, uuid, text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.migrate_open_experiments_to_model_version(uuid, uuid, text) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
