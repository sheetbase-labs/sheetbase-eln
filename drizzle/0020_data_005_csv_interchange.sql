-- DATA-005: imports and exports have durable, content-minimised provenance.
CREATE TABLE api.scientific_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
 record_id uuid NOT NULL REFERENCES api.records(id) ON DELETE CASCADE,
 table_id uuid NOT NULL REFERENCES api.scientific_tables(id) ON DELETE CASCADE,
 operation text NOT NULL CHECK (operation IN ('import','export')),
 format text NOT NULL CHECK (format IN ('csv','csv+metadata')),
 file_name text CHECK (file_name IS NULL OR length(file_name)<=255),
 file_size bigint CHECK (file_size IS NULL OR file_size BETWEEN 0 AND 10485760),
 file_sha256 text CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
 row_count int NOT NULL CHECK (row_count>=0 AND row_count<=5000),
 duplicate_strategy text CHECK (duplicate_strategy IS NULL OR duplicate_strategy IN ('allow','reject_file','skip_file')),
 details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details)='object'),
 actor_user_id text REFERENCES internal."user"(id),
 actor_credential_id uuid REFERENCES internal.api_credentials(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((actor_user_id IS NOT NULL)::int+(actor_credential_id IS NOT NULL)::int=1)
);
CREATE INDEX idx_scientific_transfers_table ON api.scientific_transfers(table_id,created_at DESC);
ALTER TABLE api.scientific_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY scientific_transfer_member_read ON api.scientific_transfers FOR SELECT TO authenticated
 USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY scientific_transfer_api_read ON api.scientific_transfers FOR SELECT TO api_client
 USING(workspace_id=api.current_workspace_id() AND internal.scientific_actor(workspace_id,ARRAY['scientific:read']) IS NOT NULL);
GRANT SELECT ON api.scientific_transfers TO authenticated,api_client;
REVOKE INSERT,UPDATE,DELETE ON api.scientific_transfers FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint

