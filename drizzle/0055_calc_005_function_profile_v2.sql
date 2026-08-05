-- CALC-005: Advance the function profile from scientific-core-v1 to
-- scientific-core-v2.  v2 is a strict superset of v1: it adds 112 built-in
-- HyperFormula 3.3.0 functions (statistics, math, lookup, text, date, logical,
-- information) while keeping the v1 allow-list intact.
--
-- Volatile functions (RAND, RANDBETWEEN, NOW, TODAY) and coordinate-
-- introspective functions (ROW, COLUMN, OFFSET, INDIRECT) remain excluded per
-- ADR 0021: they break the reproducibility and stable-identity invariants that
-- make a `current` result cache trustworthy.  ROWS and COLUMNS are admitted
-- because they return deterministic range dimensions derived from UUID-bound
-- captured members, not disposable absolute coordinates.
--
-- The profile fingerprint changes because SHEETBASE_FUNCTION_MAP (part of the
-- semantic profile hash) gains entries.  All existing result caches are
-- invalidated because their fingerprint no longer matches.

-- 1. Advance persisted v1 definitions to v2 (superset — every v1 formula is a
--    valid v2 formula).
UPDATE api.formula_definitions
SET function_profile = 'scientific-core-v2', updated_at = now()
WHERE function_profile = 'scientific-core-v1';
--> statement-breakpoint

-- 2. Reclassify previously-unsupported formulas whose functions are now all
--    admitted by the v2 allow-list.  jsonb_path_query descends into the
--    template tree to collect every functionId; if none fall outside the
--    allow-list the definition becomes supported.
UPDATE api.formula_definitions
SET status = 'supported', updated_at = now()
WHERE status = 'unsupported'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_path_query(template, 'lax $.**.functionId') AS id
    WHERE id #>> '{}' NOT IN ('SUM','PRODUCT','SUMSQ','AVERAGE','MEDIAN','MIN','MAX','COUNT','COUNTA','STDEV.S','STDEV.P','VAR.S','VAR.P','ABS','SIGN','MOD','POWER','SQRT','EXP','LN','LOG','LOG10','ROUND','ROUNDDOWN','ROUNDUP','INT','PI','SIN','COS','TAN','ASIN','ACOS','ATAN','ATAN2','DEGREES','RADIANS','IF','IFS','AND','OR','NOT','IFERROR','IFNA','NA','ISBLANK','ISERROR','ISNA','ISNUMBER','ISTEXT','INDEX','MATCH','XLOOKUP','DATE','TIME','YEAR','MONTH','DAY','HOUR','MINUTE','SECOND','STDEV','STDEVA','STDEVP','STDEVPA','VAR','VARA','VARP','VARPA','COVARIANCE.P','COVARIANCE.S','CORREL','PEARSON','NORM.DIST','NORM.INV','NORM.S.DIST','NORM.S.INV','T.DIST','T.DIST.2T','T.INV','T.INV.2T','T.TEST','CHISQ.DIST','CHISQ.INV','CHISQ.TEST','F.DIST','F.INV','F.TEST','PERCENTILE','PERCENTILE.INC','PERCENTILE.EXC','QUARTILE','QUARTILE.INC','QUARTILE.EXC','LARGE','SMALL','SKEW','SKEW.P','CONFIDENCE','CONFIDENCE.NORM','CONFIDENCE.T','AVERAGEIF','SUMIF','SUMIFS','COUNTIF','COUNTIFS','GEOMEAN','HARMEAN','RSQ','MROUND','CEILING','CEILING.MATH','FLOOR','FLOOR.MATH','FACT','FACTDOUBLE','COMBIN','GCD','LCM','SERIESSUM','SUMPRODUCT','SUBTOTAL','BASE','DECIMAL','ROMAN','ARABIC','VLOOKUP','HLOOKUP','CHOOSE','COLUMNS','ROWS','ADDRESS','TRANSPOSE','FILTER','SEQUENCE','LEFT','RIGHT','MID','LEN','FIND','SEARCH','REPLACE','SUBSTITUTE','UPPER','LOWER','PROPER','TRIM','CLEAN','CONCATENATE','TEXTJOIN','TEXT','VALUE','REPT','DATEDIF','DATEVALUE','TIMEVALUE','NETWORKDAYS','WORKDAY','EOMONTH','EDATE','WEEKDAY','WEEKNUM','ISOWEEKNUM','TRUE','FALSE','XOR','SWITCH','ISLOGICAL','ISNONTEXT','ISODD','ISEVEN','ISREF','N')
  );
--> statement-breakpoint

