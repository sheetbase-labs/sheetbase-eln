-- SHEET-002: browser-only atomic creation of an owning sheet block and its
-- scientific table. Calling api.insert_block retains its ordering and
-- structure-version contract; any subsequent failure rolls the whole call
-- (including the generated relation) back transactionally.
CREATE FUNCTION api.insert_sheet_block(
  p_record_id uuid,
  p_after_block_id uuid DEFAULT NULL,
  p_expected_structure_version int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  inserted jsonb;
  created jsonb;
  table_id uuid;
  canonical api.blocks;
BEGIN
  inserted := api.insert_block(
    p_record_id,
    'sheet',
    '{}'::jsonb,
    1,
    p_after_block_id,
    p_expected_structure_version
  );

  created := api.create_scientific_table(
    (inserted #>> '{block,id}')::uuid,
    'Scientific sheet',
    '[]'::jsonb,
    NULL
  );
  table_id := (created #>> '{table,id}')::uuid;

  UPDATE api.blocks
  SET payload = jsonb_build_object('tableId', table_id), updated_at = now()
  WHERE id = (inserted #>> '{block,id}')::uuid
  RETURNING * INTO canonical;

  RETURN jsonb_build_object(
    'block', to_jsonb(canonical),
    'table', created->'table',
    'resourceName', created #>> '{table,resource_name}',
    'structure_version', (inserted->>'structure_version')::int
  );
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.insert_sheet_block(uuid,uuid,int) FROM PUBLIC,api_client;
GRANT EXECUTE ON FUNCTION api.insert_sheet_block(uuid,uuid,int) TO authenticated;
--> statement-breakpoint
-- One stable authority used by generated-row triggers and RPCs. Reading an
-- archived record remains permitted; every write path is rejected in SQL.
CREATE FUNCTION internal.assert_scientific_record_writable(p_table_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM api.scientific_tables t JOIN api.records r ON r.id=t.record_id WHERE t.id=p_table_id AND r.archived_at IS NULL AND r.deleted_at IS NULL)
 THEN RAISE EXCEPTION 'owning record is not writable' USING ERRCODE='42501'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION internal.assert_scientific_record_writable(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.scientific_row_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t api.scientific_tables; c jsonb:=api.claim_probe(); col api.scientific_columns;
BEGIN
 SELECT * INTO t FROM api.scientific_tables WHERE resource_name=TG_TABLE_NAME;
 PERFORM internal.assert_scientific_record_writable(t.id);
 IF TG_OP='DELETE' THEN IF cardinality(OLD.formula_column_ids)>0 THEN RAISE EXCEPTION 'rows with formula targets cannot be deleted' USING ERRCODE='23514'; END IF; RETURN OLD;
 ELSIF TG_OP='INSERT' THEN NEW.workspace_id:=COALESCE(NEW.workspace_id,api.current_workspace_id()); NEW.created_by_user_id:=c->>'sub'; NEW.created_by_credential_id:=NULLIF(c->>'credential_id','')::uuid;
 ELSE IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_by_credential_id IS DISTINCT FROM OLD.created_by_credential_id OR NEW.formula_column_ids IS DISTINCT FROM OLD.formula_column_ids THEN RAISE EXCEPTION 'reserved row fields are immutable' USING ERRCODE='23514'; END IF; NEW.version:=OLD.version+1; NEW.updated_at:=now(); NEW.updated_by_user_id:=c->>'sub'; NEW.updated_by_credential_id:=NULLIF(c->>'credential_id','')::uuid; END IF;
 IF NEW.workspace_id<>t.workspace_id THEN RAISE EXCEPTION 'generated row workspace mismatch' USING ERRCODE='23514'; END IF;
 FOR col IN SELECT * FROM api.scientific_columns WHERE table_id=t.id LOOP IF col.logical_type='category' AND to_jsonb(NEW)->>col.field_name IS NOT NULL AND (TG_OP='INSERT' OR to_jsonb(NEW)->col.field_name IS DISTINCT FROM to_jsonb(OLD)->col.field_name) AND NOT EXISTS (SELECT 1 FROM api.scientific_category_options o WHERE o.id=(to_jsonb(NEW)->>col.field_name)::uuid AND o.column_id=col.id AND o.workspace_id=t.workspace_id AND o.lifecycle='active') THEN RAISE EXCEPTION 'category option does not belong to active exact column' USING ERRCODE='23514'; END IF; IF col.id=ANY(NEW.formula_column_ids) AND to_jsonb(NEW)->col.field_name <> 'null'::jsonb THEN RAISE EXCEPTION 'formula cells cannot contain literals' USING ERRCODE='23514'; END IF; END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION api.apply_scientific_row_changes(p_table_id uuid,p_expected_schema_version int,p_edits jsonb,p_inserts jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t api.scientific_tables; result jsonb; item jsonb; key text; col api.scientific_columns; physical jsonb; fields text; selectors text; one jsonb; rows jsonb:='[]';
BEGIN
 SELECT * INTO t FROM api.scientific_tables WHERE id=p_table_id AND workspace_id=(api.claim_probe()->>'workspace_id')::uuid FOR UPDATE;
 IF t.id IS NULL THEN RAISE EXCEPTION 'scientific table denied' USING ERRCODE='42501'; END IF;
 PERFORM internal.scientific_actor(t.workspace_id,ARRAY['scientific:read','scientific:write']); PERFORM internal.assert_scientific_record_writable(t.id);
 IF p_expected_schema_version IS NULL OR t.schema_version IS DISTINCT FROM p_expected_schema_version THEN RAISE EXCEPTION 'schema version mismatch' USING ERRCODE='SB001'; END IF;
 IF jsonb_typeof(p_edits) IS DISTINCT FROM 'array' OR jsonb_typeof(p_inserts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_edits)+jsonb_array_length(p_inserts)=0 THEN RAISE EXCEPTION 'non-null edit and insert arrays with at least one change are required' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_edits)>0 THEN result:=api.apply_scientific_row_edits(p_table_id,p_expected_schema_version,p_edits); IF (result->>'ok')::boolean IS NOT TRUE THEN RETURN result; END IF; rows:=result->'rows'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_inserts) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item='{}' THEN RAISE EXCEPTION 'invalid insert shape' USING ERRCODE='22023'; END IF; physical:='{}'; fields:=NULL; selectors:=NULL;
  FOR key IN SELECT jsonb_object_keys(item) LOOP BEGIN SELECT * INTO col FROM api.scientific_columns WHERE id=key::uuid AND table_id=t.id AND lifecycle='active'; EXCEPTION WHEN invalid_text_representation THEN col:=NULL; END; IF col.id IS NULL THEN RAISE EXCEPTION 'unknown scientific column' USING ERRCODE='22023'; END IF; physical:=physical||jsonb_build_object(col.field_name,item->key); END LOOP;
  SELECT string_agg(format('%I',c.field_name),',' ORDER BY c.display_order,c.id),string_agg(format('r.%I',c.field_name),',' ORDER BY c.display_order,c.id) INTO fields,selectors FROM api.scientific_columns c WHERE c.table_id=t.id AND c.lifecycle='active' AND item ? c.id::text;
  EXECUTE format('INSERT INTO api.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::api.%I,$1) r RETURNING to_jsonb(%I.*)',t.resource_name,fields,selectors,t.resource_name,t.resource_name) INTO one USING physical; rows:=rows||jsonb_build_array(one);
 END LOOP;
 RETURN jsonb_build_object('ok',true,'schemaVersion',t.schema_version,'rows',rows);
END $$;
REVOKE EXECUTE ON FUNCTION api.apply_scientific_row_changes(uuid,int,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.apply_scientific_row_changes(uuid,int,jsonb,jsonb) TO authenticated,api_client;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
