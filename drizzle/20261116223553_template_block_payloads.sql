-- A template's narrative placements keep their block payload as written, and
-- the notebook it makes copied them as they were. Placements written before the
-- block rules were final (a title beside the text, a materials list with no
-- items, a metric with only a list of field names) either made the database
-- refuse the whole experiment ("invalid materials payload") or made blocks the
-- notebook cannot draw, so the new notebook opened blank. This turns such a
-- placement into the block the notebook expects, once, when an experiment is
-- made, so every published template version works as it is.
CREATE OR REPLACE FUNCTION internal.template_block(p_type text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $$
DECLARE
  payload jsonb := CASE WHEN jsonb_typeof(p_payload) = 'object' THEN p_payload ELSE '{}'::jsonb END;
  heading text := nullif(btrim(coalesce(payload->>'title', '')), '');
  doc jsonb;
  head_node jsonb;
  fields jsonb;
BEGIN
  IF heading IS NOT NULL THEN
    head_node := jsonb_build_object(
      'type', 'heading',
      'attrs', jsonb_build_object('level', 2),
      'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', heading))
    );
  END IF;

  IF p_type = 'rich_text' THEN
    doc := CASE WHEN jsonb_typeof(payload->'doc') = 'object' THEN payload->'doc'
      ELSE jsonb_build_object('type', 'doc', 'content', '[]'::jsonb) END;
    IF head_node IS NOT NULL
       AND coalesce(doc#>>'{content,0,type}', '') <> 'heading' THEN
      doc := jsonb_set(doc, '{content}', jsonb_build_array(head_node) || coalesce(doc->'content', '[]'::jsonb));
    END IF;
    IF jsonb_array_length(coalesce(doc->'content', '[]'::jsonb)) = 0 THEN
      doc := jsonb_set(doc, '{content}', '[{"type":"paragraph"}]'::jsonb);
    END IF;
    RETURN jsonb_build_object('type', p_type, 'payload', jsonb_build_object('doc', doc));
  END IF;

  IF p_type = 'materials' THEN
    RETURN jsonb_build_object('type', p_type, 'payload', jsonb_build_object(
      'items', CASE WHEN jsonb_typeof(payload->'items') = 'array' THEN payload->'items' ELSE '[]'::jsonb END));
  END IF;

  IF p_type = 'protocol_reference' AND NOT payload ? 'protocolRecordId' THEN
    RETURN jsonb_build_object('type', p_type, 'payload', '{}'::jsonb);
  END IF;

  IF p_type = 'chart' AND NOT payload ? 'spec' THEN
    RETURN jsonb_build_object('type', p_type, 'payload', '{}'::jsonb);
  END IF;

  -- A metric needs a label and a value. A placement that only names the
  -- fields a result will have becomes a short list the author fills in.
  IF p_type = 'metric' AND NOT (payload ? 'label' AND payload ? 'value') THEN
    fields := CASE WHEN jsonb_typeof(payload->'fields') = 'array' THEN payload->'fields' ELSE '[]'::jsonb END;
    doc := jsonb_build_object('type', 'doc', 'content',
      CASE WHEN head_node IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(head_node) END
      || CASE WHEN jsonb_array_length(fields) = 0 THEN '[{"type":"paragraph"}]'::jsonb
        ELSE jsonb_build_array(jsonb_build_object('type', 'bulletList', 'content', (
          SELECT jsonb_agg(jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(
            jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
              jsonb_build_object('type', 'text', 'text', f)))))) 
          FROM jsonb_array_elements_text(fields) f
          WHERE btrim(f) <> ''))) END);
    RETURN jsonb_build_object('type', 'rich_text', 'payload', jsonb_build_object('doc', doc));
  END IF;

  RETURN jsonb_build_object('type', p_type, 'payload', p_payload);
END
$$;

ALTER FUNCTION internal.template_block(p_type text, p_payload jsonb) OWNER TO migrator;

