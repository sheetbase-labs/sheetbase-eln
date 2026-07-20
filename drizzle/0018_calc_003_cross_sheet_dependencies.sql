-- CALC-003: cross-sheet references remain inside one notebook. Formula writes
-- conservatively lock every active sheet in the notebook in stable order so
-- source-row deletion, schema evolution and opposite-direction writes cannot
-- race dependency validation or deadlock.
CREATE OR REPLACE FUNCTION internal.apply_trusted_formula_write(p_actor_user_id text,p_write jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op text:=p_write->>'operation'; tid uuid; rid uuid; cid uuid; t api.scientific_tables; r api.records; col api.scientific_columns; f api.formula_definitions; dep jsonb; source_t api.scientific_tables; source_c api.scientific_columns; marker uuid[]; replacement jsonb; result jsonb; nrows bigint; ncols bigint; derived jsonb; supplied jsonb; source_row_exists boolean; workspace_status text; notebook_record_id uuid;
BEGIN
 IF jsonb_typeof(p_write)<>'object' OR op NOT IN ('create','update','remove') OR jsonb_typeof(p_write->'target')<>'object' OR p_write-ARRAY['operation','target','expectedSchemaVersion','expectedRowVersion','expectedFormulaVersion','artifact','replacement'] <> '{}'::jsonb THEN RAISE EXCEPTION 'invalid trusted formula write shape' USING ERRCODE='22023'; END IF;
 tid:=(p_write#>>'{target,tableId}')::uuid; rid:=(p_write#>>'{target,rowId}')::uuid; cid:=(p_write#>>'{target,columnId}')::uuid;
 SELECT st.record_id INTO notebook_record_id FROM api.scientific_tables st WHERE st.id=tid; IF notebook_record_id IS NULL THEN RAISE EXCEPTION 'formula target denied' USING ERRCODE='42501'; END IF;
 -- Catalogs first, then generated relations, both in stable order. Locking the
 -- notebook's complete active sheet set is intentionally conservative for the
 -- single-user alpha and makes cross-sheet source validation race-free.
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
  IF jsonb_typeof(p_write->'artifact')<>'object' OR (p_write->'artifact')-ARRAY['version','syntaxProfile','functionProfile','literalProfile','engineVersion','status','source','template','bindings','engineExpression','dependencies'] <> '{}'::jsonb OR (p_write#>>'{artifact,version}')::int<>1 OR p_write#>>'{artifact,syntaxProfile}'<>'sheetbase-hf-en-us-v1' OR p_write#>>'{artifact,functionProfile}'<>'scientific-core-v1' OR p_write#>>'{artifact,literalProfile}'<>'sheetbase-literal-v1' OR p_write#>>'{artifact,engineVersion}'<>'3.3.0' OR jsonb_typeof(p_write#>'{artifact,template}')<>'object' OR jsonb_typeof(p_write#>'{artifact,bindings}')<>'array' OR jsonb_typeof(p_write#>'{artifact,dependencies}')<>'array' THEN RAISE EXCEPTION 'unknown or invalid formula artifact' USING ERRCODE='22023'; END IF;
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

CREATE OR REPLACE FUNCTION internal.explain_sheet_block_dependency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE table_id uuid; affected bigint;
BEGIN
 IF OLD.type<>'sheet' THEN RETURN OLD; END IF;
 SELECT id INTO table_id FROM api.scientific_tables WHERE block_id=OLD.id;
 SELECT count(DISTINCT formula_id) INTO affected FROM (
   SELECT f.id formula_id FROM api.formula_definitions f WHERE f.target_table_id=table_id
   UNION ALL SELECT d.formula_id FROM api.formula_dependencies d WHERE d.source_table_id=table_id
 ) x;
 IF affected>0 THEN RAISE EXCEPTION 'sheet is used by % persisted formula(s); inspect dependencies and remove those formulas first',affected USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
REVOKE EXECUTE ON FUNCTION internal.explain_sheet_block_dependency() FROM PUBLIC,authenticated,api_client,formula_writer;
CREATE TRIGGER explain_sheet_block_dependency BEFORE DELETE ON api.blocks FOR EACH ROW EXECUTE FUNCTION internal.explain_sheet_block_dependency();
--> statement-breakpoint
NOTIFY pgrst,'reload schema';
