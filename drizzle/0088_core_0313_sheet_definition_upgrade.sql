-- CORE-03.13: explicit three-way Definition Version upgrade preview and one
-- controlled optimistic transition. Definition Versions remain immutable.

ALTER TABLE api.sheet_instance_definition_upgrades ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheet_instance_definition_upgrades_read ON api.sheet_instance_definition_upgrades
  FOR SELECT TO authenticated USING (
    workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id)
  );
REVOKE ALL ON api.sheet_instance_definition_upgrades FROM PUBLIC,authenticated,api_client;
GRANT SELECT ON api.sheet_instance_definition_upgrades TO authenticated;

CREATE FUNCTION internal.sheet_definition_upgrade_references(p_state jsonb,p_id text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_object(
    'localField',EXISTS(SELECT 1 FROM jsonb_array_elements(p_state->'localFields') item WHERE item->>'fieldId'=p_id),
    'localValueCount',(SELECT count(*) FROM jsonb_each(p_state->'localValues') row_item WHERE row_item.value ? p_id),
    'calculationIds',coalesce((SELECT jsonb_agg(item->>'id' ORDER BY item->>'id') FROM jsonb_array_elements(coalesce(p_state->'instanceCalculations','[]'::jsonb)) item WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(item->'dependencies') dependency WHERE dependency->>'id'=p_id)),'[]'::jsonb),
    'calculationOverride',p_state->'calculationOverrides' ? p_id,
    'presentation',
      (p_state->'presentation'->'columnOrder' @> jsonb_build_array(p_id))
      OR (p_state->'presentation'->'hiddenColumnIds' @> jsonb_build_array(p_id))
      OR (p_state->'presentation'->'columnWidths' ? p_id)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_state->'presentation'->'filters','[]'::jsonb)) item WHERE item->>'columnId'=p_id)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_state->'presentation'->'sorts','[]'::jsonb)) item WHERE item->>'columnId'=p_id)
  )
$$;

CREATE FUNCTION internal.sheet_definition_upgrade_conflict(
  p_state jsonb,p_kind text,p_source_id text,p_candidates jsonb,p_outcomes jsonb
) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_object(
    'id',p_kind||':'||p_source_id,'kind',p_kind,'sourceId',p_source_id,
    'targetCandidates',p_candidates,'allowedOutcomes',p_outcomes,
    'instanceReferences',internal.sheet_definition_upgrade_references(p_state,p_source_id)
  )
$$;

