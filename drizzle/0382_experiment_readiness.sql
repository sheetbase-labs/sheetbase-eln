-- EXP-02.1 — readiness on the server.
--
-- api.experiment_readiness reports what still stands between a record and
-- submission: the checks that did not pass on its latest revision (with the sheet
-- and cell location carried in the check payload), open comment threads, and
-- required Sheet parameters that have no value and no binding. The submit RPC
-- calls the same function, so the list the author reads and the block that stops
-- them can never disagree.
--
-- "Empty required field" is real: internal.resolve_sheet_parameters refuses a
-- missing required parameter at instance creation, so the state validator is the
-- only shape check afterwards. An instance whose definition later requires
-- something its state does not carry - a definition upgrade, or an imported
-- instance - is therefore missing what its definition demands, and nothing else
-- would tell the author before submission.
CREATE OR REPLACE FUNCTION api.experiment_readiness(p_record_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_record api.records;
  v_revision uuid;
  v_validation jsonb := '[]'::jsonb;
  v_comments jsonb := '[]'::jsonb;
  v_required jsonb := '[]'::jsonb;
  v_instance record;
  v_param jsonb;
BEGIN
  SELECT * INTO v_record FROM api.records
   WHERE id = p_record_id AND deleted_at IS NULL;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_record.kind <> 'experiment' THEN
    RAISE EXCEPTION 'not an experiment' USING ERRCODE = '22023';
  END IF;
  PERFORM internal.assert_object_access('record', p_record_id, 'view');

  SELECT r.id INTO v_revision FROM api.revisions r
   WHERE r.record_id = p_record_id
   ORDER BY r.created_at DESC, r.id DESC
   LIMIT 1;

  -- 1. Validation errors: the checks that did not pass on the latest revision.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'revisionId', c.revision_id,
           'checkDefinitionKey', c.check_definition_key,
           'checkDefinitionVersion', c.check_definition_version,
           'overallStatus', c.overall_status,
           'blockingFailures', c.blocking_failure_count,
           'warningFailures', c.warning_failure_count,
           'results', c.results,
           'runAt', c.run_at)
         ORDER BY c.run_at DESC), '[]'::jsonb)
    INTO v_validation
    FROM api.review_check_results c
   WHERE c.record_id = p_record_id
     AND c.overall_status <> 'pass'
     AND (v_revision IS NULL OR c.revision_id = v_revision);

  -- 2. Open comment threads. A reply lives under its thread, so only roots count.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'commentId', cm.id,
           'body', cm.body,
           'authorUserId', cm.author_user_id,
           'target', cm.target,
           'createdAt', cm.created_at)
         ORDER BY cm.created_at), '[]'::jsonb)
    INTO v_comments
    FROM api.comments cm
   WHERE cm.record_id = p_record_id
     AND cm.root_id = cm.id
     AND cm.state = 'open';

  -- 3. Required Sheet parameters with no value and no binding.
  FOR v_instance IN
    SELECT i.id, i.name, i.source_definition_version_id, i.state
      FROM api.sheet_instances i
     WHERE i.notebook_record_id = p_record_id
       AND i.lifecycle <> 'archived'
     ORDER BY i.created_at, i.id
  LOOP
    FOR v_param IN
      SELECT value
        FROM jsonb_array_elements(coalesce(
          (SELECT v.configuration->'parameters'
             FROM api.sheet_definition_versions v
            WHERE v.id = v_instance.source_definition_version_id),
          '[]'::jsonb))
    LOOP
      CONTINUE WHEN coalesce((v_param->>'required')::boolean, false) IS NOT TRUE;
      CONTINUE WHEN v_param ? 'defaultValue';
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(v_instance.state->'parameterValues', '[]'::jsonb)) pv
         WHERE pv->>'parameterId' = v_param->>'id');
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(v_instance.state->'bindings', '[]'::jsonb)) b
         WHERE b->>'parameterId' = v_param->>'id');
      v_required := v_required || jsonb_build_array(jsonb_build_object(
        'instanceId', v_instance.id,
        'instanceName', v_instance.name,
        'parameterId', v_param->>'id',
        'parameterKey', v_param->>'key',
        'label', v_param->>'label'));
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'recordId', p_record_id,
    -- The list shows every check that did not pass, so the author can see warnings
    -- too; only a blocking failure stops submission.
    'ready', NOT EXISTS (
               SELECT 1 FROM api.review_check_results c
                WHERE c.record_id = p_record_id
                  AND c.blocking_failure_count > 0
                  AND (v_revision IS NULL OR c.revision_id = v_revision))
             AND jsonb_array_length(v_comments) = 0
             AND jsonb_array_length(v_required) = 0,
    'validationErrors', v_validation,
    'openCommentThreads', v_comments,
    'emptyRequiredFields', v_required);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.experiment_readiness(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.experiment_readiness(uuid) TO authenticated;
--> statement-breakpoint

-- The submit RPC shares the same function. It is patched from its current
-- definition rather than rebuilt, so later changes to it cannot be lost here.
DO $$ DECLARE
  definition text;
  anchor text;
  gate text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api' AND p.proname = 'submit_record_revision';

  anchor := '  IF actual_digest <> p_expected_source_digest THEN
    RAISE EXCEPTION ''submission source changed'' USING ERRCODE = ''SB001'';
  END IF;';

  IF position(anchor IN definition) = 0 THEN
    RAISE EXCEPTION 'submit_record_revision anchor not found; refusing to patch blindly';
  END IF;

  -- An earlier application may already carry the gate; replace it wholesale so the
  -- current text is the one that ships.
  IF position('-- EXP-02.1:' IN definition) > 0 THEN
    definition := regexp_replace(
      definition,
      anchor || '\s*\n\s*-- EXP-02\.1:.*?END IF;',
      anchor,
      's');
  END IF;

  gate := anchor || '

  -- EXP-02.1: the readiness list and the submit block read the same function, so
  -- they cannot disagree. Only experiments are gated - the submit RPC serves every
  -- record kind. The digest above pins the source this list describes.
  IF record_row.kind = ''experiment''
     AND NOT (api.experiment_readiness(record_row.id)->>''ready'')::boolean THEN
    RAISE EXCEPTION ''record is not ready for submission'' USING ERRCODE = ''SB123'',
      DETAIL = (api.experiment_readiness(record_row.id))::text;
  END IF;';

  EXECUTE replace(definition, anchor, gate);
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
