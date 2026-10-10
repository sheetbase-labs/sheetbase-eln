ALTER TABLE "api"."dataset_rows" ADD COLUMN "planned_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dataset_rows_planned_key" ON "api"."dataset_rows" USING btree ("dataset_id","planned_key") WHERE "api"."dataset_rows"."status" = 'planned' AND "api"."dataset_rows"."planned_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."dataset_rows" ADD CONSTRAINT "chk_dataset_rows_planned_key" CHECK ("api"."dataset_rows"."planned_key" IS NULL OR length("api"."dataset_rows"."planned_key") BETWEEN 1 AND 200);
--> statement-breakpoint

-- DSET-01.3 (remaining) — planned rows filled by import.
--
-- A planned row may carry a stable `planned_key` (a sample/well key). A later
-- import row that carries the same key, scoped to the same Dataset, fills that
-- planned row instead of creating a duplicate: the planned row becomes
-- `recorded` and receives the imported values. A key that matches nothing still
-- creates a normal row; a key that matches a non-planned row, another Dataset
-- or another workspace is never hijacked.
--
-- The value guard (`internal.assert_dataset_row_recorded`) is unchanged: the
-- commit flips the row to `recorded` before writing values, so values are only
-- ever written as part of the planned→recorded transition.

DROP FUNCTION IF EXISTS api.plan_dataset_row(uuid, timestamptz);--> statement-breakpoint

CREATE FUNCTION api.plan_dataset_row(
  p_dataset_id uuid,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_planned_key text DEFAULT NULL
)
RETURNS api.dataset_rows
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  d api.datasets;
  v api.dataset_rows;