-- One call evolves requested fields, maps rows, applies every accepted row and
-- writes provenance. Any exception rolls back DDL, rows and provenance together.
CREATE FUNCTION api.import_scientific_rows(
 p_table_id uuid,p_expected_schema_version int,p_file jsonb,p_mappings jsonb,
 p_rows jsonb,p_duplicate_strategy text DEFAULT 'reject_file'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t api.scientific_tables; actor jsonb; mapping jsonb; source text; target_id uuid; new_spec jsonb; added jsonb; current_version int; incoming jsonb; mapped jsonb; imports jsonb:='[]'; seen jsonb:='{}'; fingerprint text; skipped int:=0; result jsonb; transfer_id uuid;
BEGIN
 SELECT * INTO t FROM api.scientific_tables WHERE id=p_table_id AND workspace_id=internal.scientific_claimed_workspace() FOR UPDATE;
 IF t.id IS NULL OR t.lifecycle<>'active' THEN RAISE EXCEPTION 'active scientific table denied' USING ERRCODE='42501'; END IF;
 actor:=internal.scientific_actor(t.workspace_id,ARRAY['scientific:read','scientific:write']);
 PERFORM internal.assert_scientific_record_writable(t.id);
 IF p_expected_schema_version IS NULL OR t.schema_version<>p_expected_schema_version THEN RAISE EXCEPTION 'schema version mismatch' USING ERRCODE='SB001'; END IF;
 IF jsonb_typeof(p_file)<>'object' OR p_file-ARRAY['name','size','sha256','encoding','delimiter','header']<>'{}' OR jsonb_typeof(p_mappings)<>'array' OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)<1 OR jsonb_array_length(p_rows)>5000 OR p_duplicate_strategy NOT IN ('allow','reject_file','skip_file') THEN RAISE EXCEPTION 'invalid import shape' USING ERRCODE='22023'; END IF;
 IF length(coalesce(p_file->>'name',''))>255 OR (p_file->>'size')::bigint NOT BETWEEN 0 AND 10485760 OR p_file->>'sha256' !~ '^[0-9a-f]{64}$' OR p_file->>'encoding' NOT IN ('utf-8','utf-16le','windows-1252') OR p_file->>'delimiter' NOT IN (',',';',E'\t') OR jsonb_typeof(p_file->'header')<>'boolean' THEN RAISE EXCEPTION 'invalid import file metadata' USING ERRCODE='22023'; END IF;
 current_version:=t.schema_version;
 CREATE TEMP TABLE import_mapping(source text PRIMARY KEY,column_id uuid NOT NULL) ON COMMIT DROP;
 FOR mapping IN SELECT value FROM jsonb_array_elements(p_mappings) LOOP
  IF jsonb_typeof(mapping)<>'object' OR mapping-ARRAY['source','columnId','newColumn']<>'{}' OR jsonb_typeof(mapping->'source')<>'string' OR nullif(mapping->>'source','') IS NULL OR ((mapping ? 'columnId')::int+(mapping ? 'newColumn')::int)<>1 THEN RAISE EXCEPTION 'invalid import mapping' USING ERRCODE='22023'; END IF;
  source:=mapping->>'source';
  IF mapping ? 'columnId' THEN
   BEGIN target_id:=(mapping->>'columnId')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid mapped column' USING ERRCODE='22023'; END;
   IF NOT EXISTS(SELECT 1 FROM api.scientific_columns c WHERE c.id=target_id AND c.table_id=t.id AND c.lifecycle='active') THEN RAISE EXCEPTION 'mapped column is unavailable' USING ERRCODE='22023'; END IF;
  ELSE
   PERFORM internal.scientific_actor(t.workspace_id,ARRAY['scientific:schema']);
   new_spec:=mapping->'newColumn';
   IF jsonb_typeof(new_spec)<>'object' OR new_spec-ARRAY['label','logicalType','nullable','unit','validation']<>'{}' THEN RAISE EXCEPTION 'invalid new import column' USING ERRCODE='22023'; END IF;
   added:=internal.add_scientific_column_impl(t.id,current_version,new_spec->>'label',new_spec->>'logicalType',coalesce((new_spec->>'nullable')::boolean,true),NULL,new_spec->'unit',coalesce(new_spec->'validation','{}'),NULL);
   target_id:=(added->>'id')::uuid; current_version:=current_version+1;
  END IF;
  INSERT INTO import_mapping VALUES(source,target_id);
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM import_mapping) THEN RAISE EXCEPTION 'at least one mapped column is required' USING ERRCODE='22023'; END IF;
 FOR incoming IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(incoming)<>'object' THEN RAISE EXCEPTION 'invalid import row' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_object_agg(m.column_id::text,incoming->m.source),'{}') INTO mapped FROM import_mapping m WHERE incoming ? m.source;
  IF mapped='{}' THEN RAISE EXCEPTION 'import row has no mapped values' USING ERRCODE='22023'; END IF;
  fingerprint:=md5(mapped::text);
  IF seen ? fingerprint THEN
   IF p_duplicate_strategy='reject_file' THEN RAISE EXCEPTION 'duplicate rows in import file' USING ERRCODE='23505';
   ELSIF p_duplicate_strategy='skip_file' THEN skipped:=skipped+1; CONTINUE; END IF;
  END IF;
  seen:=seen||jsonb_build_object(fingerprint,true); imports:=imports||jsonb_build_array(mapped);
 END LOOP;
 IF jsonb_array_length(imports)>0 THEN
  result:=api.apply_scientific_row_changes(t.id,current_version,'[]',imports);
  IF (result->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'import rows failed validation' USING ERRCODE='23514'; END IF;
 ELSE result:=jsonb_build_object('ok',true,'schemaVersion',current_version,'rows','[]'::jsonb); END IF;
 INSERT INTO api.scientific_transfers(workspace_id,record_id,table_id,operation,format,file_name,file_size,file_sha256,row_count,duplicate_strategy,details,actor_user_id,actor_credential_id)
 VALUES(t.workspace_id,t.record_id,t.id,'import','csv',p_file->>'name',(p_file->>'size')::bigint,p_file->>'sha256',jsonb_array_length(imports),p_duplicate_strategy,jsonb_build_object('encoding',p_file->>'encoding','delimiter',p_file->>'delimiter','header',(p_file->>'header')::boolean,'skippedDuplicates',skipped,'sourceColumns',jsonb_array_length(p_mappings)),actor->>'user_id',(actor->>'credential_id')::uuid) RETURNING id INTO transfer_id;
 PERFORM internal.emit_change_event(t.workspace_id,'scientific_table',t.id,'update',t.record_id,NULL,jsonb_build_object('operation','import','rowCount',jsonb_array_length(imports),'transferId',transfer_id,'schemaVersion',current_version));
 RETURN result||jsonb_build_object('transferId',transfer_id,'importedRows',jsonb_array_length(imports),'skippedDuplicates',skipped,'schemaVersion',current_version);
END $$;
REVOKE EXECUTE ON FUNCTION api.import_scientific_rows(uuid,int,jsonb,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.import_scientific_rows(uuid,int,jsonb,jsonb,jsonb,text) TO authenticated,api_client;
--> statement-breakpoint

CREATE FUNCTION api.record_scientific_export(p_table_id uuid,p_row_count int,p_format text DEFAULT 'csv+metadata') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t api.scientific_tables; actor jsonb; transfer_id uuid;
BEGIN
 SELECT * INTO t FROM api.scientific_tables WHERE id=p_table_id AND workspace_id=internal.scientific_claimed_workspace();
 IF t.id IS NULL OR p_row_count NOT BETWEEN 0 AND 5000 OR p_format NOT IN ('csv','csv+metadata') THEN RAISE EXCEPTION 'invalid export' USING ERRCODE='22023'; END IF;
 actor:=internal.scientific_actor(t.workspace_id,ARRAY['scientific:read']);
 INSERT INTO api.scientific_transfers(workspace_id,record_id,table_id,operation,format,row_count,details,actor_user_id,actor_credential_id)
 VALUES(t.workspace_id,t.record_id,t.id,'export',p_format,p_row_count,jsonb_build_object('schemaVersion',t.schema_version),actor->>'user_id',(actor->>'credential_id')::uuid) RETURNING id INTO transfer_id;
 PERFORM internal.emit_change_event(t.workspace_id,'scientific_table',t.id,'update',t.record_id,NULL,jsonb_build_object('operation','export','rowCount',p_row_count,'transferId',transfer_id,'schemaVersion',t.schema_version));
 RETURN jsonb_build_object('transferId',transfer_id,'rowCount',p_row_count,'format',p_format);
END $$;
REVOKE EXECUTE ON FUNCTION api.record_scientific_export(uuid,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.record_scientific_export(uuid,int,text) TO authenticated,api_client;
--> statement-breakpoint
NOTIFY pgrst,'reload schema';
