-- EXP-03.3 — the start checklist's required items.
--
-- A Notebook Template version declares its parameters, and each carries a `required` flag
-- (internal.validate_parameter). instantiate_notebook_template_version already refuses to
-- instantiate while a required parameter has no input, so a notebook cannot be created from a
-- template with one left unset. What that does not cover is the draft being changed afterwards:
-- a required parameter's resolved value can be removed or re-resolved between instantiation and
-- starting, and this reports those so start_experiment can refuse.
--
-- A required parameter is satisfied when some Sheet instance on the notebook has a *supplied*
-- resolved value for a definition parameter that a placement maps from it (placements carry
-- parameterMappings of templateParameterId to definitionParameterId, the same mapping
-- internal.template_parameter_inputs_for_placement applies at instantiation). A parameter no
-- placement maps can never be satisfied, which is a template defect rather than something the
-- user can fix, and it is reported the same way so the refusal names it. A value resolved from
-- the parameter's own default does not satisfy it, matching instantiation, which refuses while
-- a required parameter has no supplied input.
CREATE OR REPLACE FUNCTION internal.missing_required_template_parameters(p_record_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT coalesce(array_agg(p->>'key' ORDER BY p->>'key'), '{}'::text[])
  FROM api.records r
  JOIN api.notebook_template_versions tv ON tv.id = r.source_notebook_template_version_id
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(tv.configuration->'parameters', '[]'::jsonb)) p
  WHERE r.id = p_record_id
    AND coalesce((p->>'required')::boolean, false)
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(tv.configuration->'placements', '[]'::jsonb)) pl
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(pl->'parameterMappings', '[]'::jsonb)) m
      JOIN api.sheet_instances si ON si.notebook_record_id = r.id
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(si.state->'parameterValues', '[]'::jsonb)) v
      WHERE m->>'templateParameterId' = p->>'id'
        AND v->>'parameterId' = m->>'definitionParameterId'
        AND v->>'source' = 'supplied'
        AND v ? 'value'
        AND jsonb_typeof(v->'value') <> 'null'
    );
$function$;

CREATE OR REPLACE FUNCTION api.start_experiment(p_record_id uuid, p_expected_metadata_version bigint, p_protocol_version_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS api.records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_record api.records;
  v_project api.projects;
  v_version api.protocol_versions;
  v_missing text[];
BEGIN
  SELECT * INTO v_record FROM api.records
   WHERE id = p_record_id AND deleted_at IS NULL FOR UPDATE;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_record.kind <> 'experiment' THEN
    RAISE EXCEPTION 'not an experiment' USING ERRCODE = '22023';
  END IF;
  IF NOT api.is_workspace_writer(v_record.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF v_record.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft experiment can start' USING ERRCODE = 'SB109';
  END IF;
  IF p_expected_metadata_version IS NULL
     OR p_expected_metadata_version IS DISTINCT FROM v_record.metadata_version THEN
    RAISE EXCEPTION 'stale Record metadata revision' USING ERRCODE = 'SB001';
  END IF;
  IF v_record.project_id IS NULL THEN
    RAISE EXCEPTION 'an experiment needs a project' USING ERRCODE = '22023';
  END IF;
  IF NOT internal.can_edit_project(v_record.project_id) THEN
    RAISE EXCEPTION 'project edit authority required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_project FROM api.projects
   WHERE id = v_record.project_id AND workspace_id = v_record.workspace_id;

  -- An explicit version wins; otherwise a project that requires an effective
  -- protocol starts on its current pin.
  IF p_protocol_version_id IS NOT NULL THEN
    SELECT * INTO v_version FROM api.protocol_versions
     WHERE id = p_protocol_version_id AND workspace_id = v_record.workspace_id;
    IF v_version.id IS NULL THEN
      RAISE EXCEPTION 'protocol version not found in the active workspace' USING ERRCODE = '42501';
    END IF;
  ELSIF v_project.require_effective_protocol THEN
    SELECT pv.* INTO v_version FROM api.project_protocols pp
      JOIN api.protocol_versions pv ON pv.id = pp.protocol_version_id
     WHERE pp.project_id = v_record.project_id
       AND pp.workspace_id = v_record.workspace_id;
  END IF;

  IF v_version.id IS NULL THEN
    IF v_project.require_effective_protocol THEN
      RAISE EXCEPTION 'project requires an effective protocol version' USING ERRCODE = 'SB110';
    END IF;
  ELSE
    -- Lifecycle eligibility, exact-version acknowledgement (LAB-07 training) and
    -- the project's exact pin where it requires one.
    PERFORM internal.assert_protocol_start_eligible(
      v_version.id, api.current_user_id(), v_record.project_id);
  END IF;

  -- EXP-03.3: a required template parameter with no resolved value is a start checklist item
  -- that is still missing. The refusal names them, so the user knows what to supply rather than
  -- being told the experiment cannot start.
  v_missing := internal.missing_required_template_parameters(v_record.id);
  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'required items are still missing: %', array_to_string(v_missing, ', ')
      USING ERRCODE = 'SB111';
  END IF;

  UPDATE api.records
     SET status = 'in_progress',
         protocol_version_id = v_version.id,
         metadata_version = metadata_version + 1,
         updated_at = now(),
         updated_by_user_id = api.current_user_id()
   WHERE id = v_record.id
  RETURNING * INTO v_record;
  PERFORM internal.emit_change_event(v_record.workspace_id, 'record', v_record.id, 'update',
    v_record.id, v_record.project_id,
    jsonb_build_object('effect', 'experiment_started',
      'protocolVersionId', v_version.id, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  RETURN v_record;
END $function$;

-- The helper is reached only through start_experiment, which is SECURITY DEFINER, so it is not
-- a caller surface of its own; the revoke mirrors every other internal helper.
REVOKE ALL ON FUNCTION internal.missing_required_template_parameters(uuid) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
