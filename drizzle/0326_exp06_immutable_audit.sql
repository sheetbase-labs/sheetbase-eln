-- Capture evidence at the canonical successful write. Do not backfill older
-- events from mutable live state, or infer causality from time/session proximity.
-- Keep SET's final reader and writer authority definitions intact.
DO $$ DECLARE definition text; anchor text;
BEGIN
  definition:=pg_get_functiondef('internal.emit_change_event(uuid,text,uuid,text,uuid,uuid,jsonb)'::regprocedure);
  anchor:='INSERT INTO api.workspace_change_seq';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Change emitter anchor missing'; END IF;
  definition:=replace(definition,anchor,$insert$
    p_payload:=coalesce(p_payload,'{}'::jsonb)-'sessionId';
    IF c->>'role'='authenticated' AND cid IS NULL THEN
      p_payload:=p_payload||coalesce((SELECT jsonb_build_object('sessionId',s.id)
        FROM internal.session s WHERE s.id=c->>'session_id'
          AND s."userId"=uid AND s."expiresAt">now()),'{}'::jsonb);
    END IF;
    INSERT INTO api.workspace_change_seq
  $insert$);
  EXECUTE definition;
END $$;
--> statement-breakpoint

DO $$ DECLARE definition text; anchor text;
BEGIN
  definition:=pg_get_functiondef('internal.trg_change_event_blocks()'::regprocedure);
  anchor:='PERFORM "internal"."emit_change_event"(
    v_workspace_id, ''block'', NEW.id, v_op, v_record_id, v_project_id, v_payload';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Block audit anchor missing'; END IF;
  EXECUTE replace(definition,anchor,$capture$
  IF TG_OP='UPDATE' AND OLD.payload IS DISTINCT FROM NEW.payload THEN
    v_payload:=v_payload||jsonb_build_object('changes',jsonb_build_object(
      'payload',jsonb_build_object('from',OLD.payload,'to',NEW.payload)));
  END IF;
  PERFORM "internal"."emit_change_event"(
    v_workspace_id, 'block', NEW.id, v_op, v_record_id, v_project_id, v_payload$capture$);
END $$;
--> statement-breakpoint

DO $$ DECLARE definition text; anchor text;
BEGIN
  definition:=pg_get_functiondef('internal.scientific_row_event()'::regprocedure);
  anchor:='jsonb_build_object(''tableId'',t.id,''rowId'',rid,''version'',ver,''changedColumnIds'',changed)';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Scientific audit anchor missing'; END IF;
  EXECUTE replace(definition,anchor,$capture$jsonb_build_object(
    'tableId',t.id,'rowId',rid,'version',ver,'changedColumnIds',changed,
    'inputRevision',(SELECT calculation_input_revision FROM api.records WHERE id=t.record_id),
    'changes',coalesce((SELECT jsonb_object_agg(c.id,jsonb_build_object('label',c.label,'columnId',c.id,
      'from',CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD)->c.field_name ELSE 'null'::jsonb END,
      'to',CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW)->c.field_name ELSE 'null'::jsonb END))
      FROM api.scientific_columns c WHERE c.table_id=t.id AND c.id IN
        (SELECT value::text::uuid FROM jsonb_array_elements_text(changed))),'{}'::jsonb))$capture$);
END $$;
--> statement-breakpoint

