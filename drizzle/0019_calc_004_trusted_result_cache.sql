-- CALC-004: result caches are derived, revision-bound records. They live in
-- internal so PostgREST exposes only the status-aware projection below.
CREATE TABLE internal.formula_result_cache (
 formula_id uuid PRIMARY KEY REFERENCES api.formula_definitions(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
 record_id uuid NOT NULL REFERENCES api.records(id) ON DELETE CASCADE,
 formula_version bigint NOT NULL CHECK (formula_version>0),
 input_revision bigint NOT NULL CHECK (input_revision>=0),
 schema_versions jsonb NOT NULL CHECK (jsonb_typeof(schema_versions)='object'),
 status text NOT NULL CHECK (status IN ('completed','failed','unavailable')),
 result_kind text NOT NULL CHECK (result_kind IN ('value','error','none')),
 value jsonb,
 error_code text,
 diagnostic text,
 engine_version text NOT NULL,
 profile_fingerprint text NOT NULL,
 runtime_fingerprint text NOT NULL,
 calculated_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (
   (status='completed' AND result_kind='value' AND value IS NOT NULL AND error_code IS NULL)
   OR (status='completed' AND result_kind='error' AND value IS NULL AND error_code IN ('DIV_BY_ZERO','NAME','VALUE','NUM','NA','CYCLE','REF','SPILL','LIC','ERROR'))
   OR (status IN ('failed','unavailable') AND result_kind='none' AND value IS NULL AND error_code IN ('WORKER_FAILED','UNSUPPORTED'))
 ),
 CHECK (diagnostic IS NULL OR length(diagnostic)<=500),
 CHECK (engine_version='3.3.0'),
 CHECK (profile_fingerprint='fnv1a32-0c96cef0'),
 CHECK (runtime_fingerprint ~ '^fnv1a32-[0-9a-f]{8}$')
);
CREATE INDEX idx_formula_result_record ON internal.formula_result_cache(record_id);
ALTER TABLE internal.formula_result_cache ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA internal TO authenticated,api_client;
GRANT SELECT ON internal.formula_result_cache TO authenticated,api_client;
CREATE POLICY formula_result_member_read ON internal.formula_result_cache FOR SELECT TO authenticated
 USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY formula_result_api_read ON internal.formula_result_cache FOR SELECT TO api_client
 USING(workspace_id=api.current_workspace_id() AND internal.scientific_actor(workspace_id,ARRAY['scientific:read']) IS NOT NULL);
REVOKE INSERT,UPDATE,DELETE ON internal.formula_result_cache FROM PUBLIC,authenticated,api_client,formula_writer;
--> statement-breakpoint

-- Security-invoker preserves RLS on definitions, records and the internal
-- cache. A stale cached scalar is deliberately not projected in
-- calculated_value, so consumers cannot mistake it for current output.
CREATE VIEW api.formula_results WITH (security_invoker=true,security_barrier=true) AS
SELECT f.id formula_id,f.workspace_id,f.record_id,f.target_table_id,
 f.target_row_id,f.target_column_id,f.source_expression,
 'formula'::text cell_kind,false value_is_authoritative,
 f.status definition_status,f.version formula_version,
 r.calculation_input_revision current_input_revision,
 CASE
  WHEN f.status='unsupported' THEN 'unavailable'
  WHEN c.formula_id IS NULL THEN 'pending'
  WHEN c.formula_version<>f.version OR c.input_revision<>r.calculation_input_revision THEN 'stale'
  WHEN c.status='completed' THEN 'current'
  ELSE c.status
 END calculation_status,
 CASE WHEN c.status='completed' AND c.result_kind='value' AND c.formula_version=f.version AND c.input_revision=r.calculation_input_revision THEN c.value END calculated_value,
 CASE WHEN c.formula_version=f.version AND c.input_revision=r.calculation_input_revision THEN c.error_code END calculation_error_code,
 c.input_revision cache_input_revision,c.schema_versions,c.engine_version,
 c.profile_fingerprint,c.runtime_fingerprint,c.calculated_at
FROM api.formula_definitions f
JOIN api.records r ON r.id=f.record_id
LEFT JOIN internal.formula_result_cache c ON c.formula_id=f.id;
GRANT SELECT ON api.formula_results TO authenticated,api_client;
--> statement-breakpoint

CREATE FUNCTION internal.apply_trusted_calculation(
 p_actor_user_id text,p_record_id uuid,p_input_revision bigint,p_outcome text,
 p_results jsonb,p_schema_versions jsonb,p_profile_fingerprint text,
 p_runtime_fingerprint text,p_diagnostic text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r api.records; f api.formula_definitions; item jsonb; supplied_count bigint; supplied_distinct bigint; formula_count bigint; expected_schema_versions jsonb; result_status text; result_kind text;
BEGIN
 IF p_outcome NOT IN ('completed','failed') OR jsonb_typeof(p_results)<>'array' OR jsonb_typeof(p_schema_versions)<>'object' OR p_profile_fingerprint<>'fnv1a32-0c96cef0' OR p_runtime_fingerprint !~ '^fnv1a32-[0-9a-f]{8}$' OR length(coalesce(p_diagnostic,''))>500 THEN RAISE EXCEPTION 'invalid calculation result shape' USING ERRCODE='22023'; END IF;
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
END $$;
REVOKE EXECUTE ON FUNCTION internal.apply_trusted_calculation(text,uuid,bigint,text,jsonb,jsonb,text,text,text) FROM PUBLIC,authenticated,api_client;
GRANT EXECUTE ON FUNCTION internal.apply_trusted_calculation(text,uuid,bigint,text,jsonb,jsonb,text,text,text) TO formula_writer;
--> statement-breakpoint
NOTIFY pgrst,'reload schema';
