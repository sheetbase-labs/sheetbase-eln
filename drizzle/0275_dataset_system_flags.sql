ALTER TABLE "api"."dataset_value_flags" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."dataset_value_flags" ADD CONSTRAINT "chk_dataset_value_flags_source" CHECK ("api"."dataset_value_flags"."source" IN ('manual', 'system'));--> statement-breakpoint

ALTER TABLE "api"."dataset_version_flags" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."dataset_version_flags" ADD CONSTRAINT "chk_dataset_version_flags_source" CHECK ("api"."dataset_version_flags"."source" IN ('manual', 'system'));--> statement-breakpoint
ALTER TABLE "api"."dataset_version_flags" DROP CONSTRAINT "dataset_version_flags_dataset_version_id_row_id_field_id_kind_pk";--> statement-breakpoint
ALTER TABLE "api"."dataset_version_flags" ADD CONSTRAINT "dataset_version_flags_dataset_version_id_row_id_field_id_kind_source_pk" PRIMARY KEY("dataset_version_id","row_id","field_id","kind","source");

-- DSET-01 step 1 — system rule-generated value flags.
--
-- A flag may be manual (set by a person with a reason through
-- `api.flag_dataset_value`) or system (derived from a Schema field rule during
-- validation, no person required). Both are the same table/model; `source`
-- distinguishes them and the active-flag uniqueness is scoped per source so a
-- system rule never overwrites or clears a manual decision on the same value.
-- The source is frozen into snapshots too, so a review can see which flags a
-- person set and which a rule derived.

DROP INDEX api.uq_dataset_value_flags_active;--> statement-breakpoint
CREATE UNIQUE INDEX uq_dataset_value_flags_active
  ON api.dataset_value_flags (dataset_id, row_id, field_id, kind, source)
  WHERE cleared_at IS NULL;--> statement-breakpoint

-- Manual flag RPC gains an explicit manual source and the per-source active index.

CREATE OR REPLACE FUNCTION api.flag_dataset_value(
  p_dataset_id uuid,
  p_row_id uuid,
  p_field_id uuid,
  p_kind text,
  p_reason text,
  p_comment text DEFAULT NULL
)
RETURNS api.dataset_value_flags
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  d api.datasets;
  v api.dataset_value_flags;