-- A Dataset row can be shown by several notebooks. Capture its current live
-- owners at the write, not by reconstructing ownership in the History UI.
CREATE FUNCTION internal.emit_dataset_row_audit(p_dataset api.datasets,p_row_id uuid,p_changes jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner record; marker uuid:=gen_random_uuid(); event_id uuid; result jsonb:='[]'; payload jsonb;
BEGIN
  payload:=jsonb_build_object('datasetId',p_dataset.id,'name',p_dataset.name,
    'rowId',p_row_id,'rowRevision',(SELECT revision FROM api.dataset_rows WHERE id=p_row_id),
    'datasetRevision',p_dataset.revision+1,'auditMutationId',marker,
    'changes',p_changes,'reason',p_reason);
  FOR owner IN
    SELECT DISTINCT r.id AS record_id,r.project_id FROM api.records r
    WHERE r.workspace_id=p_dataset.workspace_id AND (
      EXISTS(SELECT 1 FROM api.sheet_instances i,jsonb_array_elements(i.state->'bindings') binding
        WHERE i.notebook_record_id=r.id AND i.lifecycle='active'
          AND binding->>'datasetId'=p_dataset.id::text AND binding->'policy'->>'mode'='live')
      OR EXISTS(SELECT 1 FROM api.record_links link WHERE link.source_record_id=r.id
        AND link.target_kind='dataset' AND link.target_identifier=p_dataset.display_id))
    UNION ALL SELECT NULL::uuid,p_dataset.primary_project_id
  LOOP
    PERFORM internal.emit_change_event(p_dataset.workspace_id,'dataset',p_dataset.id,'update',
      owner.record_id,owner.project_id,payload);
    SELECT e.id INTO event_id FROM api.change_events e WHERE e.workspace_id=p_dataset.workspace_id
      AND e.payload->>'auditMutationId'=marker::text AND e.record_id IS NOT DISTINCT FROM owner.record_id;
    IF event_id IS NOT NULL AND (owner.record_id IS NULL OR internal.can_access_object('record',owner.record_id,'view')) THEN result:=result||jsonb_build_array(jsonb_build_object(
      'recordId',owner.record_id,'sourceEventId',event_id)); END IF;
  END LOOP;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION internal.emit_dataset_row_audit(api.datasets,uuid,jsonb,text) FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint

-- Saved live analyses become stale from Dataset revision changes, never from
-- unrelated local Sheet values. Record the transition only when every captured
-- source was current immediately before this successful Dataset batch.
CREATE FUNCTION internal.emit_dataset_analysis_staleness(p_dataset api.datasets,p_previous_revision bigint,p_sources jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE analysis record; owner record; ids jsonb;
BEGIN
  FOR analysis IN
    SELECT id,name,source_revisions FROM api.analysis_definitions WHERE workspace_id=p_dataset.workspace_id
    UNION ALL SELECT id,name,source_revisions FROM api.analysis_views WHERE workspace_id=p_dataset.workspace_id
  LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(analysis.source_revisions) source
      WHERE source->>'datasetId'=p_dataset.id::text AND source->'revision'=to_jsonb(p_previous_revision))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(analysis.source_revisions) source WHERE NOT EXISTS(
        SELECT 1 FROM api.datasets d JOIN api.dataset_schema_versions version ON version.id=d.schema_version_id
        WHERE d.id::text=source->>'datasetId' AND d.workspace_id=p_dataset.workspace_id
          AND source->'schemaVersionNumber'=to_jsonb(version.version)
          AND source->'revision'=to_jsonb(CASE WHEN d.id=p_dataset.id THEN p_previous_revision ELSE d.revision END)))
    THEN CONTINUE; END IF;
    FOR owner IN SELECT DISTINCT value->>'recordId' AS record_id FROM jsonb_array_elements(p_sources) LOOP
      SELECT jsonb_agg(value->'sourceEventId') INTO ids FROM jsonb_array_elements(p_sources)
        WHERE value->>'recordId' IS NOT DISTINCT FROM owner.record_id;
      PERFORM internal.emit_change_event(p_dataset.workspace_id,'dataset',p_dataset.id,'update',
        owner.record_id::uuid,p_dataset.primary_project_id,jsonb_build_object(
          'datasetId',p_dataset.id,'analysisId',analysis.id,'name',analysis.name,
          'sourceRevisions',analysis.source_revisions,
          'effect','stale_analysis','sourceEventIds',ids,
          'sourceEventId',CASE WHEN jsonb_array_length(ids)=1 THEN ids->0 ELSE 'null'::jsonb END,
          'changes',jsonb_build_object('status',jsonb_build_object('from','current','to','stale'))));
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION internal.emit_dataset_analysis_staleness(api.datasets,bigint,jsonb) FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint

DO $$ DECLARE definition text; anchor text;
BEGIN
  definition:=pg_get_functiondef('api.validate_dataset_row_batch(uuid,bigint,jsonb)'::regprocedure);
  anchor:='ARRAY[''operation'',''rowId'',''expectedRevision'',''values'',''plannedKey'']';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Dataset reason validation anchor missing'; END IF;
  definition:=replace(definition,anchor,'ARRAY[''operation'',''rowId'',''expectedRevision'',''values'',''plannedKey'',''reason'']');
  anchor:='IF item ? ''plannedKey'' AND';
  definition:=replace(definition,anchor,$validate$
    IF item ? 'reason' AND (jsonb_typeof(item->'reason')<>'string' OR length(btrim(item->>'reason')) NOT BETWEEN 1 AND 2000) THEN
      RAISE EXCEPTION 'Dataset change reason must contain 1 to 2000 characters' USING ERRCODE='22023';
    END IF;
    IF item ? 'plannedKey' AND$validate$);
  EXECUTE definition;

  definition:=pg_get_functiondef('api.commit_dataset_row_batch(uuid,bigint,jsonb,text)'::regprocedure);
  anchor:='effective jsonb;';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Dataset audit declaration anchor missing'; END IF;
  definition:=replace(definition,anchor,'effective jsonb; audit_old jsonb; audit_changes jsonb; audit_sources jsonb:=''[]'';');
  anchor:='FOR field IN SELECT * FROM api.dataset_schema_version_fields';
  definition:=replace(definition,anchor,'audit_changes:=''{}''; '||anchor);
  anchor:='DELETE FROM api.dataset_row_values WHERE row_id=v_row_id AND field_id=field.field_id;';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Dataset value capture anchor missing'; END IF;
  definition:=replace(definition,anchor,$capture$
    SELECT CASE WHEN count(*)=0 THEN 'null'::jsonb WHEN field.cardinality='many' THEN
      jsonb_agg(coalesce(to_jsonb(text_value),to_jsonb(integer_value),to_jsonb(numeric_value),to_jsonb(boolean_value),to_jsonb(date_value),to_jsonb(timestamp_value),to_jsonb(category_option_id),to_jsonb(reference_id)) ORDER BY ordinal)
      ELSE (jsonb_agg(coalesce(to_jsonb(text_value),to_jsonb(integer_value),to_jsonb(numeric_value),to_jsonb(boolean_value),to_jsonb(date_value),to_jsonb(timestamp_value),to_jsonb(category_option_id),to_jsonb(reference_id)) ORDER BY ordinal))->0 END
      INTO audit_old FROM api.dataset_row_values WHERE row_id=v_row_id AND field_id=field.field_id;
    IF audit_old IS DISTINCT FROM effective THEN
      audit_changes:=audit_changes||jsonb_build_object(field.field_id,jsonb_build_object(
        'label',field.label,'fieldId',field.field_id,'from',audit_old,'to',effective));
    END IF;
    DELETE FROM api.dataset_row_values WHERE row_id=v_row_id AND field_id=field.field_id;
  $capture$);
  anchor:='PERFORM internal.sync_dataset_value_system_flags(dataset.id,v_row_id,dataset.schema_version_id,item->''values'');';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Dataset audit success anchor missing'; END IF;
  definition:=replace(definition,anchor,anchor||$emit$
    IF audit_changes<>'{}'::jsonb THEN audit_sources:=audit_sources||internal.emit_dataset_row_audit(dataset,v_row_id,audit_changes,nullif(btrim(item->>'reason'),'')); END IF;
  $emit$);
  anchor:='''rows'',result_rows,''idempotent'',false';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Dataset audit receipt anchor missing'; END IF;
  definition:=replace(definition,anchor,'''rows'',result_rows,''sourceEvents'',audit_sources,''idempotent'',false');
  anchor:='INSERT INTO api.dataset_bulk_commits';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Dataset stale analysis anchor missing'; END IF;
  definition:=replace(definition,anchor,'PERFORM internal.emit_dataset_analysis_staleness(dataset,p_expected_dataset_revision,audit_sources); '||anchor);
  EXECUTE definition;