CREATE FUNCTION internal.sheet_definition_upgrade_columns_compatible(p_source jsonb,p_target jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT p_source->'source'->>'kind'=p_target->'source'->>'kind'
    AND ((p_source->'field')-ARRAY['fieldId','key','label','description']::text[])
      IS NOT DISTINCT FROM ((p_target->'field')-ARRAY['fieldId','key','label','description']::text[])
    AND CASE p_source->'source'->>'kind'
      WHEN 'bound' THEN p_source->'source'->>'bindingId'=p_target->'source'->>'bindingId'
        AND p_source->'source'->>'sourceFieldId'=p_target->'source'->>'sourceFieldId'
      WHEN 'calculated' THEN p_source->'source'->>'calculationId'=p_target->'source'->>'calculationId'
      ELSE true
    END
$$;

CREATE FUNCTION internal.sheet_definition_upgrade_parameter_compatible(
  p_instance api.sheet_instances,p_source_parameter_id text,p_target_parameter jsonb,p_target_config jsonb
) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE source_value jsonb; source_binding jsonb; target_binding jsonb; candidate_schema_version uuid;
BEGIN
  IF p_target_parameter->'type'->>'kind'='scalar' THEN
    SELECT value INTO source_value FROM jsonb_array_elements(coalesce(p_instance.state->'parameterValues','[]'::jsonb)) value WHERE value->>'parameterId'=p_source_parameter_id;
    RETURN source_value IS NOT NULL
      AND source_value->>'valueType'=p_target_parameter->'type'->>'valueType'
      AND internal.scalar_parameter_satisfies(p_target_parameter->'type'->>'valueType',source_value->'value',p_target_parameter->'constraints');
  END IF;
  SELECT value INTO source_binding FROM jsonb_array_elements(p_instance.state->'bindings') value WHERE value->>'parameterId'=p_source_parameter_id;
  SELECT value INTO target_binding FROM jsonb_array_elements(p_target_config->'bindings') value WHERE value->>'parameterId'=p_target_parameter->>'id';
  IF source_binding IS NULL OR target_binding IS NULL OR (SELECT count(*) FROM jsonb_array_elements(p_target_config->'bindings') value WHERE value->>'parameterId'=p_target_parameter->>'id')<>1 THEN RETURN false; END IF;
  IF p_target_parameter->'type'->>'kind'='record' THEN
    RETURN source_binding->>'kind'='record' AND source_binding->>'modelKey'=p_target_parameter->'type'->>'modelKey';
  END IF;
  IF source_binding->>'kind'<>'dataset'
     OR (p_target_parameter->'type'->>'kind'='dataset') IS DISTINCT FROM (source_binding->'policy'->>'mode'='live')
  THEN RETURN false; END IF;
  IF source_binding->'policy'->>'mode'='live' THEN
    SELECT schema_version_id INTO candidate_schema_version FROM api.datasets WHERE id=(source_binding->>'datasetId')::uuid AND workspace_id=p_instance.workspace_id AND lifecycle='active';
  ELSE
    SELECT schema_version_id INTO candidate_schema_version FROM api.dataset_versions WHERE id=(source_binding->'policy'->>'datasetVersionId')::uuid AND workspace_id=p_instance.workspace_id AND dataset_id=(source_binding->>'datasetId')::uuid;
  END IF;
  IF candidate_schema_version IS NULL THEN RETURN false; END IF;
  PERFORM internal.assert_dataset_parameter_compatible(p_target_parameter->'type'->'contract',candidate_schema_version,p_target_config,(target_binding->>'id')::uuid);
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION internal.build_sheet_instance_definition_upgrade_preview(
  p_instance api.sheet_instances,p_target_definition_version_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
  source_version api.sheet_definition_versions;
  target_version api.sheet_definition_versions;
  source_config jsonb;
  target_config jsonb;
  automatic jsonb:='[]'::jsonb;
  conflicts jsonb:='[]'::jsonb;
  source_item jsonb;
  target_item jsonb;
  collection text;
  conflict_kind text;
  added_kind text;
  candidates jsonb;
  source_id text;
  outcomes jsonb;
  instance_references jsonb;
  identity_id text;
  identity_changed boolean:=false;
BEGIN
  IF p_instance.source_definition_version_id IS NULL THEN
    RAISE EXCEPTION 'ad hoc Sheet Instances have no Definition Version to upgrade' USING ERRCODE='SB088';
  END IF;
  SELECT * INTO source_version FROM api.sheet_definition_versions WHERE id=p_instance.source_definition_version_id;
  SELECT target.* INTO target_version
    FROM api.sheet_definition_versions target
    JOIN api.sheet_definitions target_definition ON target_definition.id=target.definition_id
    JOIN api.sheet_definitions source_definition ON source_definition.id=source_version.definition_id
    WHERE target.id=p_target_definition_version_id
      AND target.lifecycle='published'
      AND target.definition_id=source_version.definition_id
      AND target.version>source_version.version
      AND target_definition.workspace_id=p_instance.workspace_id
      AND source_definition.workspace_id=target_definition.workspace_id;
  IF target_version.id IS NULL THEN
    RAISE EXCEPTION 'target must be a newer published Version in the pinned Definition lineage' USING ERRCODE='SB088';
  END IF;
  source_config:=source_version.configuration; target_config:=target_version.configuration;

  FOR source_item IN SELECT value FROM jsonb_array_elements(source_config->'columns') LOOP
    source_id:=source_item->>'id';
    SELECT value INTO target_item FROM jsonb_array_elements(target_config->'columns') WHERE value->>'id'=source_id;
    instance_references:=internal.sheet_definition_upgrade_references(p_instance.state,source_id);
    candidates:=(SELECT coalesce(jsonb_agg(item.value->>'id' ORDER BY item.ordinality),'[]'::jsonb) FROM jsonb_array_elements(target_config->'columns') WITH ORDINALITY item(value,ordinality) WHERE internal.sheet_definition_upgrade_columns_compatible(source_item,item.value) AND ((item.value->>'id')=source_id OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source_config->'columns') existing(existing_value) WHERE (existing.existing_value->>'id')=(item.value->>'id'))));
    IF source_item->'source'->>'kind'='declared' AND ((instance_references->>'localField')::boolean OR (instance_references->>'localValueCount')::integer>0) THEN candidates:='[]'::jsonb; END IF;
    IF target_item IS NULL THEN
      outcomes:='["defer"]'::jsonb;
      IF jsonb_array_length(candidates)>0 THEN outcomes:=jsonb_build_array('map','defer'); END IF;
      IF source_item->'source'->>'kind'='declared' THEN outcomes:=jsonb_build_array('retain-local')||outcomes; END IF;
      conflicts:=conflicts||jsonb_build_array(internal.sheet_definition_upgrade_conflict(p_instance.state,'column-removed',source_id,candidates,outcomes));
    ELSIF (source_item #- '{field,label}')=(target_item #- '{field,label}') AND source_item#>>'{field,label}' IS DISTINCT FROM target_item#>>'{field,label}' THEN
      automatic:=automatic||jsonb_build_array(jsonb_build_object('kind','column-label-renamed','objectId',source_id));
    ELSIF source_item IS DISTINCT FROM target_item THEN
      outcomes:=CASE WHEN jsonb_array_length(candidates)>0 THEN '["map","defer"]'::jsonb ELSE '["defer"]'::jsonb END;
      conflicts:=conflicts||jsonb_build_array(internal.sheet_definition_upgrade_conflict(p_instance.state,'column-incompatible',source_id,candidates,outcomes));
    END IF;
    target_item:=NULL;
  END LOOP;
  FOR target_item IN SELECT value FROM jsonb_array_elements(target_config->'columns') LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source_config->'columns') source WHERE source->>'id'=target_item->>'id') THEN
      automatic:=automatic||jsonb_build_array(jsonb_build_object('kind','column-added','objectId',target_item->>'id'));
    END IF;
  END LOOP;

  FOREACH collection IN ARRAY ARRAY['parameters','bindings','joins','calculations','writeBackRules','actions'] LOOP
    conflict_kind:=CASE collection WHEN 'parameters' THEN 'parameter' WHEN 'bindings' THEN 'binding' WHEN 'joins' THEN 'join' WHEN 'calculations' THEN 'calculation' WHEN 'writeBackRules' THEN 'write-back' ELSE 'action' END;
    added_kind:=conflict_kind||'-added';
    FOR source_item IN SELECT value FROM jsonb_array_elements(source_config->collection) LOOP
      source_id:=source_item->>'id';
      SELECT value INTO target_item FROM jsonb_array_elements(target_config->collection) WHERE value->>'id'=source_id;
      IF collection='parameters' THEN
        candidates:=(SELECT coalesce(jsonb_agg(item.value->>'id' ORDER BY item.ordinality),'[]'::jsonb) FROM jsonb_array_elements(target_config->'parameters') WITH ORDINALITY item(value,ordinality) WHERE internal.sheet_definition_upgrade_parameter_compatible(p_instance,source_id,item.value,target_config) AND ((item.value->>'id')=source_id OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source_config->'parameters') existing(existing_value) WHERE (existing.existing_value->>'id')=(item.value->>'id'))));
      ELSE candidates:='[]'::jsonb; END IF;
      outcomes:=CASE WHEN jsonb_array_length(candidates)>0 THEN '["map","defer"]'::jsonb ELSE '["defer"]'::jsonb END;
      IF target_item IS NULL THEN
        conflicts:=conflicts||jsonb_build_array(internal.sheet_definition_upgrade_conflict(p_instance.state,conflict_kind||'-removed',source_id,candidates,outcomes));
      ELSIF collection='parameters' AND (source_item-'label')=(target_item-'label') AND source_item->>'label' IS DISTINCT FROM target_item->>'label' THEN
        automatic:=automatic||jsonb_build_array(jsonb_build_object('kind','parameter-label-renamed','objectId',source_id));
      ELSIF source_item IS DISTINCT FROM target_item THEN
        conflicts:=conflicts||jsonb_build_array(internal.sheet_definition_upgrade_conflict(p_instance.state,conflict_kind||'-changed',source_id,candidates,outcomes));
      END IF;
      target_item:=NULL;
    END LOOP;
    FOR target_item IN SELECT value FROM jsonb_array_elements(target_config->collection) LOOP
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source_config->collection) source WHERE source->>'id'=target_item->>'id') THEN
        IF collection='parameters' AND (target_item->>'required')::boolean THEN
          conflicts:=conflicts||jsonb_build_array(internal.sheet_definition_upgrade_conflict(p_instance.state,'parameter-required',target_item->>'id','[]'::jsonb,'["defer"]'::jsonb));
        ELSE automatic:=automatic||jsonb_build_array(jsonb_build_object('kind',added_kind,'objectId',target_item->>'id'));
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  identity_changed:=source_config->'rowIdentity' IS DISTINCT FROM target_config->'rowIdentity';
  IF NOT identity_changed THEN
    FOR identity_id IN SELECT value FROM jsonb_array_elements_text(source_config->'rowIdentity'->'columnIds') LOOP
      SELECT value INTO source_item FROM jsonb_array_elements(source_config->'columns') WHERE value->>'id'=identity_id;
      SELECT value INTO target_item FROM jsonb_array_elements(target_config->'columns') WHERE value->>'id'=identity_id;
      IF target_item IS NULL OR NOT internal.sheet_definition_upgrade_columns_compatible(source_item,target_item) THEN identity_changed:=true; EXIT; END IF;
    END LOOP;
  END IF;
  IF identity_changed THEN
    source_id:=source_config->'rowIdentity'->'columnIds'->>0;
    conflicts:=conflicts||jsonb_build_array(internal.sheet_definition_upgrade_conflict(p_instance.state,'row-identity-changed',source_id,'[]'::jsonb,'["defer"]'::jsonb));
  END IF;

  FOR target_item IN SELECT value FROM jsonb_array_elements(target_config->'columns') LOOP
    source_id:=target_item->>'id';
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_instance.state->'localFields') local_field WHERE local_field->>'fieldId'=source_id) THEN
      conflicts:=conflicts||jsonb_build_array(internal.sheet_definition_upgrade_conflict(p_instance.state,'local-identity-collision',source_id,'[]'::jsonb,'["defer"]'::jsonb));
    END IF;
  END LOOP;
  FOR target_item IN SELECT value FROM jsonb_array_elements(target_config->'calculations') LOOP
    source_id:=target_item->>'id';
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_instance.state->'instanceCalculations','[]'::jsonb)) calculation WHERE calculation->>'id'=source_id) THEN
      conflicts:=conflicts||jsonb_build_array(internal.sheet_definition_upgrade_conflict(p_instance.state,'instance-calculation-collision',source_id,'[]'::jsonb,'["defer"]'::jsonb));
    END IF;
  END LOOP;
  IF jsonb_array_length(automatic)>512 OR jsonb_array_length(conflicts)>512 THEN RAISE EXCEPTION 'Definition upgrade impact exceeds bounded manifest' USING ERRCODE='SB088'; END IF;

  RETURN jsonb_build_object(
    'source',jsonb_build_object('instanceId',p_instance.id,'instanceRevision',p_instance.revision,'definitionId',source_version.definition_id,'versionId',source_version.id,'version',source_version.version),
    'target',jsonb_build_object('definitionId',target_version.definition_id,'versionId',target_version.id,'version',target_version.version),
    'automaticChanges',automatic,'conflicts',conflicts,
    'preserved',jsonb_build_object(
      'localFieldIds',coalesce((SELECT jsonb_agg(value->>'fieldId' ORDER BY ordinality) FROM jsonb_array_elements(p_instance.state->'localFields') WITH ORDINALITY item(value,ordinality)),'[]'::jsonb),
      'localValueRowCount',(SELECT count(*) FROM jsonb_object_keys(p_instance.state->'localValues')),
      'instanceCalculationIds',coalesce((SELECT jsonb_agg(value->>'id' ORDER BY ordinality) FROM jsonb_array_elements(coalesce(p_instance.state->'instanceCalculations','[]'::jsonb)) WITH ORDINALITY item(value,ordinality)),'[]'::jsonb),
      'calculationOverrideIds',coalesce((SELECT jsonb_agg(key ORDER BY key) FROM jsonb_object_keys(p_instance.state->'calculationOverrides') key),'[]'::jsonb),
      'presentationOwnedByInstance',true,'bindingProvenanceRevalidated',true,'writeOwnershipFromTarget',true
    )
  );
