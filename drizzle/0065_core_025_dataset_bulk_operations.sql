CREATE TABLE "api"."dataset_bulk_commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_dataset_bulk_commits_actor_idempotency" UNIQUE("workspace_id","actor_user_id","idempotency_key"),
	CONSTRAINT "chk_dataset_bulk_commits_idempotency_key" CHECK (length("api"."dataset_bulk_commits"."idempotency_key") BETWEEN 1 AND 128),
	CONSTRAINT "chk_dataset_bulk_commits_request_digest" CHECK ("api"."dataset_bulk_commits"."request_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "api"."dataset_bulk_commits" ADD CONSTRAINT "dataset_bulk_commits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_bulk_commits" ADD CONSTRAINT "dataset_bulk_commits_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "api"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_bulk_commits" ADD CONSTRAINT "dataset_bulk_commits_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "internal"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dataset_bulk_commits_dataset" ON "api"."dataset_bulk_commits" USING btree ("dataset_id");
--> statement-breakpoint
ALTER TABLE api.dataset_bulk_commits ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON api.dataset_bulk_commits TO authenticated;
CREATE POLICY dataset_bulk_commits_read ON api.dataset_bulk_commits FOR SELECT TO authenticated
  USING (workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE FUNCTION api.validate_dataset_row_batch(
  p_dataset_id uuid,
  p_expected_dataset_revision bigint,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  dataset api.datasets;
  item jsonb;
  cell jsonb;
  row_id uuid;
  v_field_id uuid;
  field api.dataset_schema_version_fields;
  errors jsonb := '[]'::jsonb;
  row_index integer := 0;
  key text;
  expected_row_revision bigint;
  existing_row api.dataset_rows;
BEGIN
  SELECT * INTO dataset FROM api.datasets
  WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id()
    AND api.is_workspace_member(workspace_id);
  IF dataset.id IS NULL THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
  IF p_expected_dataset_revision IS NULL OR jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) = 0 OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'expected Dataset revision and 1 to 1000 batch rows are required' USING ERRCODE='22023';
  END IF;
  IF dataset.lifecycle <> 'active' THEN
    RETURN jsonb_build_object('ok',false,'errors',jsonb_build_array(jsonb_build_object('code','dataset_archived','message','Dataset is archived.')));
  END IF;
  IF dataset.revision <> p_expected_dataset_revision THEN
    RETURN jsonb_build_object('ok',false,'errors',jsonb_build_array(jsonb_build_object('code','stale_dataset_revision','expectedRevision',p_expected_dataset_revision,'actualRevision',dataset.revision)));
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    row_index := row_index + 1;
    IF jsonb_typeof(item) <> 'object' OR item - ARRAY['operation','rowId','expectedRevision','values'] <> '{}'::jsonb
       OR item->>'operation' NOT IN ('create','update') OR jsonb_typeof(item->'rowId') <> 'string'
       OR jsonb_typeof(item->'values') <> 'object' OR item->'values'='{}'::jsonb THEN
      RAISE EXCEPTION 'invalid Dataset batch row shape' USING ERRCODE='22023';
    END IF;
    BEGIN row_id := (item->>'rowId')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid Dataset row id' USING ERRCODE='22023'; END;
    IF item->>'operation'='update' THEN
      IF jsonb_typeof(item->'expectedRevision') <> 'number' OR coalesce((item->>'expectedRevision') ~ '^[1-9][0-9]*$',false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Dataset updates require an expected row revision' USING ERRCODE='22023';
      END IF;
      expected_row_revision := (item->>'expectedRevision')::bigint;
      SELECT * INTO existing_row FROM api.dataset_rows WHERE id=row_id AND dataset_id=dataset.id;
      IF existing_row.id IS NULL THEN
        errors := errors || jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'code','row_missing'));
      ELSIF existing_row.revision <> expected_row_revision THEN
        errors := errors || jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'code','stale_row_revision','expectedRevision',expected_row_revision,'actualRevision',existing_row.revision));
      END IF;
    ELSIF item ? 'expectedRevision' THEN
      RAISE EXCEPTION 'Dataset creates cannot include an expected row revision' USING ERRCODE='22023';
    ELSIF EXISTS (SELECT 1 FROM api.dataset_rows WHERE id=row_id) THEN
      errors := errors || jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'code','row_id_exists'));
    END IF;
    FOR key, cell IN SELECT entry.key,entry.value FROM jsonb_each(item->'values') entry LOOP
      BEGIN v_field_id := key::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid Dataset field id' USING ERRCODE='22023'; END;
      SELECT * INTO field FROM api.dataset_schema_version_fields
      WHERE schema_version_id=dataset.schema_version_id AND field_id=v_field_id AND lifecycle='active';
      IF field.id IS NULL THEN
        errors := errors || jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',key,'code','unknown_field'));
      ELSIF cell='null'::jsonb AND NOT field.nullable THEN
        errors := errors || jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',v_field_id,'code','required_value'));
      ELSIF cell <> 'null'::jsonb AND (
        (field.logical_type='text' AND jsonb_typeof(cell)<>'string') OR
        (field.logical_type IN ('integer','decimal') AND jsonb_typeof(cell)<>'number') OR
        (field.logical_type='boolean' AND jsonb_typeof(cell)<>'boolean') OR
        (field.logical_type IN ('date','timestamp','category','reference') AND jsonb_typeof(cell)<>'string')
      ) THEN
        errors := errors || jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',v_field_id,'code','invalid_value_type','logicalType',field.logical_type));
      ELSE
        BEGIN
          IF cell <> 'null'::jsonb THEN
            IF field.logical_type='integer' THEN PERFORM (cell #>> '{}')::bigint;
            ELSIF field.logical_type='decimal' THEN PERFORM (cell #>> '{}')::numeric;
            ELSIF field.logical_type='date' THEN PERFORM (cell #>> '{}')::date;
            ELSIF field.logical_type='timestamp' THEN PERFORM (cell #>> '{}')::timestamptz;
            ELSIF field.logical_type IN ('category','reference') THEN PERFORM (cell #>> '{}')::uuid;
            END IF;
          END IF;
        EXCEPTION WHEN others THEN
          errors := errors || jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',v_field_id,'code','invalid_value'));
        END;
      END IF;
    END LOOP;
    IF item->>'operation'='create' THEN
      FOR field IN SELECT * FROM api.dataset_schema_version_fields WHERE schema_version_id=dataset.schema_version_id AND lifecycle='active' AND NOT nullable LOOP
        IF NOT (item->'values' ? field.field_id::text) OR item->'values'->field.field_id::text='null'::jsonb THEN
          errors := errors || jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',field.field_id,'code','required_value'));
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) value GROUP BY value->>'rowId' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'duplicate Dataset row id in batch' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('ok',jsonb_array_length(errors)=0,'errors',errors);
END $$;
REVOKE EXECUTE ON FUNCTION api.validate_dataset_row_batch(uuid,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.validate_dataset_row_batch(uuid,bigint,jsonb) TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.commit_dataset_row_batch(
  p_dataset_id uuid,
  p_expected_dataset_revision bigint,
  p_rows jsonb,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  dataset api.datasets;
  existing api.dataset_bulk_commits;
  validation jsonb;
  digest text;
  actor text;
  item jsonb;
  cell jsonb;
  v_row_id uuid;
  v_field_id uuid;
  field api.dataset_schema_version_fields;
  result_rows jsonb := '[]'::jsonb;
  result jsonb;
BEGIN
  actor := api.claim_probe()->>'sub';
  SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id) FOR UPDATE;
  IF dataset.id IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'valid idempotency key is required' USING ERRCODE='22023'; END IF;
  digest := encode(sha256(convert_to(jsonb_build_object('datasetId',p_dataset_id,'expectedDatasetRevision',p_expected_dataset_revision,'rows',p_rows)::text,'UTF8')),'hex');
  SELECT * INTO existing FROM api.dataset_bulk_commits WHERE workspace_id=dataset.workspace_id AND actor_user_id=actor AND idempotency_key=p_idempotency_key;
  IF existing.id IS NOT NULL THEN
    IF existing.dataset_id<>p_dataset_id OR existing.request_digest<>digest THEN RAISE EXCEPTION 'idempotency key was used for a different Dataset batch' USING ERRCODE='23505'; END IF;
    RETURN existing.result || jsonb_build_object('idempotent',true);
  END IF;
  validation := api.validate_dataset_row_batch(p_dataset_id,p_expected_dataset_revision,p_rows);
  IF (validation->>'ok')::boolean IS NOT TRUE THEN RETURN validation || jsonb_build_object('idempotent',false); END IF;
  PERFORM 1 FROM api.dataset_rows r WHERE r.dataset_id=dataset.id AND r.id IN (SELECT (value->>'rowId')::uuid FROM jsonb_array_elements(p_rows)) ORDER BY r.id FOR UPDATE;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_row_id := (item->>'rowId')::uuid;
    IF item->>'operation'='create' THEN
      INSERT INTO api.dataset_rows(id,dataset_id,workspace_id) VALUES(v_row_id,dataset.id,dataset.workspace_id);
      result_rows := result_rows || jsonb_build_array(jsonb_build_object('rowId',v_row_id,'revision',1,'operation','create'));
    ELSE
      UPDATE api.dataset_rows r SET revision=r.revision+1,updated_at=now() WHERE r.id=v_row_id;
      result_rows := result_rows || jsonb_build_array(jsonb_build_object('rowId',v_row_id,'revision',(SELECT r.revision FROM api.dataset_rows r WHERE r.id=v_row_id),'operation','update'));
    END IF;
    FOR v_field_id, cell IN SELECT entry.key::uuid,entry.value FROM jsonb_each(item->'values') entry LOOP
      SELECT * INTO field FROM api.dataset_schema_version_fields f WHERE f.schema_version_id=dataset.schema_version_id AND f.field_id=v_field_id;
      IF cell='null'::jsonb THEN DELETE FROM api.dataset_row_values v WHERE v.row_id=v_row_id AND v.field_id=v_field_id;
      ELSE
        INSERT INTO api.dataset_row_values(row_id,field_id,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id)
        VALUES(v_row_id,v_field_id,
          CASE WHEN field.logical_type='text' THEN cell #>> '{}' END,
          CASE WHEN field.logical_type='integer' THEN (cell #>> '{}')::bigint END,
          CASE WHEN field.logical_type='decimal' THEN (cell #>> '{}')::numeric END,
          CASE WHEN field.logical_type='boolean' THEN (cell #>> '{}')::boolean END,
          CASE WHEN field.logical_type='date' THEN (cell #>> '{}')::date END,
          CASE WHEN field.logical_type='timestamp' THEN (cell #>> '{}')::timestamptz END,
          CASE WHEN field.logical_type='category' THEN (cell #>> '{}')::uuid END,
          CASE WHEN field.logical_type='reference' THEN (cell #>> '{}')::uuid END)
        ON CONFLICT (row_id,field_id) DO UPDATE SET text_value=EXCLUDED.text_value,integer_value=EXCLUDED.integer_value,numeric_value=EXCLUDED.numeric_value,boolean_value=EXCLUDED.boolean_value,date_value=EXCLUDED.date_value,timestamp_value=EXCLUDED.timestamp_value,category_option_id=EXCLUDED.category_option_id,reference_id=EXCLUDED.reference_id;
      END IF;
    END LOOP;
  END LOOP;
  UPDATE api.datasets SET revision=revision+1,updated_at=now() WHERE id=dataset.id RETURNING revision INTO dataset.revision;
  result := jsonb_build_object('ok',true,'datasetId',dataset.id,'datasetRevision',dataset.revision,'rows',result_rows,'idempotent',false);
  INSERT INTO api.dataset_bulk_commits(workspace_id,dataset_id,actor_user_id,idempotency_key,request_digest,result) VALUES(dataset.workspace_id,dataset.id,actor,p_idempotency_key,digest,result);
  RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION api.commit_dataset_row_batch(uuid,bigint,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.commit_dataset_row_batch(uuid,bigint,jsonb,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