END $$;
--> statement-breakpoint

-- The input revision is allocated by the successful scientific row write and
-- captured on that event. The worker already rejects a different revision.
-- Resolve this exact immutable identity, never a nearby event or timestamp.
DO $$ DECLARE definition text; anchor text;
BEGIN
  definition:=pg_get_functiondef('internal.apply_trusted_calculation(text,uuid,bigint,text,jsonb,jsonb,text,text,text)'::regprocedure);
  anchor:='result_kind text;';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Calculation audit declaration anchor missing'; END IF;
  definition:=replace(definition,anchor,'result_kind text; audit_changes jsonb:=''{}''; audit_old jsonb; audit_new jsonb;');
  anchor:='INSERT INTO internal.formula_result_cache';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Calculation value capture anchor missing'; END IF;
  definition:=replace(definition,anchor,$capture$
    SELECT coalesce(value,to_jsonb(error_code)) INTO audit_old FROM internal.formula_result_cache WHERE formula_id=f.id;
    audit_new:=CASE WHEN result_kind='value' THEN item->'value' ELSE to_jsonb(item->>'errorCode') END;
    IF audit_old IS DISTINCT FROM audit_new THEN audit_changes:=audit_changes||jsonb_build_object(
      f.id,jsonb_build_object('label',f.target_row_id::text||' / '||(SELECT label FROM api.scientific_columns WHERE id=f.target_column_id),
      'from',audit_old,'to',audit_new,'formulaId',f.id,'rowId',f.target_row_id,'columnId',f.target_column_id)); END IF;
    INSERT INTO internal.formula_result_cache$capture$);
  anchor:='jsonb_build_object(''recordId'',r.id,''inputRevision'',p_input_revision,''status'',p_outcome)';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Calculation source identity anchor missing'; END IF;
  definition:=replace(definition,anchor,$capture$jsonb_build_object(
    'recordId',r.id,'inputRevision',p_input_revision,'status',p_outcome,'changes',audit_changes,
    'sourceEventId',(SELECT e.id FROM api.change_events e WHERE e.workspace_id=r.workspace_id
      AND e.record_id=r.id AND e.entity_type='scientific_row'
      AND e.payload->'inputRevision'=to_jsonb(p_input_revision)))$capture$);
  EXECUTE definition;
END $$;
--> statement-breakpoint

