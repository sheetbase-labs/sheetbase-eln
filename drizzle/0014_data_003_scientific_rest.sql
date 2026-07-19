-- DATA-003: the database-authoritative REST surface for scientific sheets.
ALTER TABLE internal.api_credentials DROP CONSTRAINT chk_api_credentials_scopes;
ALTER TABLE internal.api_credentials ADD CONSTRAINT chk_api_credentials_scopes CHECK
 (scopes <@ ARRAY['projects:read','projects:write','scientific:read','scientific:write','scientific:schema']::text[]);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.scientific_actor(p_workspace uuid, p_scopes text[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path='' AS $$
DECLARE c jsonb; role_name text; uid text; cid uuid; claimed uuid; scopes jsonb;
BEGIN
 BEGIN c:=api.claim_probe(); role_name:=c->>'role'; claimed:=(c->>'workspace_id')::uuid; uid:=nullif(c->>'sub',''); cid:=nullif(c->>'credential_id','')::uuid; scopes:=c->'scopes';
 EXCEPTION WHEN others THEN RAISE EXCEPTION 'scientific actor denied' USING ERRCODE='42501'; END;
 IF c IS NULL OR claimed IS DISTINCT FROM p_workspace THEN RAISE EXCEPTION 'scientific actor denied' USING ERRCODE='42501'; END IF;
 IF role_name='authenticated' AND uid IS NOT NULL AND cid IS NULL AND api.is_workspace_member(p_workspace) THEN
   RETURN jsonb_build_object('kind','browser','user_id',uid,'credential_id',NULL);
 END IF;
 IF role_name='api_client' AND uid IS NULL AND cid IS NOT NULL AND jsonb_typeof(scopes)='array'
    AND NOT EXISTS (SELECT 1 FROM unnest(p_scopes) required WHERE NOT scopes ? required) THEN
   RETURN jsonb_build_object('kind','api_client','user_id',NULL,'credential_id',cid);
 END IF;
 RAISE EXCEPTION 'scientific actor denied' USING ERRCODE='42501';
END $$;
REVOKE EXECUTE ON FUNCTION internal.scientific_actor(uuid,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION internal.scientific_actor(uuid,text[]) TO authenticated,api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.assert_scientific_actor(p_workspace uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT internal.scientific_actor(p_workspace,ARRAY['scientific:schema']) $$;
REVOKE EXECUTE ON FUNCTION internal.assert_scientific_actor(uuid) FROM PUBLIC;
--> statement-breakpoint

GRANT SELECT ON api.scientific_tables,api.scientific_columns,api.scientific_category_options TO api_client;
CREATE POLICY scientific_tables_api_read ON api.scientific_tables FOR SELECT TO api_client
 USING (workspace_id=api.current_workspace_id() AND (internal.scientific_actor(api.current_workspace_id(),ARRAY['scientific:read'])) IS NOT NULL);
CREATE POLICY scientific_columns_api_read ON api.scientific_columns FOR SELECT TO api_client
 USING (workspace_id=api.current_workspace_id() AND (internal.scientific_actor(api.current_workspace_id(),ARRAY['scientific:read'])) IS NOT NULL);
CREATE POLICY scientific_options_api_read ON api.scientific_category_options FOR SELECT TO api_client
 USING (workspace_id=api.current_workspace_id() AND (internal.scientific_actor(api.current_workspace_id(),ARRAY['scientific:read'])) IS NOT NULL);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.configure_scientific_relation(p_table_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t api.scientific_tables; fields text; field_name text;
BEGIN
 SELECT * INTO t FROM api.scientific_tables WHERE id=p_table_id;
 IF t.id IS NULL OR t.resource_name !~ '^sheet_[a-z2-7]{26}$' OR to_regclass(format('api.%I',t.resource_name)) IS NULL THEN RETURN; END IF;
 EXECUTE format('ALTER TABLE api.%I ENABLE ROW LEVEL SECURITY',t.resource_name);
 EXECUTE format('DROP POLICY IF EXISTS scientific_rows_member ON api.%I',t.resource_name);
 FOREACH fields IN ARRAY ARRAY['scientific_browser_select','scientific_browser_insert','scientific_browser_update','scientific_browser_delete','scientific_api_select','scientific_api_insert','scientific_api_update','scientific_api_delete'] LOOP
   EXECUTE format('DROP POLICY IF EXISTS %I ON api.%I',fields,t.resource_name);
 END LOOP;
 EXECUTE format('CREATE POLICY scientific_browser_select ON api.%I FOR SELECT TO authenticated USING (workspace_id=%L::uuid AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id))',t.resource_name,t.workspace_id);
 EXECUTE format('CREATE POLICY scientific_browser_insert ON api.%I FOR INSERT TO authenticated WITH CHECK (workspace_id=%L::uuid AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id))',t.resource_name,t.workspace_id);
 EXECUTE format('CREATE POLICY scientific_browser_update ON api.%I FOR UPDATE TO authenticated USING (workspace_id=%L::uuid AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id)) WITH CHECK (workspace_id=%L::uuid AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id))',t.resource_name,t.workspace_id,t.workspace_id);
 EXECUTE format('CREATE POLICY scientific_browser_delete ON api.%I FOR DELETE TO authenticated USING (workspace_id=%L::uuid AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id))',t.resource_name,t.workspace_id);
 EXECUTE format('CREATE POLICY scientific_api_select ON api.%I FOR SELECT TO api_client USING (workspace_id=%L::uuid AND workspace_id=api.current_workspace_id() AND internal.scientific_actor(%L::uuid,ARRAY[''scientific:read'']) IS NOT NULL)',t.resource_name,t.workspace_id,t.workspace_id);
 EXECUTE format('CREATE POLICY scientific_api_insert ON api.%I FOR INSERT TO api_client WITH CHECK (workspace_id=%L::uuid AND workspace_id=api.current_workspace_id() AND internal.scientific_actor(%L::uuid,ARRAY[''scientific:write'']) IS NOT NULL)',t.resource_name,t.workspace_id,t.workspace_id);
 EXECUTE format('CREATE POLICY scientific_api_update ON api.%I FOR UPDATE TO api_client USING (workspace_id=%L::uuid AND workspace_id=api.current_workspace_id() AND internal.scientific_actor(%L::uuid,ARRAY[''scientific:read'',''scientific:write'']) IS NOT NULL) WITH CHECK (workspace_id=%L::uuid AND workspace_id=api.current_workspace_id() AND internal.scientific_actor(%L::uuid,ARRAY[''scientific:read'',''scientific:write'']) IS NOT NULL)',t.resource_name,t.workspace_id,t.workspace_id,t.workspace_id,t.workspace_id);
 EXECUTE format('CREATE POLICY scientific_api_delete ON api.%I FOR DELETE TO api_client USING (workspace_id=%L::uuid AND workspace_id=api.current_workspace_id() AND internal.scientific_actor(%L::uuid,ARRAY[''scientific:read'',''scientific:write'']) IS NOT NULL)',t.resource_name,t.workspace_id,t.workspace_id);
 EXECUTE format('GRANT SELECT,DELETE ON api.%I TO authenticated,api_client',t.resource_name);
 EXECUTE format('REVOKE INSERT,UPDATE ON api.%I FROM authenticated,api_client',t.resource_name);
 FOR field_name IN SELECT c.field_name FROM api.scientific_columns c WHERE c.table_id=t.id LOOP
   EXECUTE format('REVOKE INSERT (%I),UPDATE (%I) ON api.%I FROM authenticated,api_client',field_name,field_name,t.resource_name);
 END LOOP;
 SELECT string_agg(format('%I',c.field_name),',') INTO fields FROM api.scientific_columns c WHERE c.table_id=t.id AND c.lifecycle='active';
 IF fields IS NOT NULL THEN EXECUTE format('GRANT INSERT (%s),UPDATE (%s) ON api.%I TO authenticated,api_client',fields,fields,t.resource_name); END IF;
END $$;
REVOKE EXECUTE ON FUNCTION internal.configure_scientific_relation(uuid) FROM PUBLIC;
--> statement-breakpoint

DO $$ DECLARE t uuid; BEGIN FOR t IN SELECT id FROM api.scientific_tables LOOP PERFORM internal.configure_scientific_relation(t); END LOOP; END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.scientific_column_regrant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM internal.configure_scientific_relation(coalesce(NEW.table_id,OLD.table_id)); RETURN coalesce(NEW,OLD); END $$;
CREATE CONSTRAINT TRIGGER scientific_column_regrant AFTER INSERT OR UPDATE OR DELETE ON api.scientific_columns DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION internal.scientific_column_regrant();
CREATE OR REPLACE FUNCTION internal.scientific_table_regrant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM internal.configure_scientific_relation(NEW.id); RETURN NEW; END $$;
CREATE CONSTRAINT TRIGGER scientific_table_regrant AFTER INSERT ON api.scientific_tables DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION internal.scientific_table_regrant();
--> statement-breakpoint

-- Put DATA-002's definer implementations behind DATA-003 wrappers. The
-- wrappers constrain their first lookup to the claimed workspace and check
-- the exact schema scope before an implementation can reveal lifecycle,
-- version, or preflight evidence for a foreign object.
ALTER FUNCTION api.create_scientific_table(uuid,text,jsonb,text) SET SCHEMA internal;
ALTER FUNCTION internal.create_scientific_table(uuid,text,jsonb,text) RENAME TO create_scientific_table_impl;
ALTER FUNCTION api.add_scientific_column(uuid,int,text,text,boolean,jsonb,jsonb,jsonb,jsonb) SET SCHEMA internal;
ALTER FUNCTION internal.add_scientific_column(uuid,int,text,text,boolean,jsonb,jsonb,jsonb,jsonb) RENAME TO add_scientific_column_impl;
ALTER FUNCTION api.update_scientific_column_display(uuid,int,text,int) SET SCHEMA internal;
ALTER FUNCTION internal.update_scientific_column_display(uuid,int,text,int) RENAME TO update_scientific_column_display_impl;
ALTER FUNCTION api.retire_scientific_column(uuid,int,text) SET SCHEMA internal;
ALTER FUNCTION internal.retire_scientific_column(uuid,int,text) RENAME TO retire_scientific_column_impl;
ALTER FUNCTION api.convert_scientific_column(uuid,int,text,text) SET SCHEMA internal;
ALTER FUNCTION internal.convert_scientific_column(uuid,int,text,text) RENAME TO convert_scientific_column_impl;

REVOKE EXECUTE ON FUNCTION internal.create_scientific_table_impl(uuid,text,jsonb,text),internal.add_scientific_column_impl(uuid,int,text,text,boolean,jsonb,jsonb,jsonb,jsonb),internal.update_scientific_column_display_impl(uuid,int,text,int),internal.retire_scientific_column_impl(uuid,int,text),internal.convert_scientific_column_impl(uuid,int,text,text) FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.scientific_claimed_workspace() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path='' AS $$
DECLARE result uuid;
BEGIN
 BEGIN result:=nullif(api.claim_probe()->>'workspace_id','')::uuid;
 EXCEPTION WHEN others THEN RAISE EXCEPTION 'scientific actor denied' USING ERRCODE='42501'; END;
 IF result IS NULL THEN RAISE EXCEPTION 'scientific actor denied' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION internal.scientific_claimed_workspace() FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION api.create_scientific_table(p_block_id uuid,p_name text,p_columns jsonb DEFAULT '[]',p_description text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ws uuid:=internal.scientific_claimed_workspace(); result jsonb;
BEGIN
 SELECT r.workspace_id INTO ws FROM api.blocks b JOIN api.records r ON r.id=b.record_id WHERE b.id=p_block_id AND r.workspace_id=ws;
 IF ws IS NULL THEN RAISE EXCEPTION 'scientific object denied' USING ERRCODE='42501'; END IF;
 PERFORM internal.scientific_actor(ws,ARRAY['scientific:schema']);
 result:=internal.create_scientific_table_impl(p_block_id,p_name,p_columns,p_description);
 RETURN result||jsonb_build_object('resourceName',result#>>'{table,resource_name}');
END $$;

CREATE FUNCTION api.add_scientific_column(p_table_id uuid,p_expected_schema_version int,p_label text,p_logical_type text,p_nullable boolean DEFAULT true,p_default jsonb DEFAULT NULL,p_unit jsonb DEFAULT NULL,p_validation jsonb DEFAULT '{}',p_options jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ws uuid:=internal.scientific_claimed_workspace(); resource text; result jsonb; actor jsonb;
BEGIN
 SELECT workspace_id,resource_name INTO ws,resource FROM api.scientific_tables WHERE id=p_table_id AND workspace_id=ws;
 IF ws IS NULL THEN RAISE EXCEPTION 'scientific object denied' USING ERRCODE='42501'; END IF;
 actor:=internal.scientific_actor(ws,ARRAY['scientific:schema']);
 IF p_expected_schema_version IS NULL THEN RAISE EXCEPTION 'expected schema version is required' USING ERRCODE='22023'; END IF;
 result:=internal.add_scientific_column_impl(p_table_id,p_expected_schema_version,p_label,p_logical_type,p_nullable,p_default,p_unit,p_validation,p_options);
 UPDATE api.scientific_tables SET updated_by_user_id=actor->>'user_id',updated_by_credential_id=(actor->>'credential_id')::uuid,updated_at=now() WHERE id=p_table_id;
 RETURN result||jsonb_build_object('resourceName',resource,'fieldName',result->>'field_name');
END $$;

CREATE FUNCTION api.update_scientific_column_display(p_column_id uuid,p_expected_schema_version int,p_label text DEFAULT NULL,p_display_order int DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ws uuid:=internal.scientific_claimed_workspace(); table_id uuid; resource text; result jsonb; actor jsonb;
BEGIN
 SELECT t.workspace_id,t.id,t.resource_name INTO ws,table_id,resource FROM api.scientific_columns c JOIN api.scientific_tables t ON t.id=c.table_id WHERE c.id=p_column_id AND t.workspace_id=ws;
 IF ws IS NULL THEN RAISE EXCEPTION 'scientific object denied' USING ERRCODE='42501'; END IF;
 actor:=internal.scientific_actor(ws,ARRAY['scientific:schema']);
 IF p_expected_schema_version IS NULL THEN RAISE EXCEPTION 'expected schema version is required' USING ERRCODE='22023'; END IF;
 result:=internal.update_scientific_column_display_impl(p_column_id,p_expected_schema_version,p_label,p_display_order);
 UPDATE api.scientific_tables SET updated_by_user_id=actor->>'user_id',updated_by_credential_id=(actor->>'credential_id')::uuid,updated_at=now() WHERE id=table_id;
 RETURN result||jsonb_build_object('resourceName',resource,'fieldName',result->>'field_name');
END $$;

CREATE FUNCTION api.retire_scientific_column(p_column_id uuid,p_expected_schema_version int,p_confirmation_hash text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ws uuid:=internal.scientific_claimed_workspace(); table_id uuid; resource text; field text; result jsonb; actor jsonb;
BEGIN
 SELECT t.workspace_id,t.id,t.resource_name,c.field_name INTO ws,table_id,resource,field FROM api.scientific_columns c JOIN api.scientific_tables t ON t.id=c.table_id WHERE c.id=p_column_id AND t.workspace_id=ws;
 IF ws IS NULL THEN RAISE EXCEPTION 'scientific object denied' USING ERRCODE='42501'; END IF;
 actor:=internal.scientific_actor(ws,ARRAY['scientific:schema']);
 IF p_expected_schema_version IS NULL THEN RAISE EXCEPTION 'expected schema version is required' USING ERRCODE='22023'; END IF;
 result:=internal.retire_scientific_column_impl(p_column_id,p_expected_schema_version,p_confirmation_hash);
 IF (result->>'retired')::boolean IS TRUE THEN UPDATE api.scientific_tables SET updated_by_user_id=actor->>'user_id',updated_by_credential_id=(actor->>'credential_id')::uuid,updated_at=now() WHERE id=table_id; END IF;
 RETURN result||jsonb_build_object('resourceName',resource,'fieldName',field);
END $$;

CREATE FUNCTION api.convert_scientific_column(p_column_id uuid,p_expected_schema_version int,p_new_logical_type text,p_confirmation_hash text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ws uuid:=internal.scientific_claimed_workspace(); table_id uuid; resource text; field text; result jsonb; actor jsonb;
BEGIN
 SELECT t.workspace_id,t.id,t.resource_name,c.field_name INTO ws,table_id,resource,field FROM api.scientific_columns c JOIN api.scientific_tables t ON t.id=c.table_id WHERE c.id=p_column_id AND t.workspace_id=ws;
 IF ws IS NULL THEN RAISE EXCEPTION 'scientific object denied' USING ERRCODE='42501'; END IF;
 actor:=internal.scientific_actor(ws,ARRAY['scientific:schema']);
 IF p_expected_schema_version IS NULL THEN RAISE EXCEPTION 'expected schema version is required' USING ERRCODE='22023'; END IF;
 result:=internal.convert_scientific_column_impl(p_column_id,p_expected_schema_version,p_new_logical_type,p_confirmation_hash);
 IF (result->>'converted')::boolean IS TRUE THEN UPDATE api.scientific_tables SET updated_by_user_id=actor->>'user_id',updated_by_credential_id=(actor->>'credential_id')::uuid,updated_at=now() WHERE id=table_id; END IF;
 RETURN result||jsonb_build_object('resourceName',resource,'fieldName',field);
END $$;

REVOKE EXECUTE ON FUNCTION api.create_scientific_table(uuid,text,jsonb,text),api.add_scientific_column(uuid,int,text,text,boolean,jsonb,jsonb,jsonb,jsonb),api.update_scientific_column_display(uuid,int,text,int),api.retire_scientific_column(uuid,int,text),api.convert_scientific_column(uuid,int,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.create_scientific_table(uuid,text,jsonb,text),api.add_scientific_column(uuid,int,text,text,boolean,jsonb,jsonb,jsonb,jsonb),api.update_scientific_column_display(uuid,int,text,int),api.retire_scientific_column(uuid,int,text),api.convert_scientific_column(uuid,int,text,text) TO authenticated,api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.scientific_table_metadata(p_table_id uuid DEFAULT NULL) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT to_jsonb(t) || jsonb_build_object(
  'columns',coalesce((SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('options',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.display_order) FROM api.scientific_category_options o WHERE o.column_id=c.id AND o.lifecycle='active'),'[]'::jsonb)) ORDER BY c.display_order) FROM api.scientific_columns c WHERE c.table_id=t.id AND c.lifecycle='active'),'[]'::jsonb),
  'relationships','[]'::jsonb)
 FROM api.scientific_tables t WHERE t.lifecycle='active' AND (p_table_id IS NULL OR t.id=p_table_id) ORDER BY t.created_at,t.id
$$;
REVOKE EXECUTE ON FUNCTION api.scientific_table_metadata(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.scientific_table_metadata(uuid) TO authenticated,api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.apply_scientific_row_edits(p_table_id uuid,p_expected_schema_version int,p_edits jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t api.scientific_tables; e jsonb; rid uuid; colid text; c api.scientific_columns; physical jsonb; sets text; rows jsonb:='[]'; one jsonb; errors jsonb:='[]'; err_row uuid; err_col uuid; formula_owned boolean; row_version bigint;
BEGIN
 -- Workspace is constrained in the first metadata lookup, before lifecycle/version is observable.
 BEGIN SELECT * INTO t FROM api.scientific_tables WHERE id=p_table_id AND workspace_id=(api.claim_probe()->>'workspace_id')::uuid FOR UPDATE; EXCEPTION WHEN others THEN RAISE EXCEPTION 'scientific table denied' USING ERRCODE='42501'; END;
 IF t.id IS NULL THEN RAISE EXCEPTION 'scientific table denied' USING ERRCODE='42501'; END IF;
 PERFORM internal.scientific_actor(t.workspace_id,ARRAY['scientific:read','scientific:write']);
 IF t.lifecycle<>'active' THEN RAISE EXCEPTION 'active table required' USING ERRCODE='22023'; END IF;
 IF p_expected_schema_version IS NULL THEN RAISE EXCEPTION 'expected schema version is required' USING ERRCODE='22023'; END IF;
 IF t.schema_version IS DISTINCT FROM p_expected_schema_version THEN RAISE EXCEPTION 'schema version mismatch' USING ERRCODE='SB001'; END IF;
 IF jsonb_typeof(p_edits) IS DISTINCT FROM 'array' OR jsonb_array_length(p_edits)=0 THEN RAISE EXCEPTION 'edits must be a non-empty array' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_edits) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR NOT (x ?& ARRAY['rowId','expectedVersion','values']) OR x-ARRAY['rowId','expectedVersion','values']<>'{}' OR jsonb_typeof(x->'rowId') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'expectedVersion') IS DISTINCT FROM 'number' OR coalesce((x->>'expectedVersion') ~ '^[1-9][0-9]*$',false) IS NOT TRUE OR jsonb_typeof(x->'values') IS DISTINCT FROM 'object' OR x->'values'='{}') THEN RAISE EXCEPTION 'invalid edit shape' USING ERRCODE='22023'; END IF;
 BEGIN
  IF EXISTS(SELECT 1 FROM (SELECT (x->>'rowId')::uuid id,count(*) FROM jsonb_array_elements(p_edits)x GROUP BY 1 HAVING count(*)>1)s) THEN RAISE EXCEPTION 'duplicate row id' USING ERRCODE='22023'; END IF;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid row id' USING ERRCODE='22023'; END;
 -- Validate every stable column id and formula marker before touching data.
 FOR e IN SELECT value FROM jsonb_array_elements(p_edits) LOOP
  rid:=(e->>'rowId')::uuid;
  FOR colid IN SELECT key FROM jsonb_each(e->'values') LOOP
   BEGIN SELECT * INTO c FROM api.scientific_columns WHERE id=colid::uuid AND table_id=t.id AND workspace_id=t.workspace_id AND lifecycle='active'; EXCEPTION WHEN invalid_text_representation THEN c:=NULL; END;
   IF c.id IS NULL THEN RAISE EXCEPTION 'unknown scientific column' USING ERRCODE='22023'; END IF;
   EXECUTE format('SELECT %L::uuid=ANY(formula_column_ids) FROM api.%I WHERE id=$1',c.id,t.resource_name) INTO formula_owned USING rid;
   IF formula_owned THEN RAISE EXCEPTION 'formula-owned target' USING ERRCODE='23514'; END IF;
  END LOOP;
 END LOOP;
 -- Deterministic locks, then existence/version checks for the entire batch.
 EXECUTE format('SELECT to_jsonb(id) FROM api.%I WHERE id=ANY($1) ORDER BY id FOR UPDATE',t.resource_name) INTO one USING ARRAY(SELECT (x->>'rowId')::uuid FROM jsonb_array_elements(p_edits)x ORDER BY 1);
 FOR e IN SELECT value FROM jsonb_array_elements(p_edits) LOOP
  rid:=(e->>'rowId')::uuid; EXECUTE format('SELECT version FROM api.%I WHERE id=$1',t.resource_name) INTO row_version USING rid;
  IF row_version IS NULL THEN RAISE EXCEPTION 'scientific row missing' USING ERRCODE='P0002'; END IF;
  IF row_version IS DISTINCT FROM (e->>'expectedVersion')::bigint THEN RAISE EXCEPTION 'row version mismatch' USING ERRCODE='SB001'; END IF;
 END LOOP;

 -- Probe each cell in an exception subtransaction. A successful probe raises
 -- SB099 deliberately so the UPDATE (including its trigger/event) rolls back;
 -- validation failures are accumulated without changing any row.
 FOR e IN SELECT value FROM jsonb_array_elements(p_edits) WITH ORDINALITY ORDER BY ordinality LOOP
  rid:=(e->>'rowId')::uuid;
  FOR colid IN SELECT key FROM jsonb_each(e->'values') LOOP
   SELECT * INTO c FROM api.scientific_columns WHERE id=colid::uuid AND table_id=t.id;
   err_row:=rid; err_col:=c.id;
   BEGIN
    physical:=jsonb_build_object(c.field_name,e->'values'->colid);
    EXECUTE format('UPDATE api.%I SET %I=(jsonb_populate_record(NULL::api.%I,$1)).%I WHERE id=$2',t.resource_name,c.field_name,t.resource_name,c.field_name) USING physical,rid;
    RAISE EXCEPTION 'validation probe rollback' USING ERRCODE='SB099';
   EXCEPTION WHEN SQLSTATE 'SB099' THEN NULL;
   WHEN data_exception OR integrity_constraint_violation THEN
    errors:=errors||jsonb_build_array(jsonb_build_object('rowId',err_row,'columnId',err_col,'code','invalid_value','message','The value violates its column type or validation.'));
   END;
  END LOOP;
 END LOOP;
 IF jsonb_array_length(errors)>0 THEN RETURN jsonb_build_object('ok',false,'errors',errors); END IF;

 BEGIN
  FOR e IN SELECT value FROM jsonb_array_elements(p_edits) WITH ORDINALITY ORDER BY ordinality LOOP
   rid:=(e->>'rowId')::uuid; err_row:=rid; physical:='{}'; sets:=NULL;
   FOR colid IN SELECT key FROM jsonb_each(e->'values') LOOP SELECT * INTO c FROM api.scientific_columns WHERE id=colid::uuid; physical:=physical||jsonb_build_object(c.field_name,e->'values'->colid); sets:=concat_ws(',',sets,format('%I=(jsonb_populate_record(NULL::api.%I,$1)).%I',c.field_name,t.resource_name,c.field_name)); END LOOP;
   EXECUTE format('UPDATE api.%I SET %s WHERE id=$2 RETURNING to_jsonb(%I.*)',t.resource_name,sets,t.resource_name) INTO one USING physical,rid; rows:=rows||jsonb_build_array(one);
  END LOOP;
 EXCEPTION WHEN data_exception OR integrity_constraint_violation THEN
  RETURN jsonb_build_object('ok',false,'errors',jsonb_build_array(jsonb_build_object('rowId',err_row,'columnId',err_col,'code','invalid_value','message','A cell value violates its column type or validation.')));
 END;
 RETURN jsonb_build_object('ok',true,'schemaVersion',t.schema_version,'rows',rows);
END $$;
REVOKE EXECUTE ON FUNCTION api.apply_scientific_row_edits(uuid,int,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.apply_scientific_row_edits(uuid,int,jsonb) TO authenticated,api_client;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION api.create_scientific_table(uuid,text,jsonb,text),api.add_scientific_column(uuid,int,text,text,boolean,jsonb,jsonb,jsonb,jsonb),api.update_scientific_column_display(uuid,int,text,int),api.retire_scientific_column(uuid,int,text),api.convert_scientific_column(uuid,int,text,text) TO api_client;
NOTIFY pgrst,'reload schema';
