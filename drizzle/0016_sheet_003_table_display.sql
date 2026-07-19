-- SHEET-003: all scientific schema DDL is gated by a locked, writable owning
-- record. This is deliberately inside the definer RPC transaction: UI checks
-- cannot prevent an archive/delete racing a schema operation.
CREATE OR REPLACE FUNCTION internal.assert_scientific_record_writable(p_table_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE writable boolean;
BEGIN
 SELECT true INTO writable
 FROM api.scientific_tables t JOIN api.records r ON r.id=t.record_id
 WHERE t.id=p_table_id AND r.archived_at IS NULL AND r.deleted_at IS NULL
 FOR UPDATE OF r;
 IF writable IS NOT TRUE THEN
  RAISE EXCEPTION 'owning record is not writable' USING ERRCODE='42501';
 END IF;
END $$;
REVOKE EXECUTE ON FUNCTION internal.assert_scientific_record_writable(uuid) FROM PUBLIC;
--> statement-breakpoint

-- Resource identity remains immutable; callers never PATCH scientific_tables directly.
CREATE FUNCTION api.update_scientific_table_display(
  p_table_id uuid,
  p_expected_schema_version int,
  p_name text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  claimed_workspace uuid:=internal.scientific_claimed_workspace();
  t api.scientific_tables;
  actor jsonb;
BEGIN
  SELECT * INTO t
    FROM api.scientific_tables
   WHERE id=p_table_id AND workspace_id=claimed_workspace
   FOR UPDATE;
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'scientific object denied' USING ERRCODE='42501';
  END IF;
  actor:=internal.scientific_actor(t.workspace_id,ARRAY['scientific:schema']);
  PERFORM internal.assert_scientific_record_writable(t.id);
  IF t.lifecycle<>'active' THEN
    RAISE EXCEPTION 'active table required' USING ERRCODE='22023';
  END IF;
  IF p_expected_schema_version IS NULL OR
     t.schema_version IS DISTINCT FROM p_expected_schema_version THEN
    RAISE EXCEPTION 'schema version mismatch' USING ERRCODE='SB001';
  END IF;
  IF nullif(btrim(p_name),'') IS NULL OR length(p_name)>200 THEN
    RAISE EXCEPTION 'table name must be between 1 and 200 characters' USING ERRCODE='22023';
  END IF;

  UPDATE api.scientific_tables
     SET name=p_name,
         schema_version=schema_version+1,
         updated_at=now(),
         updated_by_user_id=actor->>'user_id',
         updated_by_credential_id=(actor->>'credential_id')::uuid
   WHERE id=t.id;
  PERFORM internal.emit_change_event(
    t.workspace_id,'scientific_table',t.id,'update',t.record_id,NULL,
    jsonb_build_object('operation','display','columnIds','[]'::jsonb,
                       'schemaVersion',t.schema_version+1));
  RETURN jsonb_build_object('id',t.id,'name',p_name,
                            'resourceName',t.resource_name,
                            'schemaVersion',t.schema_version+1);
END $$;
REVOKE EXECUTE ON FUNCTION api.update_scientific_table_display(uuid,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.update_scientific_table_display(uuid,int,text) TO authenticated,api_client;
--> statement-breakpoint

-- Override DATA-003's public wrappers, preserving its workspace-first lookup,
-- actor/scope checks, attribution, and response aliases while adding the
-- record lock immediately before each implementation can perform DDL.
CREATE OR REPLACE FUNCTION api.create_scientific_table(p_block_id uuid,p_name text,p_columns jsonb DEFAULT '[]',p_description text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ws uuid:=internal.scientific_claimed_workspace(); record_id uuid; writable boolean; result jsonb;
BEGIN
 SELECT r.workspace_id,r.id INTO ws,record_id FROM api.blocks b JOIN api.records r ON r.id=b.record_id WHERE b.id=p_block_id AND r.workspace_id=ws;
 IF ws IS NULL THEN RAISE EXCEPTION 'scientific object denied' USING ERRCODE='42501'; END IF;
 PERFORM internal.scientific_actor(ws,ARRAY['scientific:schema']);
 SELECT true INTO writable FROM api.records r WHERE r.id=record_id AND r.archived_at IS NULL AND r.deleted_at IS NULL FOR UPDATE;
 IF writable IS NOT TRUE THEN RAISE EXCEPTION 'owning record is not writable' USING ERRCODE='42501'; END IF;
 result:=internal.create_scientific_table_impl(p_block_id,p_name,p_columns,p_description);
 RETURN result||jsonb_build_object('resourceName',result#>>'{table,resource_name}');
END $$;

CREATE OR REPLACE FUNCTION api.add_scientific_column(p_table_id uuid,p_expected_schema_version int,p_label text,p_logical_type text,p_nullable boolean DEFAULT true,p_default jsonb DEFAULT NULL,p_unit jsonb DEFAULT NULL,p_validation jsonb DEFAULT '{}',p_options jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ws uuid:=internal.scientific_claimed_workspace(); resource text; result jsonb; actor jsonb;
BEGIN
 SELECT workspace_id,resource_name INTO ws,resource FROM api.scientific_tables WHERE id=p_table_id AND workspace_id=ws FOR UPDATE;
 IF ws IS NULL THEN RAISE EXCEPTION 'scientific object denied' USING ERRCODE='42501'; END IF;
 actor:=internal.scientific_actor(ws,ARRAY['scientific:schema']);
 IF p_expected_schema_version IS NULL THEN RAISE EXCEPTION 'expected schema version is required' USING ERRCODE='22023'; END IF;
 PERFORM internal.assert_scientific_record_writable(p_table_id);
 result:=internal.add_scientific_column_impl(p_table_id,p_expected_schema_version,p_label,p_logical_type,p_nullable,p_default,p_unit,p_validation,p_options);
 UPDATE api.scientific_tables SET updated_by_user_id=actor->>'user_id',updated_by_credential_id=(actor->>'credential_id')::uuid,updated_at=now() WHERE id=p_table_id;
 RETURN result||jsonb_build_object('resourceName',resource,'fieldName',result->>'field_name');
END $$;

CREATE OR REPLACE FUNCTION api.update_scientific_column_display(p_column_id uuid,p_expected_schema_version int,p_label text DEFAULT NULL,p_display_order int DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ws uuid:=internal.scientific_claimed_workspace(); table_id uuid; resource text; result jsonb; actor jsonb;
BEGIN
 SELECT t.workspace_id,t.id,t.resource_name INTO ws,table_id,resource FROM api.scientific_columns c JOIN api.scientific_tables t ON t.id=c.table_id WHERE c.id=p_column_id AND t.workspace_id=ws FOR UPDATE OF t;
 IF ws IS NULL THEN RAISE EXCEPTION 'scientific object denied' USING ERRCODE='42501'; END IF;
 actor:=internal.scientific_actor(ws,ARRAY['scientific:schema']);
 IF p_expected_schema_version IS NULL THEN RAISE EXCEPTION 'expected schema version is required' USING ERRCODE='22023'; END IF;
 PERFORM internal.assert_scientific_record_writable(table_id);
 result:=internal.update_scientific_column_display_impl(p_column_id,p_expected_schema_version,p_label,p_display_order);
 UPDATE api.scientific_tables SET updated_by_user_id=actor->>'user_id',updated_by_credential_id=(actor->>'credential_id')::uuid,updated_at=now() WHERE id=table_id;
 RETURN result||jsonb_build_object('resourceName',resource,'fieldName',result->>'field_name');
END $$;

CREATE OR REPLACE FUNCTION api.retire_scientific_column(p_column_id uuid,p_expected_schema_version int,p_confirmation_hash text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ws uuid:=internal.scientific_claimed_workspace(); table_id uuid; resource text; field text; result jsonb; actor jsonb;
BEGIN
 SELECT t.workspace_id,t.id,t.resource_name,c.field_name INTO ws,table_id,resource,field FROM api.scientific_columns c JOIN api.scientific_tables t ON t.id=c.table_id WHERE c.id=p_column_id AND t.workspace_id=ws FOR UPDATE OF t;
 IF ws IS NULL THEN RAISE EXCEPTION 'scientific object denied' USING ERRCODE='42501'; END IF;
 actor:=internal.scientific_actor(ws,ARRAY['scientific:schema']);
 IF p_expected_schema_version IS NULL THEN RAISE EXCEPTION 'expected schema version is required' USING ERRCODE='22023'; END IF;
 IF p_confirmation_hash IS NOT NULL THEN PERFORM internal.assert_scientific_record_writable(table_id); END IF;
 result:=internal.retire_scientific_column_impl(p_column_id,p_expected_schema_version,p_confirmation_hash);
 IF (result->>'retired')::boolean IS TRUE THEN UPDATE api.scientific_tables SET updated_by_user_id=actor->>'user_id',updated_by_credential_id=(actor->>'credential_id')::uuid,updated_at=now() WHERE id=table_id; END IF;
 RETURN result||jsonb_build_object('resourceName',resource,'fieldName',field);
END $$;

CREATE OR REPLACE FUNCTION api.convert_scientific_column(p_column_id uuid,p_expected_schema_version int,p_new_logical_type text,p_confirmation_hash text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ws uuid:=internal.scientific_claimed_workspace(); table_id uuid; resource text; field text; result jsonb; actor jsonb;
BEGIN
 SELECT t.workspace_id,t.id,t.resource_name,c.field_name INTO ws,table_id,resource,field FROM api.scientific_columns c JOIN api.scientific_tables t ON t.id=c.table_id WHERE c.id=p_column_id AND t.workspace_id=ws FOR UPDATE OF t;
 IF ws IS NULL THEN RAISE EXCEPTION 'scientific object denied' USING ERRCODE='42501'; END IF;
 actor:=internal.scientific_actor(ws,ARRAY['scientific:schema']);
 IF p_expected_schema_version IS NULL THEN RAISE EXCEPTION 'expected schema version is required' USING ERRCODE='22023'; END IF;
 IF p_confirmation_hash IS NOT NULL THEN PERFORM internal.assert_scientific_record_writable(table_id); END IF;
 result:=internal.convert_scientific_column_impl(p_column_id,p_expected_schema_version,p_new_logical_type,p_confirmation_hash);
 IF (result->>'converted')::boolean IS TRUE THEN UPDATE api.scientific_tables SET updated_by_user_id=actor->>'user_id',updated_by_credential_id=(actor->>'credential_id')::uuid,updated_at=now() WHERE id=table_id; END IF;
 RETURN result||jsonb_build_object('resourceName',resource,'fieldName',field);
END $$;

REVOKE EXECUTE ON FUNCTION api.create_scientific_table(uuid,text,jsonb,text),api.add_scientific_column(uuid,int,text,text,boolean,jsonb,jsonb,jsonb,jsonb),api.update_scientific_column_display(uuid,int,text,int),api.retire_scientific_column(uuid,int,text),api.convert_scientific_column(uuid,int,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.create_scientific_table(uuid,text,jsonb,text),api.add_scientific_column(uuid,int,text,text,boolean,jsonb,jsonb,jsonb,jsonb),api.update_scientific_column_display(uuid,int,text,int),api.retire_scientific_column(uuid,int,text),api.convert_scientific_column(uuid,int,text,text) TO authenticated,api_client;
--> statement-breakpoint
NOTIFY pgrst,'reload schema';