BEGIN
  IF p_planned_key IS NOT NULL THEN
    p_planned_key := btrim(p_planned_key);
    IF length(p_planned_key) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'planned key must be 1 to 200 characters' USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT * INTO d FROM api.datasets
    WHERE id = p_dataset_id AND workspace_id = api.current_workspace_id()
      AND api.is_workspace_writer(workspace_id) AND api.has_write_actor()
    FOR UPDATE;
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'Dataset denied' USING ERRCODE = '42501';
  END IF;
  IF d.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'cannot plan rows in an archived Dataset' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.dataset_rows (dataset_id, workspace_id, status, scheduled_at, planned_key)
  VALUES (d.id, d.workspace_id, 'planned', p_scheduled_at, p_planned_key)
  RETURNING * INTO v;
  RETURN v;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION api.plan_dataset_row(uuid, timestamptz, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.plan_dataset_row(uuid, timestamptz, text) TO authenticated;--> statement-breakpoint

-- request_repeat gains an optional planned key. A single planned row uses the
-- key unchanged; multiple planned rows get `<key>:<i>` so each active planned
-- row stays unique within the Dataset (matching the partial unique index).
DROP FUNCTION IF EXISTS api.request_repeat(uuid, uuid, timestamptz, integer, uuid, uuid, text, jsonb);--> statement-breakpoint

CREATE FUNCTION api.request_repeat(
  p_source_record_id uuid,
  p_dataset_id uuid,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_planned_row_count integer DEFAULT 1,
  p_source_row_id uuid DEFAULT NULL,
  p_source_field_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_properties jsonb DEFAULT '{}'::jsonb,
  p_planned_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_workspace uuid := api.current_workspace_id();
  v_source api.records;
  v_dataset api.datasets;
  v_sample api.records;
  v_row api.dataset_rows;
  v_identifier text;
  v_project uuid;
  v_title text;
  v_metadata jsonb;
  v_row_key text;
  v_row_ids uuid[] := '{}';
  i integer;
BEGIN
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'repeat denied' USING ERRCODE = '42501';
  END IF;
  IF NOT (api.is_workspace_writer(v_workspace) AND api.has_write_actor()) THEN
    RAISE EXCEPTION 'repeat denied' USING ERRCODE = '42501';
  END IF;

  IF p_planned_row_count IS NULL
     OR p_planned_row_count < 1 OR p_planned_row_count > 96 THEN
    RAISE EXCEPTION 'planned row count must be between 1 and 96'
      USING ERRCODE = '22023';
  END IF;
  IF p_planned_key IS NOT NULL THEN
    p_planned_key := btrim(p_planned_key);
    IF length(p_planned_key) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'planned key must be 1 to 200 characters'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_source FROM api.records
    WHERE id = p_source_record_id AND workspace_id = v_workspace
      AND kind = 'sample'
    FOR UPDATE;
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'source sample not found' USING ERRCODE = '42501';
  END IF;
  IF v_source.archived_at IS NOT NULL OR v_source.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot repeat an archived sample' USING ERRCODE = 'SB004';
  END IF;

  SELECT * INTO v_dataset FROM api.datasets
    WHERE id = p_dataset_id AND workspace_id = v_workspace
      AND api.is_workspace_writer(workspace_id) AND api.has_write_actor()
    FOR UPDATE;
  IF v_dataset.id IS NULL THEN
    RAISE EXCEPTION 'Dataset denied' USING ERRCODE = '42501';
  END IF;
  IF v_dataset.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'cannot request a repeat into an archived Dataset'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_row_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.dataset_rows r
    WHERE r.id = p_source_row_id AND r.dataset_id = v_dataset.id
  ) THEN
    RAISE EXCEPTION 'source measurement row not found in Dataset'
      USING ERRCODE = '22023';
  END IF;
  IF p_source_field_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.dataset_schema_version_fields f
    WHERE f.schema_version_id = v_dataset.schema_version_id
      AND f.field_id = p_source_field_id AND f.lifecycle = 'active'
  ) THEN
    RAISE EXCEPTION 'source measurement field not found in Dataset schema'
      USING ERRCODE = '22023';
  END IF;

  -- Existing lineage model: an outgoing 'sample' link from the source sample.
  -- Metadata identifies the exact measurement + schedule this repeat answers.
  v_metadata := jsonb_build_object(
    'origin', 'request_repeat',
    'sourceDatasetId', v_dataset.id,
    'sourceRowId', p_source_row_id,
    'sourceFieldId', p_source_field_id,
    'scheduledAt', p_scheduled_at
  );

  IF EXISTS (
    SELECT 1 FROM api.record_links l
    WHERE l.source_record_id = v_source.id
      AND l.link_type = 'sample'
      AND l.link_metadata->>'origin' = 'request_repeat'
      AND l.link_metadata->>'sourceDatasetId' = v_dataset.id::text
      AND l.link_metadata->>'sourceRowId'
        IS NOT DISTINCT FROM p_source_row_id::text
      AND l.link_metadata->>'sourceFieldId'
        IS NOT DISTINCT FROM p_source_field_id::text
      AND (l.link_metadata->>'scheduledAt')::timestamptz
        IS NOT DISTINCT FROM p_scheduled_at
  ) THEN
    RAISE EXCEPTION 'a repeat has already been requested for this measurement and schedule'
      USING ERRCODE = 'SB075';
  END IF;

  v_project := coalesce(v_source.project_id, v_dataset.primary_project_id);
  v_identifier := api.next_record_identifier(v_workspace, 'sample');
  v_title := nullif(btrim(coalesce(p_title, '')), '');
  IF v_title IS NULL THEN
    v_title := coalesce(v_source.title, v_source.identifier) || ' repeat';
  END IF;

  -- Derived dilution sample: the canonical sample row. `properties` carries the
  -- caller's quantity/unit/location (validated by the existing sample property
  -- guard); provenance lives on the lineage link instead.
  INSERT INTO api.records
    (workspace_id, project_id, kind, identifier, title, status, properties,
     created_by_user_id)
  VALUES
    (v_workspace, v_project, 'sample', v_identifier, v_title, 'available',
     coalesce(p_properties, '{}'::jsonb), api.current_user_id())
  RETURNING * INTO v_sample;

  INSERT INTO api.sample_events
    (workspace_id, record_id, operation, actor_user_id, notes)
  VALUES
    (v_workspace, v_sample.id, 'create', api.current_user_id(),
     'Repeat requested from ' || v_source.identifier);

  INSERT INTO api.record_links
    (source_record_id, target_record_id, target_kind, target_identifier,
     link_type, link_metadata, created_by_user_id)
  VALUES
    (v_source.id, v_sample.id, 'sample', v_sample.identifier, 'sample',
     v_metadata, api.current_user_id());

  -- Planned rows reuse the canonical planned-row RPC (status 'planned',
  -- scheduled time, no values). Any failure rolls the whole repeat back.
  FOR i IN 1..p_planned_row_count LOOP
    v_row_key := CASE
      WHEN p_planned_key IS NULL THEN NULL
      WHEN p_planned_row_count = 1 THEN p_planned_key
      ELSE p_planned_key || ':' || i
    END;
    SELECT * INTO v_row FROM api.plan_dataset_row(v_dataset.id, p_scheduled_at, v_row_key);
    v_row_ids := array_append(v_row_ids, v_row.id);
  END LOOP;

  RETURN jsonb_build_object(
    'sample', to_jsonb(v_sample),
    'plannedRowIds', to_jsonb(v_row_ids),
    'idempotent', false
  );
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION api.request_repeat(uuid, uuid, timestamptz, integer, uuid, uuid, text, jsonb, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.request_repeat(uuid, uuid, timestamptz, integer, uuid, uuid, text, jsonb, text) TO authenticated;--> statement-breakpoint
COMMENT ON FUNCTION api.request_repeat(uuid, uuid, timestamptz, integer, uuid, uuid, text, jsonb, text) IS
  'DSET-01.4: atomic request repeat — derive a dilution sample (LAB-01) and plan Dataset rows (DSET-01.3), linked to the source measurement. Optional p_planned_key keys the rows for later import matching.';--> statement-breakpoint

-- Validation accepts an optional per-row `plannedKey` on creates. It only
-- checks the key shape; the commit decides whether it matches an active
-- planned row in this Dataset.

CREATE OR REPLACE FUNCTION api.validate_dataset_row_batch(p_dataset_id uuid,p_expected_dataset_revision bigint,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE dataset api.datasets; item jsonb; cell jsonb; field api.dataset_schema_version_fields; v_field_id uuid; key text; row_id uuid; existing_row api.dataset_rows; row_index integer:=0; errors jsonb:='[]'::jsonb; error_code text; effective jsonb; seen uuid[] := '{}';
BEGIN
 SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id);
 IF dataset.id IS NULL THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
 IF p_expected_dataset_revision IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'expected Dataset revision and 1 to 1000 batch rows are required' USING ERRCODE='22023'; END IF;
 IF dataset.lifecycle<>'active' THEN RETURN jsonb_build_object('ok',false,'errors',jsonb_build_array(jsonb_build_object('code','dataset_archived'))); END IF;
 IF dataset.revision<>p_expected_dataset_revision THEN RETURN jsonb_build_object('ok',false,'errors',jsonb_build_array(jsonb_build_object('code','stale_dataset_revision','expectedRevision',p_expected_dataset_revision,'actualRevision',dataset.revision))); END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  row_index:=row_index+1;
  IF jsonb_typeof(item)<>'object' OR (item-ARRAY['operation','rowId','expectedRevision','values','plannedKey'])<>'{}'::jsonb OR item->>'operation' NOT IN ('create','update') OR jsonb_typeof(item->'rowId')<>'string' OR jsonb_typeof(item->'values')<>'object' THEN RAISE EXCEPTION 'invalid Dataset batch row shape' USING ERRCODE='22023'; END IF;
  IF item ? 'plannedKey' AND (jsonb_typeof(item->'plannedKey')<>'string' OR length(item->>'plannedKey') NOT BETWEEN 1 AND 200) THEN RAISE EXCEPTION 'invalid Dataset row planned key' USING ERRCODE='22023'; END IF;
  IF item ? 'plannedKey' AND item->>'operation'<>'create' THEN RAISE EXCEPTION 'Dataset planned keys apply only to creates' USING ERRCODE='22023'; END IF;
  BEGIN row_id:=(item->>'rowId')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid Dataset row id' USING ERRCODE='22023'; END;
  IF row_id=ANY(seen) THEN RAISE EXCEPTION 'duplicate Dataset row id in batch' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,row_id);
  IF item->>'operation'='create' AND item ? 'expectedRevision' THEN RAISE EXCEPTION 'Dataset creates cannot include an expected row revision' USING ERRCODE='22023'; END IF;
  IF item->>'operation'='update' AND (jsonb_typeof(item->'expectedRevision')<>'number' OR coalesce((item->>'expectedRevision') ~ '^[1-9][0-9]*$',false) IS NOT TRUE) THEN RAISE EXCEPTION 'Dataset updates require a positive expected row revision' USING ERRCODE='22023'; END IF;
  SELECT * INTO existing_row FROM api.dataset_rows WHERE id=row_id AND dataset_id=dataset.id;
  IF item->>'operation'='create' AND EXISTS (SELECT 1 FROM api.dataset_rows WHERE id=row_id) THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'code','row_id_exists'));
  ELSIF item->>'operation'='update' AND (existing_row.id IS NULL OR jsonb_typeof(item->'expectedRevision')<>'number' OR existing_row.revision<>(item->>'expectedRevision')::bigint) THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'code',CASE WHEN existing_row.id IS NULL THEN 'row_missing' ELSE 'stale_row_revision' END)); END IF;
  FOR key,cell IN SELECT entry.key,entry.value FROM jsonb_each(item->'values') entry LOOP
   BEGIN v_field_id:=key::uuid; EXCEPTION WHEN invalid_text_representation THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',key,'code','invalid_field_id')); CONTINUE; END;
   SELECT * INTO field FROM api.dataset_schema_version_fields WHERE schema_version_id=dataset.schema_version_id AND field_id=v_field_id AND lifecycle='active';
   IF field.id IS NULL THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',key,'code','unknown_field')); CONTINUE; END IF;
   IF cell<>'null'::jsonb THEN
     error_code:=internal.dataset_batch_cell_error(dataset.workspace_id,field,cell);
     IF error_code IS NOT NULL THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',v_field_id,'code',error_code)); END IF;
   END IF;
  END LOOP;
  FOR field IN SELECT * FROM api.dataset_schema_version_fields WHERE schema_version_id=dataset.schema_version_id AND lifecycle='active' AND NOT nullable LOOP
   effective:=item->'values'->field.field_id::text;
   IF item->'values' ? field.field_id::text AND effective<>'null'::jsonb THEN CONTINUE; END IF;
   IF (effective IS NULL OR effective='null'::jsonb) AND item->>'operation'='update' AND effective IS NULL THEN
     SELECT CASE WHEN count(*)=0 THEN NULL WHEN field.cardinality='many' THEN jsonb_agg(coalesce(to_jsonb(text_value),to_jsonb(integer_value),to_jsonb(numeric_value),to_jsonb(boolean_value),to_jsonb(date_value),to_jsonb(timestamp_value),to_jsonb(category_option_id),to_jsonb(reference_id)) ORDER BY ordinal) ELSE (jsonb_agg(coalesce(to_jsonb(text_value),to_jsonb(integer_value),to_jsonb(numeric_value),to_jsonb(boolean_value),to_jsonb(date_value),to_jsonb(timestamp_value),to_jsonb(category_option_id),to_jsonb(reference_id)) ORDER BY ordinal))->0 END INTO effective FROM api.dataset_row_values v WHERE v.row_id=row_id AND v.field_id=field.field_id;
   END IF;
   IF effective IS NULL OR effective='null'::jsonb THEN effective:=field.default_value; END IF;
   IF effective IS NULL OR effective='null'::jsonb THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',field.field_id,'code','required_value'));
   ELSE
     error_code:=internal.dataset_batch_cell_error(dataset.workspace_id,field,effective);
     IF error_code IS NOT NULL THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',field.field_id,'code',CASE WHEN effective=field.default_value THEN 'invalid_default' ELSE error_code END)); END IF;
   END IF;
  END LOOP;
  IF existing_row.id IS NOT NULL THEN
    PERFORM internal.sync_dataset_value_system_flags(dataset.id,row_id,dataset.schema_version_id,item->'values');
  END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',jsonb_array_length(errors)=0,'errors',errors);