CREATE OR REPLACE FUNCTION api.instantiate_notebook_template_version(p_version_id uuid, p_target_project_id uuid, p_title text, p_parameter_inputs jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  normalised jsonb;
  workspace uuid := api.current_workspace_id();
  actor text := api.current_user_id();
  version api.notebook_template_versions;
  template api.notebook_templates;
  project api.projects;
  existing api.notebook_template_instantiations;
  rec api.records;
  placement jsonb;
  instance api.sheet_instances;
  inserted jsonb;
  narrated jsonb;
  mapped jsonb;
  title text;
  result jsonb;
  composition jsonb := '[]'::jsonb;
  missing_keys text[];
  duplicate_input text;
  unknown_input text;
  entry jsonb;
BEGIN IF api.has_capability(api.current_workspace_id(), 'work.experiments') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.experiments' USING ERRCODE = '42501'; END IF; -- capability-guard
 IF p_target_project_id IS NOT NULL THEN PERFORM internal.assert_object_access('project',p_target_project_id,'edit'); END IF;
  IF workspace IS NULL OR actor IS NULL OR NOT api.is_workspace_writer(workspace) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'valid idempotency key is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO existing FROM api.notebook_template_instantiations
    WHERE workspace_id = workspace AND actor_user_id = actor AND idempotency_key = p_idempotency_key;
  IF existing.id IS NOT NULL THEN
    IF existing.template_version_id IS DISTINCT FROM p_version_id THEN
      RAISE EXCEPTION 'idempotency key was used for a different Template Version' USING ERRCODE = '23505';
    END IF;
    RETURN existing.result || jsonb_build_object('idempotent', true);
  END IF;

  SELECT v.* INTO version
    FROM api.notebook_template_versions v
    JOIN api.notebook_templates t ON t.id = v.template_id
    WHERE v.id = p_version_id AND t.workspace_id = workspace;
  IF version.id IS NULL OR version.lifecycle <> 'published' THEN
    RAISE EXCEPTION 'only a published Notebook Template Version can be instantiated' USING ERRCODE = 'SB090';
  END IF;
  SELECT * INTO template FROM api.notebook_templates WHERE id = version.template_id;
  IF template.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'retired Notebook Template cannot be instantiated' USING ERRCODE = 'SB090';
  END IF;
  SELECT * INTO project FROM api.projects WHERE id = p_target_project_id AND workspace_id = workspace;
  IF project.id IS NULL THEN
    RAISE EXCEPTION 'target project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  title := nullif(btrim(coalesce(p_title,'')), '');
  IF title IS NULL THEN title := template.name; END IF;
  IF p_parameter_inputs IS NOT NULL AND jsonb_typeof(p_parameter_inputs) <> 'array' THEN
    RAISE EXCEPTION 'Template parameter inputs must be an array' USING ERRCODE = 'SB091';
  END IF;
  -- Shape gate runs before duplicate/unknown/required checks: input->>'parameterId'
  -- yields SQL NULL for a missing key, an explicit JSON null, or a non-object
  -- entry, so without this gate NULL parameterIds evade both GROUP BY duplicate
  -- detection (INTO a NULL variable the IS NOT NULL guard misses) and the
  -- unknown-input NOT EXISTS check. Every entry must mirror the SheetParameterInput
  -- wire shape: an object with a string parameterId, a known kind, and the
  -- kind-appropriate payload (scalar values stay JSON scalars; reference kinds
  -- carry their UUID as text — deeper resolution stays downstream).
  FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(p_parameter_inputs,'[]'::jsonb)) LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object'
       OR jsonb_typeof(entry->'parameterId') IS DISTINCT FROM 'string'
       OR coalesce(entry->>'kind','') NOT IN ('scalar','record','dataset','dataset-version')
       OR (entry->>'kind' = 'scalar'
           AND (NOT (entry ? 'value')
                OR coalesce(jsonb_typeof(entry->'value'),'') NOT IN ('string','number','boolean','null')))
       OR (entry->>'kind' = 'record'
           AND jsonb_typeof(entry->'recordId') IS DISTINCT FROM 'string')
       OR (entry->>'kind' = 'dataset'
           AND jsonb_typeof(entry->'datasetId') IS DISTINCT FROM 'string')
       OR (entry->>'kind' = 'dataset-version'
           AND jsonb_typeof(entry->'datasetVersionId') IS DISTINCT FROM 'string')
    THEN
      RAISE EXCEPTION 'malformed Template parameter input' USING ERRCODE = 'SB091';
    END IF;
  END LOOP;
  SELECT input->>'parameterId' INTO duplicate_input
    FROM jsonb_array_elements(coalesce(p_parameter_inputs,'[]'::jsonb)) input
    GROUP BY input->>'parameterId'
    HAVING count(*) > 1
    LIMIT 1;
  IF duplicate_input IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate Template parameter input: %', duplicate_input USING ERRCODE = 'SB091';
  END IF;
  SELECT input->>'parameterId' INTO unknown_input
  -- NOTE: the outer input alias must not be named `value` here. An outer
  -- `value` alias correlated into the NOT EXISTS subquery silently matches
  -- nothing (every input reads as unknown), while the same shape with
  -- `input`/`parameter` behaves. Keep these aliases.
    FROM jsonb_array_elements(coalesce(p_parameter_inputs,'[]'::jsonb)) input
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(version.configuration->'parameters','[]'::jsonb)) parameter
      WHERE parameter->>'id' = input->>'parameterId'
    )
    LIMIT 1;
  IF unknown_input IS NOT NULL THEN
    RAISE EXCEPTION 'unknown Template parameter input: %', unknown_input USING ERRCODE = 'SB091';
  END IF;
  SELECT coalesce(array_agg(parameter->>'key' ORDER BY parameter->>'key'), '{}') INTO missing_keys
    FROM jsonb_array_elements(coalesce(version.configuration->'parameters','[]'::jsonb)) parameter
    WHERE coalesce((parameter->>'required')::boolean, false)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(p_parameter_inputs,'[]'::jsonb)) input
        WHERE input->>'parameterId' = parameter->>'id'
      );
  IF array_length(missing_keys, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'required Template parameter(s) not supplied: %', array_to_string(missing_keys, ', ')
      USING ERRCODE = 'SB091';
  END IF;

  rec := api.create_record(p_target_project_id, 'experiment', title, 'draft', '{}'::text[], '{}'::jsonb);
  UPDATE api.records
    SET source_notebook_template_version_id = version.id
    WHERE id = rec.id;

  FOR placement IN
    SELECT value FROM jsonb_array_elements(coalesce(version.configuration->'placements','[]'::jsonb)) value
    ORDER BY (value->>'order')::int, value->>'id'
  LOOP
    IF placement->>'kind' = 'narrative' THEN
      normalised := internal.template_block(placement->>'blockType', placement->'payload');
      narrated := api.insert_block(
        rec.id,
        normalised->>'type',
        normalised->'payload',
        1,
        NULL,
        NULL
      );
      composition := composition || jsonb_build_array(jsonb_build_object(
        'placementId', placement->>'id',
        'kind', 'narrative',
        'blockType', normalised->>'type',
        'blockId', narrated->'block'->>'id'
      ));
    ELSIF placement->>'kind' = 'sheet' THEN
      mapped := internal.template_parameter_inputs_for_placement(placement, coalesce(p_parameter_inputs,'[]'::jsonb));
      instance := api.create_sheet_instance_from_definition(
        workspace,
        coalesce(nullif(btrim(placement->>'title'),''), 'Notebook sheet'),
        NULL,
        (placement->>'definitionVersionId')::uuid,
        rec.project_id,
        rec.id,
        internal.definition_derived_instance_state(),
        mapped
      );
      inserted := api.insert_sheet_instance_block(rec.id, NULL, NULL, instance.id);
      PERFORM internal.assign_sheet_block_template_placement(
        (inserted->'block'->>'id')::uuid,
        (placement->>'id')::uuid
      );
      composition := composition || jsonb_build_array(jsonb_build_object(
        'placementId', placement->>'id',
        'kind', 'sheet',
        'definitionVersionId', placement->>'definitionVersionId',
        'instanceId', instance.id,
        'blockId', inserted->'block'->>'id'
      ));
    ELSE
      composition := composition || jsonb_build_array(jsonb_build_object(
        'placementId', placement->>'id',
        'kind', coalesce(placement->>'kind', 'section_placeholder')
      ));
    END IF;
  END LOOP;

  SELECT * INTO rec FROM api.records WHERE id = rec.id;
  result := jsonb_build_object(
    'record', to_jsonb(rec),
    'templateVersionId', version.id,
    'composition', composition,
    'idempotent', false
  );
  INSERT INTO api.notebook_template_instantiations(
    workspace_id, actor_user_id, idempotency_key, template_version_id, record_id, result
  ) VALUES (workspace, actor, p_idempotency_key, version.id, rec.id, result);
  RETURN result;
END
$function$;

ALTER FUNCTION api.instantiate_notebook_template_version(p_version_id uuid, p_target_project_id uuid, p_title text, p_parameter_inputs jsonb, p_idempotency_key text) OWNER TO migrator;