END $$;

CREATE FUNCTION api.preview_sheet_instance_definition_upgrade(
  p_instance_id uuid,p_expected_instance_revision bigint,p_target_definition_version_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE instance api.sheet_instances;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id FOR SHARE;
  IF instance.id IS NULL OR NOT api.is_workspace_member(instance.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  IF instance.lifecycle<>'active' OR instance.revision<>p_expected_instance_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
  RETURN internal.build_sheet_instance_definition_upgrade_preview(instance,p_target_definition_version_id);
END $$;

CREATE FUNCTION api.apply_sheet_instance_definition_upgrade(
  p_instance_id uuid,p_expected_instance_revision bigint,p_target_definition_version_id uuid,p_decisions jsonb,p_parameter_inputs jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE
  instance api.sheet_instances; preview jsonb; target_config jsonb; resolved jsonb; new_state jsonb;
  conflict jsonb; decision jsonb; item jsonb; nested jsonb; source_column jsonb; identity jsonb; first_identity_column jsonb;
  actor text:=api.current_user_id(); source_version_id uuid; source_id text; target_id text; conflict_kind text;
  collection text;
  column_map jsonb:='{}'::jsonb; parameter_map jsonb:='{}'::jsonb; retained_ids text[]:='{}';
  calculations jsonb:='[]'::jsonb; dependencies jsonb; overrides jsonb:='{}'::jsonb; presentation jsonb; mapped jsonb; inputs jsonb:='[]'::jsonb; supplied jsonb; source_parameter_id text;
  allowed_ids text[]; ordered_ids text[]:='{}'; mapped_id text; provenance api.sheet_instance_definition_upgrades;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
  IF instance.id IS NULL OR actor IS NULL OR NOT api.is_workspace_member(instance.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  IF instance.lifecycle<>'active' OR instance.revision<>p_expected_instance_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
  preview:=internal.build_sheet_instance_definition_upgrade_preview(instance,p_target_definition_version_id);
  IF p_decisions IS NULL OR jsonb_typeof(p_decisions)<>'array' OR jsonb_array_length(p_decisions)>512 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_decisions) d GROUP BY d->>'conflictId' HAVING count(*)>1) THEN RAISE EXCEPTION 'upgrade decisions must be a bounded unique array' USING ERRCODE='SB088'; END IF;
  IF jsonb_array_length(p_decisions)<>jsonb_array_length(preview->'conflicts') THEN RAISE EXCEPTION 'every current upgrade conflict requires exactly one decision' USING ERRCODE='SB088'; END IF;
  FOR conflict IN SELECT value FROM jsonb_array_elements(preview->'conflicts') LOOP
    SELECT value INTO decision FROM jsonb_array_elements(p_decisions) WHERE value->>'conflictId'=conflict->>'id';
    IF decision IS NULL OR decision->>'outcome' NOT IN ('retain-local','map','defer') OR NOT (conflict->'allowedOutcomes' @> jsonb_build_array(decision->>'outcome'))
       OR decision-(CASE WHEN decision->>'outcome'='map' THEN ARRAY['conflictId','outcome','targetId'] ELSE ARRAY['conflictId','outcome'] END)<>'{}'::jsonb
       OR (decision->>'outcome'='map' AND NOT (conflict->'targetCandidates' @> jsonb_build_array(decision->>'targetId')))
    THEN RAISE EXCEPTION 'invalid or stale Definition upgrade decision' USING ERRCODE='SB088'; END IF;
    IF decision->>'outcome'='map' THEN PERFORM internal.sheet_definition_uuid(decision->>'targetId','upgrade decision target ID'); END IF;
  END LOOP;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_decisions) selected
    JOIN LATERAL (SELECT value FROM jsonb_array_elements(preview->'conflicts') value WHERE value->>'id'=selected->>'conflictId') current_conflict ON true
    WHERE selected->>'outcome'='map'
    GROUP BY split_part(current_conflict.value->>'kind','-',1),selected->>'targetId' HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'Definition upgrade maps must be one-to-one per object kind' USING ERRCODE='SB088'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_decisions) decision WHERE decision->>'outcome'='defer') THEN
    RETURN jsonb_build_object('status','deferred','preview',preview);
  END IF;

  source_version_id:=instance.source_definition_version_id;
  SELECT configuration INTO target_config FROM api.sheet_definition_versions WHERE id=p_target_definition_version_id;
  FOR decision IN SELECT value FROM jsonb_array_elements(p_decisions) LOOP
    SELECT value->>'kind',value->>'sourceId' INTO conflict_kind,source_id FROM jsonb_array_elements(preview->'conflicts') value WHERE value->>'id'=decision->>'conflictId';
    IF decision->>'outcome'='retain-local' THEN
      SELECT value INTO source_column FROM api.sheet_definition_versions version_row CROSS JOIN LATERAL jsonb_array_elements(version_row.configuration->'columns') value WHERE version_row.id=source_version_id AND value->>'id'=source_id;
      IF source_column->'source'->>'kind'<>'declared' THEN RAISE EXCEPTION 'only removed declared columns may be retained locally' USING ERRCODE='SB088'; END IF;
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(instance.state->'localFields') field WHERE field->>'fieldId'=source_id) THEN instance.state:=jsonb_set(instance.state,'{localFields}',instance.state->'localFields'||jsonb_build_array(source_column->'field'),true); END IF;
      retained_ids:=array_append(retained_ids,source_id);
    ELSE
      target_id:=decision->>'targetId';
      IF conflict_kind LIKE 'column-%' THEN column_map:=column_map||jsonb_build_object(source_id,target_id);
      ELSIF conflict_kind LIKE 'parameter-%' THEN parameter_map:=parameter_map||jsonb_build_object(source_id,target_id); END IF;
    END IF;
  END LOOP;

  IF p_parameter_inputs IS NULL OR jsonb_typeof(p_parameter_inputs)<>'array' OR jsonb_array_length(p_parameter_inputs)>64 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_parameter_inputs) input GROUP BY input->>'parameterId' HAVING count(*)>1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_parameter_inputs) input WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(target_config->'parameters') parameter WHERE parameter->>'id'=input->>'parameterId')) THEN RAISE EXCEPTION 'invalid explicit target parameter inputs' USING ERRCODE='SB088'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(target_config->'parameters') LOOP
    target_id:=item->>'id'; supplied:=NULL;
    SELECT value INTO supplied FROM jsonb_array_elements(p_parameter_inputs) WHERE value->>'parameterId'=target_id;
    IF supplied IS NULL THEN
      SELECT key INTO source_parameter_id FROM jsonb_each_text(parameter_map) WHERE value=target_id LIMIT 1;
      source_parameter_id:=coalesce(source_parameter_id,target_id);
      SELECT jsonb_build_object('parameterId',target_id,'kind','scalar','value',value->'value') INTO supplied FROM jsonb_array_elements(coalesce(instance.state->'parameterValues','[]'::jsonb)) value WHERE value->>'parameterId'=source_parameter_id;
      IF supplied IS NULL THEN
        SELECT CASE WHEN value->>'kind'='record' THEN jsonb_build_object('parameterId',target_id,'kind','record','recordId',value->>'recordId') WHEN value->'policy'->>'mode'='version' THEN jsonb_build_object('parameterId',target_id,'kind','dataset-version','datasetVersionId',value->'policy'->>'datasetVersionId') ELSE jsonb_build_object('parameterId',target_id,'kind','dataset','datasetId',value->>'datasetId') END INTO supplied
          FROM jsonb_array_elements(instance.state->'bindings') value WHERE value->>'parameterId'=source_parameter_id;
      END IF;
    END IF;
    IF supplied IS NOT NULL THEN inputs:=inputs||jsonb_build_array(supplied); END IF;
  END LOOP;
  resolved:=internal.resolve_sheet_parameters(instance.workspace_id,p_target_definition_version_id,inputs);

  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(instance.state->'instanceCalculations','[]'::jsonb)) LOOP
    dependencies:='[]'::jsonb;
    FOR nested IN SELECT value FROM jsonb_array_elements(item->'dependencies') LOOP
      mapped_id:=nested->>'id';
      IF nested->>'kind'='column' AND column_map ? mapped_id THEN mapped_id:=column_map->>mapped_id;
      ELSIF nested->>'kind'='column' AND mapped_id=ANY(retained_ids) THEN nested:=jsonb_set(nested,'{kind}','"local-field"',true);
      END IF;
      dependencies:=dependencies||jsonb_build_array(jsonb_set(nested,'{id}',to_jsonb(mapped_id),true));
    END LOOP;
    calculations:=calculations||jsonb_build_array(jsonb_set(item,'{dependencies}',dependencies,true));
  END LOOP;
  FOR source_id,nested IN SELECT * FROM jsonb_each(instance.state->'calculationOverrides') LOOP
    mapped_id:=source_id;
    IF overrides ? mapped_id THEN RAISE EXCEPTION 'calculation override mapping is not one-to-one' USING ERRCODE='SB088'; END IF;
    overrides:=overrides||jsonb_build_object(mapped_id,nested);
  END LOOP;

  presentation:=instance.state->'presentation';
  FOR collection IN SELECT unnest(ARRAY['columnOrder','hiddenColumnIds']) LOOP
    mapped:='[]'::jsonb; ordered_ids:='{}';
    FOR source_id IN SELECT value FROM jsonb_array_elements_text(presentation->collection) LOOP
      mapped_id:=coalesce(column_map->>source_id,source_id);
      IF mapped_id<>ALL(ordered_ids) THEN mapped:=mapped||jsonb_build_array(mapped_id); ordered_ids:=array_append(ordered_ids,mapped_id); END IF;
    END LOOP;
    presentation:=jsonb_set(presentation,ARRAY[collection],mapped,true);
  END LOOP;
  mapped:='{}'::jsonb;
  FOR source_id,nested IN SELECT * FROM jsonb_each(presentation->'columnWidths') LOOP mapped_id:=coalesce(column_map->>source_id,source_id); mapped:=mapped||jsonb_build_object(mapped_id,nested); END LOOP;
  presentation:=jsonb_set(presentation,'{columnWidths}',mapped,true);
  FOREACH collection IN ARRAY ARRAY['filters','sorts'] LOOP
    mapped:='[]'::jsonb;
    FOR item IN SELECT value FROM jsonb_array_elements(coalesce(presentation->collection,'[]'::jsonb)) LOOP mapped_id:=coalesce(column_map->>(item->>'columnId'),item->>'columnId'); mapped:=mapped||jsonb_build_array(jsonb_set(item,'{columnId}',to_jsonb(mapped_id),true)); END LOOP;
    presentation:=jsonb_set(presentation,ARRAY[collection],mapped,true);
  END LOOP;
  SELECT coalesce(array_agg(id),'{}') INTO allowed_ids FROM (
    SELECT value->>'id' id FROM jsonb_array_elements(target_config->'columns') value
    UNION SELECT value->>'fieldId' FROM jsonb_array_elements(instance.state->'localFields') value
    UNION SELECT value->>'id' FROM jsonb_array_elements(calculations) value
  ) ids;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(presentation->'columnOrder') id WHERE id<>ALL(allowed_ids)) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(presentation->'hiddenColumnIds') id WHERE id<>ALL(allowed_ids)) OR EXISTS(SELECT 1 FROM jsonb_object_keys(presentation->'columnWidths') id WHERE id<>ALL(allowed_ids)) OR EXISTS(SELECT 1 FROM jsonb_array_elements(presentation->'filters') AS filter_entry(value) WHERE (filter_entry.value->>'columnId')<>ALL(allowed_ids)) OR EXISTS(SELECT 1 FROM jsonb_array_elements(presentation->'sorts') AS sort_entry(value) WHERE (sort_entry.value->>'columnId')<>ALL(allowed_ids)) THEN RAISE EXCEPTION 'upgrade decisions leave incompatible Instance presentation references' USING ERRCODE='SB088'; END IF;
  ordered_ids:=ARRAY(SELECT value FROM jsonb_array_elements_text(presentation->'columnOrder'));
  FOR target_id IN SELECT value->>'id' FROM jsonb_array_elements(target_config->'columns') value LOOP IF target_id<>ALL(ordered_ids) THEN ordered_ids:=array_append(ordered_ids,target_id); END IF; END LOOP;
  presentation:=jsonb_set(presentation,'{columnOrder}',to_jsonb(ordered_ids),true);
  presentation:=jsonb_set(presentation,'{frozenColumnCount}',to_jsonb(least((presentation->>'frozenColumnCount')::integer,cardinality(ordered_ids))),true);

  identity:=target_config->'rowIdentity';
  SELECT value INTO first_identity_column FROM jsonb_array_elements(target_config->'columns') WHERE value->>'id'=identity->'columnIds'->>0;
  identity:=identity||jsonb_build_object('formatVersion',1,'logicalTypes',(SELECT jsonb_agg(column_item->'field'->>'logicalType' ORDER BY ids.ordinality) FROM jsonb_array_elements(identity->'columnIds') WITH ORDINALITY ids JOIN LATERAL jsonb_array_elements(target_config->'columns') column_item ON column_item->>'id'=ids.value#>>'{}'),'sourceBindingId',CASE WHEN identity->>'kind'='source' THEN first_identity_column->'source'->>'bindingId' ELSE NULL END,'sourceFieldId',CASE WHEN identity->>'kind'='source' THEN first_identity_column->'source'->>'sourceFieldId' ELSE NULL END);
  new_state:=(instance.state-'bindings'-'parameterValues'-'resolutionProvenance'-'resolvedRowIdentity'-'instanceCalculations')||resolved||jsonb_build_object('resolvedRowIdentity',identity,'calculationOverrides',overrides,'presentation',presentation);
  IF calculations<>'[]'::jsonb OR instance.state ? 'instanceCalculations' THEN new_state:=jsonb_set(new_state,'{instanceCalculations}',calculations,true); END IF;
  PERFORM internal.validate_sheet_instance_state(new_state); PERFORM internal.validate_sheet_instance_calculation_dependencies(p_target_definition_version_id,new_state); PERFORM internal.validate_sheet_instance_presentation(p_target_definition_version_id,new_state);

  PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true); PERFORM set_config('sheetbase.sheet_instance_upgrade','rpc-v1',true);
  UPDATE api.sheet_instances SET source_definition_version_id=p_target_definition_version_id,state=new_state,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=instance.id RETURNING * INTO instance;
  INSERT INTO api.sheet_instance_definition_upgrades(workspace_id,instance_id,source_definition_version_id,target_definition_version_id,source_instance_revision,resulting_instance_revision,decision_manifest,actor_user_id)
    VALUES(instance.workspace_id,instance.id,source_version_id,p_target_definition_version_id,p_expected_instance_revision,instance.revision,p_decisions,actor) RETURNING * INTO provenance;
  RETURN jsonb_build_object('status','applied','preview',preview,'instance',to_jsonb(instance),'provenance',jsonb_build_object('sourceDefinitionVersionId',provenance.source_definition_version_id,'targetDefinitionVersionId',provenance.target_definition_version_id,'sourceInstanceRevision',provenance.source_instance_revision,'resultingInstanceRevision',provenance.resulting_instance_revision,'actorUserId',provenance.actor_user_id,'upgradedAt',provenance.upgraded_at,'decisions',provenance.decision_manifest));
END $$;

CREATE OR REPLACE FUNCTION internal.guard_sheet_instance() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item jsonb; config jsonb;
BEGIN
  IF current_setting('sheetbase.sheet_instance_write',true) IS DISTINCT FROM 'rpc-v1' THEN RAISE EXCEPTION 'Sheet Instances require controlled RPCs' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Sheet Instances cannot be deleted' USING ERRCODE='42501'; END IF;
  PERFORM internal.validate_sheet_instance_state(NEW.state);
  IF TG_OP='UPDATE' AND (NEW.id,NEW.workspace_id,NEW.project_id,NEW.notebook_record_id,NEW.duplicated_from_instance_id,NEW.created_at,NEW.created_by_user_id) IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.project_id,OLD.notebook_record_id,OLD.duplicated_from_instance_id,OLD.created_at,OLD.created_by_user_id) THEN RAISE EXCEPTION 'Sheet Instance identity and provenance are immutable' USING ERRCODE='SB073'; END IF;
  IF TG_OP='UPDATE' AND NEW.source_definition_version_id IS DISTINCT FROM OLD.source_definition_version_id AND current_setting('sheetbase.sheet_instance_upgrade',true) IS DISTINCT FROM 'rpc-v1' THEN RAISE EXCEPTION 'Sheet Instance source requires controlled upgrade' USING ERRCODE='SB073'; END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api.projects WHERE id=NEW.project_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'project belongs to another workspace' USING ERRCODE='SB073'; END IF;
  IF NEW.notebook_record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api.records WHERE id=NEW.notebook_record_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Notebook Record belongs to another workspace' USING ERRCODE='SB073'; END IF;
  IF NEW.source_definition_version_id IS NOT NULL THEN SELECT v.configuration INTO config FROM api.sheet_definition_versions v JOIN api.sheet_definitions d ON d.id=v.definition_id WHERE v.id=NEW.source_definition_version_id AND d.workspace_id=NEW.workspace_id AND v.lifecycle='published'; IF config IS NULL THEN RAISE EXCEPTION 'source version must be published in this workspace' USING ERRCODE='SB073'; END IF; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.state->'bindings') LOOP
    IF item->>'kind'='dataset' THEN
      IF NOT EXISTS(SELECT 1 FROM api.datasets WHERE id=(item->>'datasetId')::uuid AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Dataset belongs to another workspace or does not exist' USING ERRCODE='SB073'; END IF;
      IF item->'policy'->>'mode'='version' AND NOT EXISTS(SELECT 1 FROM api.dataset_versions WHERE id=(item->'policy'->>'datasetVersionId')::uuid AND dataset_id=(item->>'datasetId')::uuid AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Dataset Version does not belong to named Dataset' USING ERRCODE='SB073'; END IF;
    ELSE IF NOT EXISTS(SELECT 1 FROM api.records WHERE id=(item->>'recordId')::uuid AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Record belongs to another workspace or does not exist' USING ERRCODE='SB073'; END IF; END IF;
    IF config IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(config->'bindings') b WHERE b->>'id'=item->>'bindingId' AND b->>'parameterId'=item->>'parameterId') THEN RAISE EXCEPTION 'resolved binding is absent from pinned Definition Version' USING ERRCODE='SB073'; END IF;
  END LOOP;
  IF NEW.source_definition_version_id IS NULL AND NEW.state->'provenance'->>'createdFrom'<>'ad_hoc' AND NEW.state->'provenance'->>'createdFrom'<>'duplicate' THEN RAISE EXCEPTION 'ad hoc source/provenance mismatch' USING ERRCODE='SB073'; END IF;
  IF NEW.source_definition_version_id IS NOT NULL AND NEW.state->'provenance'->>'createdFrom'='ad_hoc' THEN RAISE EXCEPTION 'Definition source/provenance mismatch' USING ERRCODE='SB073'; END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION internal.sheet_definition_upgrade_references(jsonb,text),internal.sheet_definition_upgrade_conflict(jsonb,text,text,jsonb,jsonb),internal.sheet_definition_upgrade_columns_compatible(jsonb,jsonb),internal.sheet_definition_upgrade_parameter_compatible(api.sheet_instances,text,jsonb,jsonb),internal.build_sheet_instance_definition_upgrade_preview(api.sheet_instances,uuid) FROM PUBLIC,authenticated,api_client;
REVOKE EXECUTE ON FUNCTION api.preview_sheet_instance_definition_upgrade(uuid,bigint,uuid),api.apply_sheet_instance_definition_upgrade(uuid,bigint,uuid,jsonb,jsonb) FROM PUBLIC,api_client;
GRANT EXECUTE ON FUNCTION api.preview_sheet_instance_definition_upgrade(uuid,bigint,uuid),api.apply_sheet_instance_definition_upgrade(uuid,bigint,uuid,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