-- 3. Replace the formula-definition profile CHECK constraint.
ALTER TABLE api.formula_definitions DROP CONSTRAINT IF EXISTS chk_formula_profiles;
--> statement-breakpoint
ALTER TABLE api.formula_definitions ADD CONSTRAINT chk_formula_profiles CHECK(syntax_profile='sheetbase-hf-en-us-v1' AND function_profile='scientific-core-v2' AND literal_profile='sheetbase-literal-v1' AND engine_version='3.3.0');
--> statement-breakpoint

-- 4. Invalidate all existing result caches (old fingerprint).
DELETE FROM internal.formula_result_cache;
--> statement-breakpoint

-- 5. Replace the result-cache profile CHECK constraint with the new fingerprint.
ALTER TABLE internal.formula_result_cache DROP CONSTRAINT IF EXISTS formula_result_profile_check;
--> statement-breakpoint
ALTER TABLE internal.formula_result_cache ADD CONSTRAINT formula_result_profile_check CHECK(engine_version='3.3.0' AND profile_fingerprint='fnv1a32-dcfa915f');
--> statement-breakpoint

-- 6. Update the trusted formula-write RPC to accept profile v2.
CREATE OR REPLACE FUNCTION internal.apply_trusted_formula_write(p_actor_user_id text,p_write jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op text:=p_write->>'operation'; tid uuid; rid uuid; cid uuid; t api.scientific_tables; r api.records; col api.scientific_columns; f api.formula_definitions; dep jsonb; source_t api.scientific_tables; source_c api.scientific_columns; marker uuid[]; replacement jsonb; result jsonb; nrows bigint; ncols bigint; derived jsonb; supplied jsonb; source_row_exists boolean; workspace_status text; notebook_record_id uuid;
BEGIN
 IF jsonb_typeof(p_write)<>'object' OR op NOT IN ('create','update','remove') OR jsonb_typeof(p_write->'target')<>'object' OR p_write-ARRAY['operation','target','expectedSchemaVersion','expectedRowVersion','expectedFormulaVersion','artifact','replacement'] <> '{}'::jsonb THEN RAISE EXCEPTION 'invalid trusted formula write shape' USING ERRCODE='22023'; END IF;
 tid:=(p_write#>>'{target,tableId}')::uuid; rid:=(p_write#>>'{target,rowId}')::uuid; cid:=(p_write#>>'{target,columnId}')::uuid;
 SELECT st.record_id INTO notebook_record_id FROM api.scientific_tables st WHERE st.id=tid; IF notebook_record_id IS NULL THEN RAISE EXCEPTION 'formula target denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM api.scientific_tables st WHERE st.record_id=notebook_record_id AND st.lifecycle='active' ORDER BY st.id FOR UPDATE;
 FOR source_t IN SELECT st.* FROM api.scientific_tables st WHERE st.record_id=notebook_record_id AND st.lifecycle='active' ORDER BY st.resource_name LOOP EXECUTE format('LOCK TABLE api.%I IN SHARE ROW EXCLUSIVE MODE',source_t.resource_name); END LOOP;
 SELECT * INTO t FROM api.scientific_tables WHERE id=tid; SELECT status INTO workspace_status FROM api.workspaces WHERE id=t.workspace_id FOR SHARE; SELECT * INTO r FROM api.records WHERE id=t.record_id FOR UPDATE;
 IF t.id IS NULL OR t.lifecycle<>'active' OR workspace_status<>'active' OR r.archived_at IS NOT NULL OR r.deleted_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM api.workspace_memberships m WHERE m.workspace_id=t.workspace_id AND m.user_id=p_actor_user_id) THEN RAISE EXCEPTION 'formula target denied' USING ERRCODE='42501'; END IF;
 IF (p_write->>'expectedSchemaVersion')::int IS DISTINCT FROM t.schema_version THEN RAISE EXCEPTION 'schema version mismatch' USING ERRCODE='SB001'; END IF;
 SELECT * INTO col FROM api.scientific_columns WHERE id=cid AND table_id=tid AND workspace_id=t.workspace_id AND lifecycle='active'; IF col.id IS NULL THEN RAISE EXCEPTION 'active target column required' USING ERRCODE='22023'; END IF;
 EXECUTE format('SELECT formula_column_ids,version FROM api.%I WHERE id=$1 FOR UPDATE',t.resource_name) INTO marker,nrows USING rid; IF marker IS NULL THEN RAISE EXCEPTION 'target row missing' USING ERRCODE='P0002'; END IF; IF nrows IS DISTINCT FROM (p_write->>'expectedRowVersion')::bigint THEN RAISE EXCEPTION 'row version mismatch' USING ERRCODE='SB001'; END IF;
 SELECT * INTO f FROM api.formula_definitions WHERE target_table_id=tid AND target_row_id=rid AND target_column_id=cid FOR UPDATE;
 IF op='create' AND f.id IS NOT NULL OR op IN ('update','remove') AND (f.id IS NULL OR f.version IS DISTINCT FROM (p_write->>'expectedFormulaVersion')::bigint) THEN RAISE EXCEPTION 'formula version mismatch' USING ERRCODE='SB001'; END IF;
 IF op<>'remove' THEN
  IF jsonb_typeof(p_write->'artifact')<>'object' OR (p_write->'artifact')-ARRAY['version','syntaxProfile','functionProfile','literalProfile','engineVersion','status','source','template','bindings','engineExpression','dependencies'] <> '{}'::jsonb OR (p_write#>>'{artifact,version}')::int<>1 OR p_write#>>'{artifact,syntaxProfile}'<>'sheetbase-hf-en-us-v1' OR p_write#>>'{artifact,functionProfile}'<>'scientific-core-v2' OR p_write#>>'{artifact,literalProfile}'<>'sheetbase-literal-v1' OR p_write#>>'{artifact,engineVersion}'<>'3.3.0' OR jsonb_typeof(p_write#>'{artifact,template}')<>'object' OR jsonb_typeof(p_write#>'{artifact,bindings}')<>'array' OR jsonb_typeof(p_write#>'{artifact,dependencies}')<>'array' THEN RAISE EXCEPTION 'unknown or invalid formula artifact' USING ERRCODE='22023'; END IF;
  WITH cells AS (
    SELECT coalesce(b->>'tableId',tid::text) table_id,b#>'{cell}' AS cell FROM jsonb_array_elements(p_write#>'{artifact,bindings}') b WHERE b->>'kind'='cell'
    UNION ALL
    SELECT coalesce(b->>'tableId',tid::text),cell FROM jsonb_array_elements(p_write#>'{artifact,bindings}') b CROSS JOIN LATERAL jsonb_array_elements(b->'members') member_row CROSS JOIN LATERAL jsonb_array_elements(member_row) cell WHERE b->>'kind'='range'
  ) SELECT coalesce(jsonb_agg(x ORDER BY x->>'tableId',x->>'rowId',x->>'columnId'),'[]'::jsonb) INTO derived FROM (SELECT DISTINCT jsonb_build_object('tableId',table_id,'rowId',cell->>'rowId','columnId',cell->>'columnId') x FROM cells) q;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'tableId',x->>'rowId',x->>'columnId'),'[]'::jsonb) INTO supplied FROM (SELECT DISTINCT value x FROM jsonb_array_elements(p_write#>'{artifact,dependencies}')) q;
  IF derived IS DISTINCT FROM supplied THEN RAISE EXCEPTION 'dependencies must exactly match formula bindings' USING ERRCODE='23514'; END IF;
  FOR dep IN SELECT value FROM jsonb_array_elements(p_write#>'{artifact,dependencies}') LOOP
   IF jsonb_typeof(dep)<>'object' OR dep-ARRAY['tableId','rowId','columnId']<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid dependency' USING ERRCODE='23514'; END IF;
   SELECT * INTO source_t FROM api.scientific_tables WHERE id=(dep->>'tableId')::uuid AND workspace_id=t.workspace_id AND record_id=t.record_id AND lifecycle='active'; SELECT * INTO source_c FROM api.scientific_columns WHERE id=(dep->>'columnId')::uuid AND table_id=source_t.id AND lifecycle='active'; IF source_t.id IS NULL OR source_c.id IS NULL THEN RAISE EXCEPTION 'active same-notebook dependency required' USING ERRCODE='23514'; END IF;
   EXECUTE format('SELECT count(*),EXISTS(SELECT 1 FROM api.%I WHERE id=$1) FROM api.%I',source_t.resource_name,source_t.resource_name) INTO nrows,source_row_exists USING (dep->>'rowId')::uuid; SELECT count(*) INTO ncols FROM api.scientific_columns WHERE table_id=source_t.id AND lifecycle='active'; IF nrows>10000 OR ncols>256 THEN RAISE EXCEPTION 'formula calculation limits exceeded' USING ERRCODE='54000'; END IF; IF source_row_exists IS NOT TRUE THEN RAISE EXCEPTION 'dependency row missing' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 INSERT INTO internal.formula_row_capability VALUES(txid_current(),tid,rid,cid,p_actor_user_id);
 IF op='remove' THEN replacement:=p_write->'replacement'; EXECUTE format('UPDATE api.%I SET formula_column_ids=array_remove(formula_column_ids,$1), %I=(jsonb_populate_record(NULL::api.%I,$2)).%I WHERE id=$3',t.resource_name,col.field_name,t.resource_name,col.field_name) USING cid,jsonb_build_object(col.field_name,replacement),rid; DELETE FROM api.formula_definitions WHERE id=f.id; result:=jsonb_build_object('removed',true,'formulaId',f.id,'version',f.version);
 ELSE
  IF NOT col.nullable THEN EXECUTE format('ALTER TABLE api.%I ALTER COLUMN %I DROP NOT NULL',t.resource_name,col.field_name); END IF;
  EXECUTE format('UPDATE api.%I SET formula_column_ids=array_append(array_remove(formula_column_ids,$1),$1), %I=NULL WHERE id=$2',t.resource_name,col.field_name) USING cid,rid;
  IF op='create' THEN INSERT INTO api.formula_definitions(workspace_id,record_id,target_table_id,target_row_id,target_column_id,source_expression,template,bindings,engine_expression,syntax_profile,function_profile,literal_profile,engine_version,status,created_by_user_id,updated_by_user_id) VALUES(t.workspace_id,t.record_id,tid,rid,cid,p_write#>>'{artifact,source}',p_write#>'{artifact,template}',p_write#>'{artifact,bindings}',p_write#>>'{artifact,engineExpression}',p_write#>>'{artifact,syntaxProfile}',p_write#>>'{artifact,functionProfile}',p_write#>>'{artifact,literalProfile}',p_write#>>'{artifact,engineVersion}',p_write#>>'{artifact,status}',p_actor_user_id,p_actor_user_id) RETURNING * INTO f;
  ELSE UPDATE api.formula_definitions SET source_expression=p_write#>>'{artifact,source}',template=p_write#>'{artifact,template}',bindings=p_write#>'{artifact,bindings}',engine_expression=p_write#>>'{artifact,engineExpression}',status=p_write#>>'{artifact,status}',version=version+1,updated_at=now(),updated_by_user_id=p_actor_user_id WHERE id=f.id RETURNING * INTO f; DELETE FROM api.formula_dependencies WHERE formula_id=f.id; END IF;
  FOR dep IN SELECT value FROM jsonb_array_elements(p_write#>'{artifact,dependencies}') LOOP INSERT INTO api.formula_dependencies VALUES(f.id,t.workspace_id,t.record_id,(dep->>'tableId')::uuid,(dep->>'rowId')::uuid,(dep->>'columnId')::uuid) ON CONFLICT DO NOTHING; END LOOP; result:=jsonb_build_object('formulaId',f.id,'version',f.version,'status',f.status);
 END IF;
 DELETE FROM internal.formula_row_capability WHERE tx=txid_current();
 PERFORM internal.emit_change_event_as_actor(p_actor_user_id,t.workspace_id,'formula',coalesce(f.id,(result->>'formulaId')::uuid),CASE op WHEN 'create' THEN 'create' WHEN 'remove' THEN 'delete' ELSE 'update' END,t.record_id,r.project_id,jsonb_build_object('tableId',tid,'rowId',rid,'columnId',cid,'formulaVersion',f.version));
 RETURN result||jsonb_build_object('rowVersion',(p_write->>'expectedRowVersion')::bigint+1,'calculationInputRevision',r.calculation_input_revision+1);
END $$;
REVOKE EXECUTE ON FUNCTION internal.apply_trusted_formula_write(text,jsonb) FROM PUBLIC,authenticated,api_client;
GRANT EXECUTE ON FUNCTION internal.apply_trusted_formula_write(text,jsonb) TO formula_writer;
--> statement-breakpoint

-- 7. Update the trusted calculation RPC to accept the new profile fingerprint.
CREATE OR REPLACE FUNCTION internal.apply_trusted_calculation(
 p_actor_user_id text,p_record_id uuid,p_input_revision bigint,p_outcome text,
 p_results jsonb,p_schema_versions jsonb,p_profile_fingerprint text,
 p_runtime_fingerprint text,p_diagnostic text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r api.records; f api.formula_definitions; item jsonb; supplied_count bigint; supplied_distinct bigint; formula_count bigint; expected_schema_versions jsonb; result_status text; result_kind text;
BEGIN
 IF p_outcome NOT IN ('completed','failed') OR jsonb_typeof(p_results)<>'array' OR jsonb_typeof(p_schema_versions)<>'object' OR p_profile_fingerprint<>'fnv1a32-dcfa915f' OR p_runtime_fingerprint !~ '^fnv1a32-[0-9a-f]{8}$' OR length(coalesce(p_diagnostic,''))>500 THEN RAISE EXCEPTION 'invalid calculation result shape' USING ERRCODE='22023'; END IF;
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