-- Record the values the trusted Sheet calculation engine actually persisted.
-- Dataset source revisions resolve exact row-write events captured above.
DO $$ DECLARE definition text; anchor text;
BEGIN
  definition:=pg_get_functiondef('internal.apply_trusted_sheet_calculation(text,uuid,bigint,uuid,jsonb)'::regprocedure);
  anchor:='active_count integer;';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Sheet calculation audit declaration anchor missing'; END IF;
  definition:=replace(definition,anchor,'active_count integer; audit_old jsonb; audit_new jsonb; audit_sources jsonb;');
  anchor:='INSERT INTO internal.sheet_instance_calculation_results';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Sheet calculation audit write anchor missing'; END IF;
  definition:=replace(definition,anchor,$capture$
    IF NOT internal.sheet_calculation_result_current(instance.revision,instance.revision,item->'sourceRevisions') THEN
      RAISE EXCEPTION 'Sheet calculation source row revision changed' USING ERRCODE='SB001';
    END IF;
    SELECT coalesce(value,to_jsonb(error_code)) INTO audit_old FROM internal.sheet_instance_calculation_results
      WHERE instance_id=instance.id AND calculation_id=(item->>'calculationId')::uuid AND row_key=item->>'rowKey';
    audit_new:=CASE WHEN item->>'resultKind'='value' THEN item->'value' ELSE to_jsonb(item->>'errorCode') END;
    SELECT coalesce(jsonb_agg(DISTINCT to_jsonb(e.id)),'[]'::jsonb) INTO audit_sources
      FROM jsonb_array_elements(item->'sourceRevisions') source JOIN api.change_events e
        ON e.workspace_id=instance.workspace_id AND e.entity_type='dataset'
        AND e.payload->>'datasetId'=source->>'datasetId' AND e.payload->>'rowId'=source->>'rowId'
        AND e.payload->'rowRevision'=source->'revision'
        AND e.record_id IS NOT DISTINCT FROM instance.notebook_record_id
      WHERE source->>'kind'='dataset-row' AND source->'matched'='true'::jsonb;
    IF audit_old IS DISTINCT FROM audit_new THEN
      PERFORM internal.emit_change_event_as_actor(p_actor,instance.workspace_id,'calculation',instance.id,'update',
        instance.notebook_record_id,instance.project_id,jsonb_build_object(
          'instanceId',instance.id,'name',instance.name,'rowKey',item->>'rowKey','effect','recalculated_cell',
          'sourceRevisions',item->'sourceRevisions','sourceEventIds',audit_sources,
          'sourceEventId',CASE WHEN jsonb_array_length(audit_sources)=1 THEN audit_sources->0 ELSE 'null'::jsonb END,
          'changes',jsonb_build_object(item->>'calculationId',jsonb_build_object(
            'label',item->'outputField'->>'label','from',audit_old,'to',audit_new))));
    END IF;
    INSERT INTO internal.sheet_instance_calculation_results$capture$);
  EXECUTE definition;
END $$;
--> statement-breakpoint

-- Analysis display identities live in analysis_views, not records. A citation
-- must resolve the exact same-workspace view and all its live source guards.
-- Retain the Dataset contract and never accept a records-only FK for either.
CREATE OR REPLACE FUNCTION internal.can_read_record_link_target(p_source_record_id uuid,p_target_kind text,p_target_identifier text,p_target_record_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN p_target_kind='dataset' THEN
    p_target_record_id IS NULL AND EXISTS(
      SELECT 1 FROM api.datasets d JOIN api.records s ON s.workspace_id=d.workspace_id
      WHERE s.id=p_source_record_id AND d.display_id=p_target_identifier
        AND internal.can_access_object('dataset',d.id,'view'))
  WHEN p_target_kind='analysis' THEN
    p_target_record_id IS NULL AND EXISTS(
      SELECT 1 FROM api.analysis_views a JOIN api.records s ON s.workspace_id=a.workspace_id
      WHERE s.id=p_source_record_id AND a.display_id=p_target_identifier
        AND a.workspace_id=api.current_workspace_id()
        AND (api.claim_probe()->>'role'='api_client' OR
          (api.claim_probe()->>'role'='authenticated' AND api.is_workspace_member(a.workspace_id)))
        AND internal.sources_readable(a.spec) AND internal.sources_readable(a.source_revisions))
  ELSE EXISTS(
    SELECT 1 FROM api.records t JOIN api.records s ON s.workspace_id=t.workspace_id
    WHERE s.id=p_source_record_id AND t.kind=p_target_kind AND t.identifier=p_target_identifier
      AND (p_target_record_id IS NULL OR t.id=p_target_record_id)
      AND internal.can_access_object('record',t.id,'view')) END
$$;
--> statement-breakpoint
DO $$ DECLARE definition text; anchor text;
BEGIN
  definition:=pg_get_functiondef('internal.can_read_change_event(api.change_events)'::regprocedure);
  anchor:='RETURN internal.sources_readable(p_event.payload);';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Audit live source guard anchor missing'; END IF;
  EXECUTE replace(definition,anchor,$guard$
    IF p_event.entity_type='record_link' AND NOT internal.can_read_record_link_target(
      p_event.record_id,p_event.payload->>'targetKind',p_event.payload->>'targetIdentifier',NULL) THEN RETURN false; END IF;
    RETURN internal.sources_readable(p_event.payload);$guard$);
END $$;
--> statement-breakpoint
NOTIFY pgrst,'reload schema';