END $$;--> statement-breakpoint

-- Commit reconciles system flags after the values are written, and fills an
-- active planned row whose `planned_key` matches a create's `plannedKey`.

CREATE OR REPLACE FUNCTION api.commit_dataset_row_batch(p_dataset_id uuid, p_expected_dataset_revision bigint, p_rows jsonb, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE dataset api.datasets; existing api.dataset_bulk_commits; validation jsonb; digest text; actor_user text; actor_credential uuid; item jsonb; cell jsonb; entry jsonb; v_row_id uuid; v_planned_id uuid; v_field_id uuid; field api.dataset_schema_version_fields; result_rows jsonb:='[]'::jsonb; result jsonb; value_item jsonb; value_ordinal integer; effective jsonb;
BEGIN
 actor_user:=api.current_user_id(); actor_credential:=api.current_credential_id();
 SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_writer(workspace_id) FOR UPDATE;
 IF dataset.id IS NULL OR NOT api.has_write_actor() THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
 IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'valid idempotency key is required' USING ERRCODE='22023'; END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('datasetId',p_dataset_id,'expectedDatasetRevision',p_expected_dataset_revision,'rows',p_rows)::text,'UTF8')),'hex');
 SELECT * INTO existing FROM api.dataset_bulk_commits
  WHERE workspace_id=dataset.workspace_id AND idempotency_key=p_idempotency_key
    AND (
      (actor_user IS NOT NULL AND actor_user_id = actor_user)
      OR (actor_credential IS NOT NULL AND actor_credential_id = actor_credential)
    );
 IF existing.id IS NOT NULL THEN IF existing.dataset_id<>p_dataset_id OR existing.request_digest<>digest THEN RAISE EXCEPTION 'idempotency key was used for a different Dataset batch' USING ERRCODE='23505'; END IF; RETURN existing.result||jsonb_build_object('idempotent',true); END IF;
 validation:=api.validate_dataset_row_batch(p_dataset_id,p_expected_dataset_revision,p_rows); IF (validation->>'ok')::boolean IS NOT TRUE THEN RETURN validation||jsonb_build_object('idempotent',false); END IF;
 PERFORM 1 FROM api.dataset_rows r WHERE r.dataset_id=dataset.id AND (r.id IN (SELECT (value->>'rowId')::uuid FROM jsonb_array_elements(p_rows)) OR (r.status='planned' AND r.planned_key IS NOT NULL AND r.planned_key IN (SELECT value->>'plannedKey' FROM jsonb_array_elements(p_rows) WHERE value ? 'plannedKey'))) ORDER BY r.id FOR UPDATE;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  v_row_id:=(item->>'rowId')::uuid;
  v_planned_id:=NULL;
  IF item->>'operation'='create' AND item ? 'plannedKey' THEN
   SELECT r.id INTO v_planned_id FROM api.dataset_rows r WHERE r.dataset_id=dataset.id AND r.status='planned' AND r.planned_key=item->>'plannedKey' FOR UPDATE;
  END IF;
  IF item->>'operation'='create' AND v_planned_id IS NOT NULL THEN
   UPDATE api.dataset_rows SET status='recorded', revision=revision+1, updated_at=now() WHERE id=v_planned_id;
   v_row_id:=v_planned_id;
   result_rows:=result_rows||jsonb_build_array(jsonb_build_object('rowId',v_row_id,'revision',(SELECT revision FROM api.dataset_rows WHERE id=v_row_id),'operation','fill'));
  ELSIF item->>'operation'='create' THEN INSERT INTO api.dataset_rows(id,dataset_id,workspace_id) VALUES(v_row_id,dataset.id,dataset.workspace_id); result_rows:=result_rows||jsonb_build_array(jsonb_build_object('rowId',v_row_id,'revision',1,'operation','create')); ELSE UPDATE api.dataset_rows SET revision=revision+1,updated_at=now() WHERE id=v_row_id; result_rows:=result_rows||jsonb_build_array(jsonb_build_object('rowId',v_row_id,'revision',(SELECT revision FROM api.dataset_rows WHERE id=v_row_id),'operation','update')); END IF;
  FOR field IN SELECT * FROM api.dataset_schema_version_fields WHERE schema_version_id=dataset.schema_version_id AND lifecycle='active' LOOP
   effective:=item->'values'->field.field_id::text;
   IF effective IS NULL AND item->>'operation'='update' THEN CONTINUE; END IF;
   IF effective IS NULL AND item->>'operation'='create' AND field.default_value IS NOT NULL AND field.default_value<>'null'::jsonb THEN effective:=field.default_value; END IF;
   IF effective='null'::jsonb AND NOT field.nullable THEN effective:=field.default_value; END IF;
   IF effective IS NULL THEN CONTINUE; END IF;
   DELETE FROM api.dataset_row_values WHERE row_id=v_row_id AND field_id=field.field_id;
   IF effective<>'null'::jsonb THEN
    IF field.cardinality='many' THEN value_ordinal:=0; FOR value_item IN SELECT value FROM jsonb_array_elements(effective) LOOP INSERT INTO api.dataset_row_values(row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id) VALUES(v_row_id,field.field_id,value_ordinal,CASE WHEN field.logical_type='text' THEN value_item#>>'{}' END,CASE WHEN field.logical_type='integer' THEN (value_item#>>'{}')::bigint END,CASE WHEN field.logical_type='decimal' THEN (value_item#>>'{}')::numeric END,CASE WHEN field.logical_type='boolean' THEN (value_item#>>'{}')::boolean END,CASE WHEN field.logical_type='date' THEN (value_item#>>'{}')::date END,CASE WHEN field.logical_type='timestamp' THEN (value_item#>>'{}')::timestamptz END,CASE WHEN field.logical_type='category' THEN (value_item#>>'{}')::uuid END,CASE WHEN field.logical_type='reference' THEN (value_item#>>'{}')::uuid END); value_ordinal:=value_ordinal+1; END LOOP;
    ELSE INSERT INTO api.dataset_row_values(row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id) VALUES(v_row_id,field.field_id,0,CASE WHEN field.logical_type='text' THEN effective#>>'{}' END,CASE WHEN field.logical_type='integer' THEN (effective#>>'{}')::bigint END,CASE WHEN field.logical_type='decimal' THEN (effective#>>'{}')::numeric END,CASE WHEN field.logical_type='boolean' THEN (effective#>>'{}')::boolean END,CASE WHEN field.logical_type='date' THEN (effective#>>'{}')::date END,CASE WHEN field.logical_type='timestamp' THEN (effective#>>'{}')::timestamptz END,CASE WHEN field.logical_type='category' THEN (effective#>>'{}')::uuid END,CASE WHEN field.logical_type='reference' THEN (effective#>>'{}')::uuid END); END IF;
   END IF;
  END LOOP;
  PERFORM internal.sync_dataset_value_system_flags(dataset.id,v_row_id,dataset.schema_version_id,item->'values');
 END LOOP;
 UPDATE api.datasets SET revision=revision+1,updated_at=now() WHERE id=dataset.id RETURNING revision INTO dataset.revision; result:=jsonb_build_object('ok',true,'datasetId',dataset.id,'datasetRevision',dataset.revision,'rows',result_rows,'idempotent',false); INSERT INTO api.dataset_bulk_commits(workspace_id,dataset_id,actor_user_id,actor_credential_id,idempotency_key,request_digest,result) VALUES(dataset.workspace_id,dataset.id,actor_user,actor_credential,p_idempotency_key,digest,result); RETURN result;
END $$;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';