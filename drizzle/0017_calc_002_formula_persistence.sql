-- CALC-002: trusted formula persistence. Formula artifacts are readable
-- scientific metadata, but only the application server's database role may
-- invoke the internal writer or modify their normalized projection.
ALTER TABLE api.records ADD COLUMN calculation_input_revision bigint NOT NULL DEFAULT 0 CHECK (calculation_input_revision >= 0);
--> statement-breakpoint

CREATE TABLE api.formula_definitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
 record_id uuid NOT NULL REFERENCES api.records(id) ON DELETE CASCADE,
 target_table_id uuid NOT NULL REFERENCES api.scientific_tables(id) ON DELETE RESTRICT,
 target_row_id uuid NOT NULL, target_column_id uuid NOT NULL REFERENCES api.scientific_columns(id) ON DELETE RESTRICT,
 source_expression text NOT NULL CHECK(length(source_expression) BETWEEN 1 AND 8192),
 template jsonb NOT NULL CHECK(jsonb_typeof(template)='object'), bindings jsonb NOT NULL CHECK(jsonb_typeof(bindings)='array'),
 engine_expression text NOT NULL, syntax_profile text NOT NULL, function_profile text NOT NULL,
 literal_profile text NOT NULL, engine_version text NOT NULL, status text NOT NULL DEFAULT 'supported',
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by_user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE RESTRICT,
 updated_by_user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE RESTRICT,
 CONSTRAINT uq_formula_stable_target UNIQUE(target_table_id,target_row_id,target_column_id),
 CONSTRAINT chk_formula_status CHECK(status IN ('supported','unsupported')),
 CONSTRAINT chk_formula_profiles CHECK(syntax_profile='sheetbase-hf-en-us-v1' AND function_profile='scientific-core-v1' AND literal_profile='sheetbase-literal-v1' AND engine_version='3.3.0')
);
CREATE INDEX idx_formula_record ON api.formula_definitions(record_id);
CREATE INDEX idx_formula_workspace ON api.formula_definitions(workspace_id);
--> statement-breakpoint
CREATE TABLE api.formula_dependencies (
 formula_id uuid NOT NULL REFERENCES api.formula_definitions(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
 record_id uuid NOT NULL REFERENCES api.records(id) ON DELETE CASCADE,
 source_table_id uuid NOT NULL REFERENCES api.scientific_tables(id) ON DELETE RESTRICT,
 source_row_id uuid NOT NULL, source_column_id uuid NOT NULL REFERENCES api.scientific_columns(id) ON DELETE RESTRICT,
 PRIMARY KEY(formula_id,source_table_id,source_row_id,source_column_id)
);
CREATE INDEX idx_formula_dependency_source ON api.formula_dependencies(source_table_id,source_row_id,source_column_id);
--> statement-breakpoint

-- Every committed schema mutation is one calculation-input mutation.  Keeping
-- this on the catalog row (rather than in five RPC wrappers) also covers table
-- creation and makes preflight returns/failing transactions naturally free.
CREATE FUNCTION internal.scientific_schema_calculation_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.schema_version IS DISTINCT FROM OLD.schema_version THEN
   UPDATE api.records SET calculation_input_revision=calculation_input_revision+1 WHERE id=NEW.record_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION internal.scientific_schema_calculation_revision() FROM PUBLIC,authenticated,api_client;
CREATE TRIGGER scientific_schema_calculation_revision AFTER INSERT OR UPDATE OF schema_version ON api.scientific_tables FOR EACH ROW EXECUTE FUNCTION internal.scientific_schema_calculation_revision();
--> statement-breakpoint

-- Neither a dependency source nor a formula target can disappear or change
-- meaning while the persisted artifact exists.
CREATE FUNCTION internal.protect_formula_source_column() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (NEW.lifecycle IS DISTINCT FROM OLD.lifecycle OR NEW.logical_type IS DISTINCT FROM OLD.logical_type)
    AND (EXISTS (SELECT 1 FROM api.formula_dependencies d WHERE d.source_column_id=OLD.id)
         OR EXISTS (SELECT 1 FROM api.formula_definitions f WHERE f.target_column_id=OLD.id)) THEN
   RAISE EXCEPTION 'column is a persisted formula source or target' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION internal.protect_formula_source_column() FROM PUBLIC,authenticated,api_client;
CREATE TRIGGER protect_formula_source_column BEFORE UPDATE OF lifecycle,logical_type ON api.scientific_columns FOR EACH ROW EXECUTE FUNCTION internal.protect_formula_source_column();
--> statement-breakpoint

ALTER TABLE api.formula_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.formula_dependencies ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON api.formula_definitions,api.formula_dependencies TO authenticated,api_client;
CREATE POLICY formula_member_read ON api.formula_definitions FOR SELECT TO authenticated USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY formula_api_read ON api.formula_definitions FOR SELECT TO api_client USING(workspace_id=api.current_workspace_id() AND internal.scientific_actor(workspace_id,ARRAY['scientific:read']) IS NOT NULL);
CREATE POLICY dependency_member_read ON api.formula_dependencies FOR SELECT TO authenticated USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY dependency_api_read ON api.formula_dependencies FOR SELECT TO api_client USING(workspace_id=api.current_workspace_id() AND internal.scientific_actor(workspace_id,ARRAY['scientific:read']) IS NOT NULL);
REVOKE INSERT,UPDATE,DELETE ON api.formula_definitions,api.formula_dependencies FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint

-- An ungranted capability row is narrower than a session setting: request
-- roles cannot create it and the writer removes it before returning.
CREATE TABLE internal.formula_row_capability(tx bigint PRIMARY KEY,table_id uuid NOT NULL,row_id uuid NOT NULL,column_id uuid NOT NULL,actor_user_id text NOT NULL REFERENCES internal."user"(id));
REVOKE ALL ON internal.formula_row_capability FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint
-- The owner may deliberately assume this NOLOGIN role for one trusted write.
-- It has no table rights and cannot manufacture the trigger capability.
GRANT USAGE ON SCHEMA internal TO formula_writer;
REVOKE ALL ON SCHEMA api FROM formula_writer;
REVOKE ALL ON ALL TABLES IN SCHEMA api,internal FROM formula_writer;
--> statement-breakpoint

CREATE FUNCTION internal.emit_change_event_as_actor(p_actor_user_id text,p_workspace_id uuid,p_entity_type text,p_entity_uuid uuid,p_operation text,p_record_id uuid,p_project_id uuid,p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE seq bigint; eid uuid:=gen_random_uuid();
BEGIN
 IF NOT EXISTS (SELECT 1 FROM internal."user" WHERE id=p_actor_user_id) THEN RAISE EXCEPTION 'validated actor required' USING ERRCODE='42501'; END IF;
 INSERT INTO api.workspace_change_seq(workspace_id,last_seq) VALUES(p_workspace_id,1) ON CONFLICT(workspace_id) DO UPDATE SET last_seq=api.workspace_change_seq.last_seq+1,updated_at=now() RETURNING last_seq INTO seq;
 INSERT INTO api.change_events(id,workspace_id,sequence,entity_type,entity_uuid,operation,record_id,project_id,actor_user_id,payload) VALUES(eid,p_workspace_id,seq,p_entity_type,p_entity_uuid,p_operation,p_record_id,p_project_id,p_actor_user_id,coalesce(p_payload,'{}'));
 PERFORM pg_notify('sheetbase_change',jsonb_build_object('workspace_id',p_workspace_id,'sequence',seq,'id',eid,'entity_type',p_entity_type,'operation',p_operation)::text);
END $$;
REVOKE ALL ON FUNCTION internal.emit_change_event_as_actor(text,uuid,text,uuid,text,uuid,uuid,jsonb) FROM PUBLIC,authenticated,api_client,formula_writer;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.scientific_row_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t api.scientific_tables; c jsonb:=api.claim_probe(); col api.scientific_columns; trusted boolean:=false; trusted_actor text;
BEGIN
 SELECT * INTO t FROM api.scientific_tables WHERE resource_name=TG_TABLE_NAME;
 IF TG_OP<>'INSERT' THEN SELECT true,x.actor_user_id INTO trusted,trusted_actor FROM internal.formula_row_capability x WHERE x.tx=txid_current() AND x.table_id=t.id AND x.row_id=OLD.id; END IF;
 PERFORM internal.assert_scientific_record_writable(t.id);
 IF TG_OP='DELETE' THEN IF cardinality(OLD.formula_column_ids)>0 OR EXISTS(SELECT 1 FROM api.formula_dependencies d WHERE d.source_table_id=t.id AND d.source_row_id=OLD.id) THEN RAISE EXCEPTION 'rows with formula targets or dependencies cannot be deleted' USING ERRCODE='23514'; END IF; UPDATE api.records SET calculation_input_revision=calculation_input_revision+1 WHERE id=t.record_id; RETURN OLD;
 ELSIF TG_OP='INSERT' THEN NEW.workspace_id:=COALESCE(NEW.workspace_id,api.current_workspace_id()); NEW.created_by_user_id:=c->>'sub'; NEW.created_by_credential_id:=NULLIF(c->>'credential_id','')::uuid;
 ELSE IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_by_credential_id IS DISTINCT FROM OLD.created_by_credential_id OR (NEW.formula_column_ids IS DISTINCT FROM OLD.formula_column_ids AND NOT trusted) THEN RAISE EXCEPTION 'reserved row fields are immutable' USING ERRCODE='23514'; END IF; NEW.version:=OLD.version+1; NEW.updated_at:=now(); NEW.updated_by_user_id:=CASE WHEN trusted THEN trusted_actor ELSE c->>'sub' END; NEW.updated_by_credential_id:=CASE WHEN trusted THEN NULL ELSE NULLIF(c->>'credential_id','')::uuid END; END IF;
 IF NEW.workspace_id<>t.workspace_id THEN RAISE EXCEPTION 'generated row workspace mismatch' USING ERRCODE='23514'; END IF;
 FOR col IN SELECT * FROM api.scientific_columns WHERE table_id=t.id LOOP IF col.logical_type='category' AND to_jsonb(NEW)->>col.field_name IS NOT NULL AND (TG_OP='INSERT' OR to_jsonb(NEW)->col.field_name IS DISTINCT FROM to_jsonb(OLD)->col.field_name) AND NOT EXISTS (SELECT 1 FROM api.scientific_category_options o WHERE o.id=(to_jsonb(NEW)->>col.field_name)::uuid AND o.column_id=col.id AND o.workspace_id=t.workspace_id AND o.lifecycle='active') THEN RAISE EXCEPTION 'category option does not belong to active exact column' USING ERRCODE='23514'; END IF; IF col.id=ANY(NEW.formula_column_ids) AND to_jsonb(NEW)->col.field_name <> 'null'::jsonb THEN RAISE EXCEPTION 'formula cells cannot contain literals' USING ERRCODE='23514'; END IF; IF NOT col.nullable AND to_jsonb(NEW)->col.field_name='null'::jsonb AND NOT col.id=ANY(NEW.formula_column_ids) THEN RAISE EXCEPTION 'required scientific column cannot be null' USING ERRCODE='23502'; END IF; END LOOP;
 UPDATE api.records SET calculation_input_revision=calculation_input_revision+1 WHERE id=t.record_id;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION internal.scientific_row_before() FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.scientific_row_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t api.scientific_tables; rid uuid; ver bigint; changed jsonb; actor text;
BEGIN
 SELECT * INTO t FROM api.scientific_tables WHERE resource_name=TG_TABLE_NAME;
 rid:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END; ver:=CASE WHEN TG_OP='DELETE' THEN OLD.version ELSE NEW.version END;
 IF TG_OP='UPDATE' THEN SELECT COALESCE(jsonb_agg(c.id),'[]') INTO changed FROM api.scientific_columns c WHERE c.table_id=t.id AND to_jsonb(OLD)->c.field_name IS DISTINCT FROM to_jsonb(NEW)->c.field_name; ELSE SELECT COALESCE(jsonb_agg(c.id),'[]') INTO changed FROM api.scientific_columns c WHERE c.table_id=t.id AND (CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END)->c.field_name <> 'null'::jsonb; END IF;
 SELECT x.actor_user_id INTO actor FROM internal.formula_row_capability x WHERE x.tx=txid_current() AND x.table_id=t.id AND x.row_id=rid;
 IF actor IS NULL THEN
   PERFORM internal.emit_change_event(t.workspace_id,'scientific_row',rid,CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,t.record_id,NULL,jsonb_build_object('tableId',t.id,'rowId',rid,'version',ver,'changedColumnIds',changed));
 ELSE
   PERFORM internal.emit_change_event_as_actor(actor,t.workspace_id,'scientific_row',rid,CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,t.record_id,NULL,jsonb_build_object('tableId',t.id,'rowId',rid,'version',ver,'changedColumnIds',changed));
 END IF;
 RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION internal.scientific_row_event() FROM PUBLIC,authenticated,api_client,formula_writer;
--> statement-breakpoint

CREATE FUNCTION internal.apply_trusted_formula_write(p_actor_user_id text,p_write jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op text:=p_write->>'operation'; tid uuid; rid uuid; cid uuid; t api.scientific_tables; r api.records; col api.scientific_columns; f api.formula_definitions; dep jsonb; source_t api.scientific_tables; source_c api.scientific_columns; marker uuid[]; replacement jsonb; result jsonb; nrows bigint; ncols bigint; derived jsonb; supplied jsonb; source_row_exists boolean; workspace_status text;
BEGIN
 IF jsonb_typeof(p_write)<>'object' OR op NOT IN ('create','update','remove') OR jsonb_typeof(p_write->'target')<>'object' OR p_write-ARRAY['operation','target','expectedSchemaVersion','expectedRowVersion','expectedFormulaVersion','artifact','replacement'] <> '{}'::jsonb THEN RAISE EXCEPTION 'invalid trusted formula write shape' USING ERRCODE='22023'; END IF;
 tid:=(p_write#>>'{target,tableId}')::uuid; rid:=(p_write#>>'{target,rowId}')::uuid; cid:=(p_write#>>'{target,columnId}')::uuid;
 -- Global schema/formula order: catalog row, generated relation, record, row.
 SELECT * INTO t FROM api.scientific_tables WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'formula target denied' USING ERRCODE='42501'; END IF; SELECT status INTO workspace_status FROM api.workspaces WHERE id=t.workspace_id FOR SHARE; EXECUTE format('LOCK TABLE api.%I IN SHARE ROW EXCLUSIVE MODE',t.resource_name); SELECT * INTO r FROM api.records WHERE id=t.record_id FOR UPDATE;
 IF t.id IS NULL OR t.lifecycle<>'active' OR workspace_status<>'active' OR r.archived_at IS NOT NULL OR r.deleted_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM api.workspace_memberships m WHERE m.workspace_id=t.workspace_id AND m.user_id=p_actor_user_id) THEN RAISE EXCEPTION 'formula target denied' USING ERRCODE='42501'; END IF;
 IF (p_write->>'expectedSchemaVersion')::int IS DISTINCT FROM t.schema_version THEN RAISE EXCEPTION 'schema version mismatch' USING ERRCODE='SB001'; END IF;
 SELECT * INTO col FROM api.scientific_columns WHERE id=cid AND table_id=tid AND workspace_id=t.workspace_id AND lifecycle='active'; IF col.id IS NULL THEN RAISE EXCEPTION 'active target column required' USING ERRCODE='22023'; END IF;
 EXECUTE format('SELECT formula_column_ids,version FROM api.%I WHERE id=$1 FOR UPDATE',t.resource_name) INTO marker,nrows USING rid; IF marker IS NULL THEN RAISE EXCEPTION 'target row missing' USING ERRCODE='P0002'; END IF; IF nrows IS DISTINCT FROM (p_write->>'expectedRowVersion')::bigint THEN RAISE EXCEPTION 'row version mismatch' USING ERRCODE='SB001'; END IF;
 SELECT * INTO f FROM api.formula_definitions WHERE target_table_id=tid AND target_row_id=rid AND target_column_id=cid FOR UPDATE;
 IF op='create' AND f.id IS NOT NULL OR op IN ('update','remove') AND (f.id IS NULL OR f.version IS DISTINCT FROM (p_write->>'expectedFormulaVersion')::bigint) THEN RAISE EXCEPTION 'formula version mismatch' USING ERRCODE='SB001'; END IF;
 IF op<>'remove' THEN
  IF jsonb_typeof(p_write->'artifact')<>'object' OR (p_write->'artifact')-ARRAY['version','syntaxProfile','functionProfile','literalProfile','engineVersion','status','source','template','bindings','engineExpression','dependencies'] <> '{}'::jsonb OR (p_write#>>'{artifact,version}')::int<>1 OR p_write#>>'{artifact,syntaxProfile}'<>'sheetbase-hf-en-us-v1' OR p_write#>>'{artifact,functionProfile}'<>'scientific-core-v1' OR p_write#>>'{artifact,literalProfile}'<>'sheetbase-literal-v1' OR p_write#>>'{artifact,engineVersion}'<>'3.3.0' OR jsonb_typeof(p_write#>'{artifact,template}')<>'object' OR jsonb_typeof(p_write#>'{artifact,bindings}')<>'array' OR jsonb_typeof(p_write#>'{artifact,dependencies}')<>'array' THEN RAISE EXCEPTION 'unknown or invalid formula artifact' USING ERRCODE='22023'; END IF;
  -- Derive the normalized set from both cell bindings and every nested range
  -- member.  The caller's projection must be exactly equal (order/duplicates
  -- are immaterial), so dependencies can never be omitted or invented.
  WITH cells AS (
    SELECT b#>'{cell}' AS cell FROM jsonb_array_elements(p_write#>'{artifact,bindings}') b WHERE b->>'kind'='cell'
    UNION ALL
    SELECT cell FROM jsonb_array_elements(p_write#>'{artifact,bindings}') b
      CROSS JOIN LATERAL jsonb_array_elements(b->'members') member_row
      CROSS JOIN LATERAL jsonb_array_elements(member_row) cell WHERE b->>'kind'='range'
  ) SELECT coalesce(jsonb_agg(x ORDER BY x->>'rowId',x->>'columnId'),'[]'::jsonb) INTO derived
    FROM (SELECT DISTINCT jsonb_build_object('tableId',tid,'rowId',cell->>'rowId','columnId',cell->>'columnId') x FROM cells) q;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'rowId',x->>'columnId'),'[]'::jsonb) INTO supplied
    FROM (SELECT DISTINCT value x FROM jsonb_array_elements(p_write#>'{artifact,dependencies}')) q;
  IF derived IS DISTINCT FROM supplied THEN RAISE EXCEPTION 'dependencies must exactly match formula bindings' USING ERRCODE='23514'; END IF;
  EXECUTE format('SELECT count(*) FROM api.%I',t.resource_name) INTO nrows; SELECT count(*) INTO ncols FROM api.scientific_columns WHERE table_id=tid AND lifecycle='active'; IF nrows>10000 OR ncols>256 THEN RAISE EXCEPTION 'formula calculation limits exceeded' USING ERRCODE='54000'; END IF;
  FOR dep IN SELECT value FROM jsonb_array_elements(p_write#>'{artifact,dependencies}') LOOP IF jsonb_typeof(dep)<>'object' OR dep-ARRAY['tableId','rowId','columnId']<>'{}'::jsonb OR dep->>'tableId'<>tid::text THEN RAISE EXCEPTION 'invalid or cross-table dependency' USING ERRCODE='23514'; END IF; SELECT * INTO source_t FROM api.scientific_tables WHERE id=(dep->>'tableId')::uuid AND workspace_id=t.workspace_id AND record_id=t.record_id AND lifecycle='active'; SELECT * INTO source_c FROM api.scientific_columns WHERE id=(dep->>'columnId')::uuid AND table_id=source_t.id AND lifecycle='active'; IF source_t.id IS NULL OR source_c.id IS NULL THEN RAISE EXCEPTION 'active same-table dependency required' USING ERRCODE='23514'; END IF; EXECUTE format('SELECT EXISTS(SELECT 1 FROM api.%I WHERE id=$1)',source_t.resource_name) INTO source_row_exists USING (dep->>'rowId')::uuid; IF source_row_exists IS NOT TRUE THEN RAISE EXCEPTION 'dependency row missing' USING ERRCODE='23514'; END IF; END LOOP;
 END IF;
 INSERT INTO internal.formula_row_capability VALUES(txid_current(),tid,rid,cid,p_actor_user_id);
 IF op='remove' THEN replacement:=p_write->'replacement'; EXECUTE format('UPDATE api.%I SET formula_column_ids=array_remove(formula_column_ids,$1), %I=(jsonb_populate_record(NULL::api.%I,$2)).%I WHERE id=$3',t.resource_name,col.field_name,t.resource_name,col.field_name) USING cid,jsonb_build_object(col.field_name,replacement),rid; DELETE FROM api.formula_definitions WHERE id=f.id; result:=jsonb_build_object('removed',true,'formulaId',f.id,'version',f.version);
 ELSE
  -- Physical nullability must allow an owned formula cell; the row trigger
  -- continues to enforce required literals for all ordinary writes.
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
NOTIFY pgrst,'reload schema';