BEGIN
  IF p_kind NOT IN ('out_of_range', 'missing_unit', 'above_curve', 'high_cv') THEN
    RAISE EXCEPTION 'unknown flag kind' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'a reason is required to flag a value' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM api.datasets
    WHERE id = p_dataset_id AND workspace_id = api.current_workspace_id()
      AND api.is_workspace_writer(workspace_id) AND api.has_write_actor()
    FOR UPDATE;
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'Dataset denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.dataset_rows r
    WHERE r.id = p_row_id AND r.dataset_id = d.id
  ) THEN
    RAISE EXCEPTION 'row not found in Dataset' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.dataset_schema_version_fields f
    WHERE f.schema_version_id = d.schema_version_id AND f.field_id = p_field_id
  ) THEN
    RAISE EXCEPTION 'field not found in Dataset schema' USING ERRCODE = '22023';
  END IF;

  INSERT INTO api.dataset_value_flags
    (workspace_id, dataset_id, row_id, field_id, kind, source, reason, comment,
     set_by_user_id, set_at)
  VALUES
    (d.workspace_id, d.id, p_row_id, p_field_id, p_kind, 'manual', btrim(p_reason),
     nullif(btrim(coalesce(p_comment, '')), ''), api.current_user_id(), now())
  ON CONFLICT (dataset_id, row_id, field_id, kind, source) WHERE cleared_at IS NULL
  DO UPDATE SET reason = EXCLUDED.reason, comment = EXCLUDED.comment,
                set_by_user_id = EXCLUDED.set_by_user_id, set_at = now()
  RETURNING * INTO v;
  RETURN v;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION api.flag_dataset_value(uuid, uuid, uuid, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.flag_dataset_value(uuid, uuid, uuid, text, text, text) TO authenticated;--> statement-breakpoint


-- Derive system flags for one row from its Schema field rules, and clear the
-- active system flag when the value now passes. Only `source = 'system'` rows
-- are ever touched, so a manual flag on the same value is preserved. Writer
-- gated like the manual RPC; safe to call from validation and commit.
CREATE OR REPLACE FUNCTION internal.sync_dataset_value_system_flags(
  p_dataset_id uuid,
  p_row_id uuid,
  p_schema_version_id uuid,
  p_provided jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  field api.dataset_schema_version_fields;
  rule jsonb;
  effective jsonb;
  v_num numeric;
  lo numeric;
  hi numeric;
  violated boolean;
  v_reason text;
  workspace uuid;
BEGIN
  SELECT d.workspace_id INTO workspace FROM api.datasets d
    WHERE d.id = p_dataset_id AND d.workspace_id = api.current_workspace_id()
      AND api.is_workspace_writer(d.workspace_id) AND api.has_write_actor();
  IF workspace IS NULL THEN RETURN; END IF;
  FOR field IN
    SELECT * FROM api.dataset_schema_version_fields f
    WHERE f.schema_version_id = p_schema_version_id AND f.lifecycle = 'active'
    ORDER BY f.display_order
  LOOP
    rule := field.validation #> '{extensions,systemFlags,out_of_range}';
    violated := false;
    effective := NULL;
    IF p_provided ? field.field_id::text THEN
      effective := p_provided -> field.field_id::text;
    ELSE
      SELECT coalesce(to_jsonb(v.numeric_value), to_jsonb(v.integer_value))
        INTO effective
        FROM api.dataset_row_values v
        WHERE v.row_id = p_row_id AND v.field_id = field.field_id
        ORDER BY v.ordinal LIMIT 1;
      IF effective IS NULL THEN effective := field.default_value; END IF;
    END IF;
    IF rule IS NOT NULL AND jsonb_typeof(rule) = 'object'
       AND field.logical_type IN ('integer','decimal')
       AND effective IS NOT NULL AND jsonb_typeof(effective) = 'number' THEN
      v_num := (effective #>> '{}')::numeric;
      IF rule ? 'min' THEN
        lo := (rule ->> 'min')::numeric;
        IF v_num < lo THEN
          violated := true;
          v_reason := format('Value %s is below the minimum %s', v_num, lo);
        END IF;
      END IF;
      IF NOT violated AND rule ? 'max' THEN
        hi := (rule ->> 'max')::numeric;
        IF v_num > hi THEN
          violated := true;
          v_reason := format('Value %s is above the maximum %s', v_num, hi);
        END IF;
      END IF;
    END IF;
    IF violated THEN
      INSERT INTO api.dataset_value_flags
        (workspace_id, dataset_id, row_id, field_id, kind, source, reason,
         set_by_user_id, set_at)
      VALUES
        (workspace, p_dataset_id, p_row_id, field.field_id, 'out_of_range',
         'system', left(v_reason, 200), api.current_user_id(), now())
      ON CONFLICT (dataset_id, row_id, field_id, kind, source) WHERE cleared_at IS NULL
      DO UPDATE SET reason = left(EXCLUDED.reason, 200), set_at = now(),
                    comment = NULL, set_by_user_id = EXCLUDED.set_by_user_id;
    ELSE
      UPDATE api.dataset_value_flags
        SET cleared_at = now(), cleared_by_user_id = api.current_user_id()
        WHERE dataset_id = p_dataset_id AND row_id = p_row_id
          AND field_id = field.field_id AND kind = 'out_of_range'
          AND source = 'system' AND cleared_at IS NULL;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.sync_dataset_value_system_flags(uuid, uuid, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint

-- Validation derives system flags for values it can see stored on the row.

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
  IF jsonb_typeof(item)<>'object' OR item-ARRAY['operation','rowId','expectedRevision','values']<>'{}'::jsonb OR item->>'operation' NOT IN ('create','update') OR jsonb_typeof(item->'rowId')<>'string' OR jsonb_typeof(item->'values')<>'object' THEN RAISE EXCEPTION 'invalid Dataset batch row shape' USING ERRCODE='22023'; END IF;
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

-- Commit reconciles system flags after the values are written.

CREATE OR REPLACE FUNCTION api.commit_dataset_row_batch(p_dataset_id uuid, p_expected_dataset_revision bigint, p_rows jsonb, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE dataset api.datasets; existing api.dataset_bulk_commits; validation jsonb; digest text; actor_user text; actor_credential uuid; item jsonb; cell jsonb; entry jsonb; v_row_id uuid; v_field_id uuid; field api.dataset_schema_version_fields; result_rows jsonb:='[]'::jsonb; result jsonb; value_item jsonb; value_ordinal integer; effective jsonb;
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
 PERFORM 1 FROM api.dataset_rows r WHERE r.dataset_id=dataset.id AND r.id IN (SELECT (value->>'rowId')::uuid FROM jsonb_array_elements(p_rows)) ORDER BY r.id FOR UPDATE;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  v_row_id:=(item->>'rowId')::uuid;
  IF item->>'operation'='create' THEN INSERT INTO api.dataset_rows(id,dataset_id,workspace_id) VALUES(v_row_id,dataset.id,dataset.workspace_id); result_rows:=result_rows||jsonb_build_array(jsonb_build_object('rowId',v_row_id,'revision',1,'operation','create')); ELSE UPDATE api.dataset_rows SET revision=revision+1,updated_at=now() WHERE id=v_row_id; result_rows:=result_rows||jsonb_build_array(jsonb_build_object('rowId',v_row_id,'revision',(SELECT revision FROM api.dataset_rows WHERE id=v_row_id),'operation','update')); END IF;
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

-- Snapshots freeze the source too, so manual and system flags both survive.

CREATE OR REPLACE FUNCTION api.snapshot_dataset(p_dataset_id uuid, p_expected_dataset_revision bigint, p_label text)
RETURNS api.dataset_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE dataset api.datasets; version api.dataset_versions;
BEGIN
  SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_writer(workspace_id) FOR UPDATE;
  IF dataset.id IS NULL OR NOT api.has_write_actor() THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
  IF dataset.revision<>p_expected_dataset_revision THEN RAISE EXCEPTION 'stale Dataset revision' USING ERRCODE='SB001'; END IF;
  IF dataset.lifecycle<>'active' THEN RAISE EXCEPTION 'cannot snapshot archived Dataset' USING ERRCODE='22023'; END IF;
  INSERT INTO api.dataset_versions(dataset_id,workspace_id,schema_version_id,source_dataset_revision,label,created_by_user_id,created_by_credential_id)
  VALUES(dataset.id,dataset.workspace_id,dataset.schema_version_id,dataset.revision,p_label,api.current_user_id(),api.current_credential_id()) RETURNING * INTO version;
  INSERT INTO api.dataset_version_rows(dataset_version_id,row_id,revision)
  SELECT version.id,id,revision FROM api.dataset_rows WHERE dataset_id=dataset.id;
  INSERT INTO api.dataset_version_values(dataset_version_id,row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id)
  SELECT version.id,v.row_id,v.field_id,v.ordinal,v.text_value,v.integer_value,v.numeric_value,v.boolean_value,v.date_value,v.timestamp_value,v.category_option_id,v.reference_id
  FROM api.dataset_row_values v JOIN api.dataset_rows r ON r.id=v.row_id WHERE r.dataset_id=dataset.id;
  INSERT INTO api.dataset_version_flags(dataset_version_id,row_id,field_id,kind,source,reason,comment,set_by_user_id,set_at)
  SELECT version.id,f.row_id,f.field_id,f.kind,f.source,f.reason,f.comment,f.set_by_user_id,f.set_at
  FROM api.dataset_value_flags f
  WHERE f.dataset_id=dataset.id AND f.cleared_at IS NULL
    AND EXISTS (SELECT 1 FROM api.dataset_version_rows vr WHERE vr.dataset_version_id=version.id AND vr.row_id=f.row_id);
  RETURN version;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.snapshot_dataset(uuid, bigint, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.snapshot_dataset(uuid, bigint, text) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.snapshot_dataset(uuid, bigint, text) TO api_client;--> statement-breakpoint


NOTIFY pgrst, 'reload schema';
