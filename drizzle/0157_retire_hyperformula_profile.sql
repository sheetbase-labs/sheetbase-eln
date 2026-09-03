-- Retire the HyperFormula calculation model (Phase 3): the trusted
-- calculation finalizer now records results produced by the sheetbase-table
-- engine, so the enforced profile fingerprint moves to the new identity.
CREATE OR REPLACE FUNCTION internal.apply_trusted_calculation(
  p_actor_user_id text,
  p_record_id uuid,
  p_input_revision bigint,
  p_outcome text,
  p_results jsonb,
  p_schema_versions jsonb,
  p_profile_fingerprint text,
  p_runtime_fingerprint text,
  p_diagnostic text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE r api.records; f api.formula_definitions; item jsonb; supplied_count bigint; supplied_distinct bigint; formula_count bigint; expected_schema_versions jsonb; result_status text; result_kind text;
BEGIN
 IF p_outcome NOT IN ('completed','failed') OR jsonb_typeof(p_results)<>'array' OR jsonb_typeof(p_schema_versions)<>'object' OR p_profile_fingerprint<>'fnv1a32-12f5dcb7' OR p_runtime_fingerprint !~ '^fnv1a32-[0-9a-f]{8}$' OR length(coalesce(p_diagnostic,''))>500 THEN RAISE EXCEPTION 'invalid calculation result shape' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM api.records WHERE id=p_record_id FOR UPDATE;
 IF r.id IS NULL OR r.archived_at IS NOT NULL OR r.deleted_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM api.workspace_memberships m WHERE m.workspace_id=r.workspace_id AND m.user_id=p_actor_user_id) THEN RAISE EXCEPTION 'calculation target denied' USING ERRCODE='42501'; END IF;
 IF r.calculation_input_revision IS DISTINCT FROM p_input_revision THEN RAISE EXCEPTION 'calculation input revision changed' USING ERRCODE='SB001'; END IF;
 SELECT coalesce(jsonb_object_agg(t.id::text,t.schema_version ORDER BY t.id),'{}'::jsonb) INTO expected_schema_versions FROM api.scientific_tables t WHERE t.record_id=r.id AND t.lifecycle='active';
 IF p_schema_versions IS DISTINCT FROM expected_schema_versions THEN RAISE EXCEPTION 'calculation schema versions do not match current tables' USING ERRCODE='SB001'; END IF;
 SELECT count(*) INTO formula_count FROM api.formula_definitions WHERE record_id=r.id;
 IF p_outcome='completed' THEN
  SELECT count(*),count(DISTINCT value->>'formulaId') INTO supplied_count,supplied_distinct FROM jsonb_array_elements(p_results);
  IF supplied_count<>formula_count OR supplied_distinct<>formula_count OR EXISTS(
    SELECT 1 FROM api.formula_definitions current_formula
    WHERE current_formula.record_id=r.id AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(p_results) supplied
      WHERE supplied->>'formulaId'=current_formula.id::text
        AND (supplied->>'formulaVersion')::bigint=current_formula.version
    )
  ) THEN RAISE EXCEPTION 'calculation results do not match current formula set' USING ERRCODE='SB001'; END IF;
 END IF;
 FOR f IN SELECT * FROM api.formula_definitions WHERE record_id=r.id ORDER BY id LOOP
  IF p_outcome='failed' THEN
   result_status:=CASE WHEN f.status='unsupported' THEN 'unavailable' ELSE 'failed' END;
   result_kind:='none'; item:=jsonb_build_object('errorCode',CASE WHEN f.status='unsupported' THEN 'UNSUPPORTED' ELSE 'WORKER_FAILED' END);
  ELSE
   SELECT value INTO item FROM jsonb_array_elements(p_results) WHERE value->>'formulaId'=f.id::text;
   IF jsonb_typeof(item)<>'object' OR item-ARRAY['formulaId','formulaVersion','status','resultKind','value','errorCode','diagnostic']<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid formula result' USING ERRCODE='22023'; END IF;
   result_status:=item->>'status'; result_kind:=item->>'resultKind';
   IF (f.status='unsupported' AND (result_status<>'unavailable' OR result_kind<>'none' OR item->>'errorCode'<>'UNSUPPORTED'))
      OR (f.status='supported' AND result_status<>'completed')
      OR (result_kind='value' AND (NOT item ? 'value' OR jsonb_typeof(item->'value') NOT IN ('null','string','number','boolean') OR item ? 'errorCode'))
      OR (result_kind='error' AND (item ? 'value' OR item->>'errorCode' NOT IN ('DIV_BY_ZERO','NAME','VALUE','NUM','NA','CYCLE','REF','SPILL','LIC','ERROR')))
      OR (result_kind='none' AND (item ? 'value' OR item->>'errorCode'<>'UNSUPPORTED'))
      OR result_kind NOT IN ('value','error','none') OR length(coalesce(item->>'diagnostic',''))>500
   THEN RAISE EXCEPTION 'invalid formula result state' USING ERRCODE='22023'; END IF;
  END IF;
  INSERT INTO internal.formula_result_cache(formula_id,workspace_id,record_id,formula_version,input_revision,schema_versions,status,result_kind,value,error_code,diagnostic,engine_version,profile_fingerprint,runtime_fingerprint,calculated_at,updated_at)
  VALUES(f.id,f.workspace_id,f.record_id,f.version,p_input_revision,p_schema_versions,result_status,result_kind,CASE WHEN result_kind='value' THEN item->'value' END,item->>'errorCode',coalesce(item->>'diagnostic',p_diagnostic),'3.3.0',p_profile_fingerprint,p_runtime_fingerprint,now(),now())
  ON CONFLICT(formula_id) DO UPDATE SET formula_version=EXCLUDED.formula_version,input_revision=EXCLUDED.input_revision,schema_versions=EXCLUDED.schema_versions,status=EXCLUDED.status,result_kind=EXCLUDED.result_kind,value=EXCLUDED.value,error_code=EXCLUDED.error_code,diagnostic=EXCLUDED.diagnostic,engine_version=EXCLUDED.engine_version,profile_fingerprint=EXCLUDED.profile_fingerprint,runtime_fingerprint=EXCLUDED.runtime_fingerprint,calculated_at=EXCLUDED.calculated_at,updated_at=now();
 END LOOP;
 PERFORM internal.emit_change_event_as_actor(p_actor_user_id,r.workspace_id,'calculation',r.id,'update',r.id,r.project_id,jsonb_build_object('recordId',r.id,'inputRevision',p_input_revision,'status',p_outcome));
 RETURN jsonb_build_object('recordId',r.id,'inputRevision',p_input_revision,'status',p_outcome,'formulaCount',formula_count);
END 

$function$;