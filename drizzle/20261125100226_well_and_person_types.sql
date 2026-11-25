-- Well position and person become field types for model fields, dataset
-- columns and sheet columns.
--
-- A well position is a plate address such as A1 or H12, stored in the
-- canonical form A1 (a01, A01 and "a 1" are all A1), for plates up to 1536
-- wells (rows A to AF, columns 1 to 48). It sorts row by row, so A2 comes
-- before A10. A person is someone in the workspace, stored as their user id
-- and shown by name; it sorts by name. Every write path checks both in the
-- database.

-- Canonical A1 form for a typed well position, or NULL when it is not one.
CREATE FUNCTION internal.lab_well_or_null(p_value text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE m text[]; row_label text; row_no integer; col integer;
BEGIN
  m := regexp_match(upper(regexp_replace(coalesce(p_value, ''), '\s', '', 'g')), '^([A-Z]{1,2})0*([1-9][0-9]?)$');
  IF m IS NULL THEN RETURN NULL; END IF;
  row_label := m[1];
  row_no := CASE WHEN length(row_label) = 1 THEN ascii(row_label) - 64
                 ELSE (ascii(left(row_label, 1)) - 64) * 26 + ascii(right(row_label, 1)) - 64 END;
  col := m[2]::integer;
  IF row_no > 32 OR col > 48 THEN RETURN NULL; END IF;
  RETURN row_label || col::text;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_well_or_null(text) OWNER TO migrator;
--> statement-breakpoint

-- Canonical well position, or an error that says what a well looks like.
CREATE FUNCTION internal.lab_well_text(p_value text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE v text := internal.lab_well_or_null(p_value);
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'Use a well position such as A1 or H12, not %', coalesce(p_value, 'nothing') USING ERRCODE = 'SB071';
  END IF;
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_well_text(text) OWNER TO migrator;
--> statement-breakpoint

-- Row-major order for a stored well position: A1, A2 ... A12, B1.
CREATE FUNCTION internal.lab_well_sort_key(p_value text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE WHEN m IS NULL THEN NULL ELSE
    (CASE WHEN length(m[1]) = 1 THEN ascii(m[1]) - 64
          ELSE (ascii(left(m[1], 1)) - 64) * 26 + ascii(right(m[1], 1)) - 64 END) * 100 + m[2]::integer END
  FROM regexp_match(p_value, '^([A-Z]{1,2})([0-9]{1,2})$') AS m
$$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_well_sort_key(text) OWNER TO migrator;
--> statement-breakpoint

-- True when the user is a person (not an API client) with an active
-- membership of the workspace.
CREATE FUNCTION internal.lab_is_workspace_person(p_workspace_id uuid, p_user_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
     WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user_id
       AND m.suspended_at IS NULL AND m.client_id IS NULL)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_is_workspace_person(uuid, text) OWNER TO migrator;
--> statement-breakpoint

-- The name a person column sorts by.
CREATE FUNCTION internal.lab_person_sort_name(p_user_id text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT lower(u.name) FROM internal."user" u WHERE u.id = p_user_id
$$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_person_sort_name(text) OWNER TO migrator;
--> statement-breakpoint

ALTER TABLE api.record_field_definitions DROP CONSTRAINT chk_record_field_definitions_type;
--> statement-breakpoint
ALTER TABLE api.record_field_definitions ADD CONSTRAINT chk_record_field_definitions_type CHECK (logical_type = ANY (ARRAY['text', 'integer', 'decimal', 'boolean', 'date', 'timestamp', 'time', 'duration', 'well', 'person', 'category', 'reference']));
--> statement-breakpoint
ALTER TABLE api.dataset_schema_version_fields DROP CONSTRAINT chk_dataset_schema_version_fields_type;
--> statement-breakpoint
ALTER TABLE api.dataset_schema_version_fields ADD CONSTRAINT chk_dataset_schema_version_fields_type CHECK (logical_type = ANY (ARRAY['text', 'integer', 'decimal', 'boolean', 'date', 'timestamp', 'time', 'duration', 'well', 'person', 'category', 'reference']));
--> statement-breakpoint
ALTER TABLE api.dataset_schema_fields DROP CONSTRAINT chk_dataset_schema_fields_type;
--> statement-breakpoint
ALTER TABLE api.dataset_schema_fields ADD CONSTRAINT chk_dataset_schema_fields_type CHECK (logical_type = ANY (ARRAY['text', 'integer', 'decimal', 'boolean', 'date', 'timestamp', 'time', 'duration', 'well', 'person', 'category', 'reference']));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.dataset_batch_cell_error(p_workspace_id uuid, p_field api.dataset_schema_version_fields, p_value jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE item jsonb; target_model text;
BEGIN
  IF p_value IS NULL OR p_value='null'::jsonb THEN
    RETURN CASE WHEN p_field.nullable THEN NULL ELSE 'required_value' END;
  END IF;
  -- The canonical kernel deliberately has no many-valued defaults. Treat a
  -- malformed stored default as invalid rather than letting it satisfy required.
  IF p_field.cardinality='many' AND p_value IS NOT NULL AND p_value <> 'null'::jsonb
     AND p_value = p_field.default_value THEN RETURN 'invalid_default'; END IF;
  IF p_field.cardinality='many' THEN
    IF jsonb_typeof(p_value)<>'array' OR jsonb_array_length(p_value)=0 THEN RETURN 'invalid_cardinality'; END IF;
  ELSIF jsonb_typeof(p_value)='array' THEN RETURN 'invalid_cardinality'; END IF;
  FOR item IN
    SELECT value FROM jsonb_array_elements(CASE WHEN p_field.cardinality='many' THEN p_value ELSE '[]'::jsonb END)
    UNION ALL SELECT p_value WHERE p_field.cardinality='one'
  LOOP
    IF (p_field.logical_type IN ('text','time','well','person') AND jsonb_typeof(item)<>'string') OR
       (p_field.logical_type IN ('integer','decimal','duration') AND jsonb_typeof(item)<>'number') OR
       (p_field.logical_type='boolean' AND jsonb_typeof(item)<>'boolean') OR
       (p_field.logical_type IN ('date','timestamp','category','reference') AND jsonb_typeof(item)<>'string') THEN RETURN 'invalid_value_type'; END IF;
    BEGIN
      IF p_field.logical_type='integer' THEN PERFORM (item#>>'{}')::bigint;
      ELSIF p_field.logical_type='decimal' THEN PERFORM (item#>>'{}')::numeric;
      ELSIF p_field.logical_type='date' THEN PERFORM (item#>>'{}')::date;
      ELSIF p_field.logical_type='timestamp' THEN PERFORM (item#>>'{}')::timestamptz;
      ELSIF p_field.logical_type IN ('category','reference') THEN PERFORM (item#>>'{}')::uuid;
      ELSIF p_field.logical_type='time' THEN PERFORM internal.lab_time_text(item#>>'{}');
      ELSIF p_field.logical_type='duration' THEN PERFORM internal.lab_duration_seconds(item);
      ELSIF p_field.logical_type='well' THEN PERFORM internal.lab_well_text(item#>>'{}');
      END IF;
    EXCEPTION WHEN others THEN RETURN 'invalid_value'; END;
    IF p_field.logical_type='text' AND ((p_field.validation ? 'minLength' AND length(item#>>'{}')<(p_field.validation->>'minLength')::integer) OR (p_field.validation ? 'maxLength' AND length(item#>>'{}')>(p_field.validation->>'maxLength')::integer) OR (p_field.validation ? 'pattern' AND item#>>'{}' !~ (p_field.validation->>'pattern'))) THEN RETURN 'text_validation'; END IF;
    -- A number outside the allowed range is stored and flagged, not refused.
    IF p_field.logical_type='category' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_field.category->'options','[]'::jsonb)) option WHERE option->>'id'=item#>>'{}' AND option->>'lifecycle'='active') THEN RETURN 'invalid_category_option'; END IF;
    IF p_field.logical_type='person' AND NOT internal.lab_is_workspace_person(p_workspace_id,item#>>'{}') THEN RETURN 'invalid_person'; END IF;
    IF p_field.logical_type='reference' THEN
      target_model:=coalesce(p_field.relationship->'target'->>'modelKey',p_field.validation->>'targetModelKey');
      IF target_model IS NULL OR NOT internal.record_matches_model((item#>>'{}')::uuid,p_workspace_id,target_model) THEN RETURN 'invalid_reference'; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.validate_dataset_row_value()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE field api.dataset_schema_version_fields; slots integer; target_model text;
BEGIN
 SELECT f.* INTO field FROM api.dataset_rows r JOIN api.datasets d ON d.id=r.dataset_id JOIN api.dataset_schema_version_fields f ON f.schema_version_id=d.schema_version_id AND f.field_id=NEW.field_id WHERE r.id=NEW.row_id;
 IF field.id IS NULL OR field.lifecycle <> 'active' THEN RAISE EXCEPTION 'unknown active Dataset field' USING ERRCODE='22023'; END IF;
 IF field.cardinality='one' AND NEW.ordinal<>0 THEN RAISE EXCEPTION 'scalar Dataset fields require ordinal zero' USING ERRCODE='22023'; END IF;
 slots := (NEW.text_value IS NOT NULL)::int+(NEW.integer_value IS NOT NULL)::int+(NEW.numeric_value IS NOT NULL)::int+(NEW.boolean_value IS NOT NULL)::int+(NEW.date_value IS NOT NULL)::int+(NEW.timestamp_value IS NOT NULL)::int+(NEW.category_option_id IS NOT NULL)::int+(NEW.reference_id IS NOT NULL)::int;
 IF slots <> 1 THEN RAISE EXCEPTION 'exactly one typed Dataset value is required' USING ERRCODE='22023'; END IF;
 IF (field.logical_type IN ('text','time','well','person') AND NEW.text_value IS NULL) OR (field.logical_type='integer' AND NEW.integer_value IS NULL) OR (field.logical_type IN ('decimal','duration') AND NEW.numeric_value IS NULL) OR (field.logical_type='boolean' AND NEW.boolean_value IS NULL) OR (field.logical_type='date' AND NEW.date_value IS NULL) OR (field.logical_type='timestamp' AND NEW.timestamp_value IS NULL) OR (field.logical_type='category' AND NEW.category_option_id IS NULL) OR (field.logical_type='reference' AND NEW.reference_id IS NULL) THEN RAISE EXCEPTION 'Dataset value does not match field logical type' USING ERRCODE='22023'; END IF;
 IF field.logical_type='text' AND ((field.validation ? 'minLength' AND length(NEW.text_value)<(field.validation->>'minLength')::integer) OR (field.validation ? 'maxLength' AND length(NEW.text_value)>(field.validation->>'maxLength')::integer) OR (field.validation ? 'pattern' AND NEW.text_value !~ (field.validation->>'pattern'))) THEN RAISE EXCEPTION 'text validation failed' USING ERRCODE='SB071'; END IF;
 IF field.logical_type='time' AND NEW.text_value IS DISTINCT FROM internal.lab_time_text(NEW.text_value) THEN RAISE EXCEPTION 'time values are stored as HH:MM:SS' USING ERRCODE='SB071'; END IF;
 IF field.logical_type='duration' THEN PERFORM internal.lab_duration_seconds(to_jsonb(NEW.numeric_value)); END IF;
 IF field.logical_type='well' AND NEW.text_value IS DISTINCT FROM internal.lab_well_text(NEW.text_value) THEN RAISE EXCEPTION 'well positions are stored as A1' USING ERRCODE='SB071'; END IF;
 IF field.logical_type='person' AND NOT EXISTS (SELECT 1 FROM api.dataset_rows r WHERE r.id=NEW.row_id AND internal.lab_is_workspace_person(r.workspace_id,NEW.text_value)) THEN RAISE EXCEPTION 'person is not a member of this workspace' USING ERRCODE='SB071'; END IF;
 -- A number outside the allowed range is stored and flagged, not refused.
 IF field.logical_type='category' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(field.category->'options','[]'::jsonb)) o WHERE o->>'id'=NEW.category_option_id::text AND o->>'lifecycle'='active') THEN RAISE EXCEPTION 'category option is not active for this field' USING ERRCODE='SB071'; END IF;
 IF field.logical_type='reference' THEN
   target_model := coalesce(field.relationship->'target'->>'modelKey',field.validation->>'targetModelKey');
   IF target_model IS NULL OR NOT EXISTS (SELECT 1 FROM api.dataset_rows r WHERE r.id=NEW.row_id AND internal.record_matches_model(NEW.reference_id,r.workspace_id,target_model)) THEN RAISE EXCEPTION 'reference does not target an active compatible Record' USING ERRCODE='SB071'; END IF;
 END IF;
 RETURN NEW;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.commit_dataset_row_batch(p_dataset_id uuid, p_expected_dataset_revision bigint, p_rows jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE dataset api.datasets; existing api.dataset_bulk_commits; validation jsonb; digest text; actor_user text; actor_credential uuid; item jsonb; cell jsonb; entry jsonb; v_row_id uuid; v_planned_id uuid; v_field_id uuid; field api.dataset_schema_version_fields; result_rows jsonb:='[]'::jsonb; result jsonb; value_item jsonb; value_ordinal integer; effective jsonb; audit_old jsonb; audit_changes jsonb; audit_sources jsonb:='[]';
BEGIN IF api.has_capability(api.current_workspace_id(), 'work.datasets') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.datasets' USING ERRCODE = '42501'; END IF; -- capability-guard
 IF p_dataset_id IS NOT NULL THEN PERFORM internal.assert_object_access('dataset',p_dataset_id,'edit'); END IF;
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
  audit_changes:='{}'; FOR field IN SELECT * FROM api.dataset_schema_version_fields WHERE schema_version_id=dataset.schema_version_id AND lifecycle='active' LOOP
   effective:=item->'values'->field.field_id::text;
   IF effective IS NULL AND item->>'operation'='update' THEN CONTINUE; END IF;
   IF effective IS NULL AND item->>'operation'='create' AND field.default_value IS NOT NULL AND field.default_value<>'null'::jsonb THEN effective:=field.default_value; END IF;
   IF effective='null'::jsonb AND NOT field.nullable THEN effective:=field.default_value; END IF;
   IF effective IS NULL THEN CONTINUE; END IF;
   
    SELECT CASE WHEN count(*)=0 THEN 'null'::jsonb WHEN field.cardinality='many' THEN
      jsonb_agg(coalesce(to_jsonb(text_value),to_jsonb(integer_value),to_jsonb(numeric_value),to_jsonb(boolean_value),to_jsonb(date_value),to_jsonb(timestamp_value),to_jsonb(category_option_id),to_jsonb(reference_id)) ORDER BY ordinal)
      ELSE (jsonb_agg(coalesce(to_jsonb(text_value),to_jsonb(integer_value),to_jsonb(numeric_value),to_jsonb(boolean_value),to_jsonb(date_value),to_jsonb(timestamp_value),to_jsonb(category_option_id),to_jsonb(reference_id)) ORDER BY ordinal))->0 END
      INTO audit_old FROM api.dataset_row_values WHERE row_id=v_row_id AND field_id=field.field_id;
    IF audit_old IS DISTINCT FROM effective THEN
      audit_changes:=audit_changes||jsonb_build_object(field.field_id,jsonb_build_object(
        'label',field.label,'fieldId',field.field_id,'from',audit_old,'to',effective));
    END IF;
    DELETE FROM api.dataset_row_values WHERE row_id=v_row_id AND field_id=field.field_id;
  
   IF effective<>'null'::jsonb THEN
    IF field.cardinality='many' THEN value_ordinal:=0; FOR value_item IN SELECT value FROM jsonb_array_elements(effective) LOOP INSERT INTO api.dataset_row_values(row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id) VALUES(v_row_id,field.field_id,value_ordinal,CASE WHEN field.logical_type='text' THEN value_item#>>'{}' WHEN field.logical_type='time' THEN internal.lab_time_text(value_item#>>'{}') WHEN field.logical_type='well' THEN internal.lab_well_text(value_item#>>'{}') WHEN field.logical_type='person' THEN value_item#>>'{}' END,CASE WHEN field.logical_type='integer' THEN (value_item#>>'{}')::bigint END,CASE WHEN field.logical_type IN ('decimal','duration') THEN (value_item#>>'{}')::numeric END,CASE WHEN field.logical_type='boolean' THEN (value_item#>>'{}')::boolean END,CASE WHEN field.logical_type='date' THEN (value_item#>>'{}')::date END,CASE WHEN field.logical_type='timestamp' THEN (value_item#>>'{}')::timestamptz END,CASE WHEN field.logical_type='category' THEN (value_item#>>'{}')::uuid END,CASE WHEN field.logical_type='reference' THEN (value_item#>>'{}')::uuid END); value_ordinal:=value_ordinal+1; END LOOP;
    ELSE INSERT INTO api.dataset_row_values(row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id) VALUES(v_row_id,field.field_id,0,CASE WHEN field.logical_type='text' THEN effective#>>'{}' WHEN field.logical_type='time' THEN internal.lab_time_text(effective#>>'{}') WHEN field.logical_type='well' THEN internal.lab_well_text(effective#>>'{}') WHEN field.logical_type='person' THEN effective#>>'{}' END,CASE WHEN field.logical_type='integer' THEN (effective#>>'{}')::bigint END,CASE WHEN field.logical_type IN ('decimal','duration') THEN (effective#>>'{}')::numeric END,CASE WHEN field.logical_type='boolean' THEN (effective#>>'{}')::boolean END,CASE WHEN field.logical_type='date' THEN (effective#>>'{}')::date END,CASE WHEN field.logical_type='timestamp' THEN (effective#>>'{}')::timestamptz END,CASE WHEN field.logical_type='category' THEN (effective#>>'{}')::uuid END,CASE WHEN field.logical_type='reference' THEN (effective#>>'{}')::uuid END); END IF;
   END IF;
  END LOOP;
  PERFORM internal.sync_dataset_value_system_flags(dataset.id,v_row_id,dataset.schema_version_id,item->'values');
    IF audit_changes<>'{}'::jsonb THEN audit_sources:=audit_sources||internal.emit_dataset_row_audit(dataset,v_row_id,audit_changes,nullif(btrim(item->>'reason'),'')); END IF;
  
 END LOOP;
 PERFORM internal.reconcile_dataset_high_cv(dataset.id,dataset.schema_version_id);
 UPDATE api.datasets SET revision=revision+1,updated_at=now() WHERE id=dataset.id RETURNING revision INTO dataset.revision; result:=jsonb_build_object('ok',true,'datasetId',dataset.id,'datasetRevision',dataset.revision,'rows',result_rows,'sourceEvents',audit_sources,'idempotent',false); PERFORM internal.emit_dataset_analysis_staleness(dataset,p_expected_dataset_revision,audit_sources); INSERT INTO api.dataset_bulk_commits(workspace_id,dataset_id,actor_user_id,actor_credential_id,idempotency_key,request_digest,result) VALUES(dataset.workspace_id,dataset.id,actor_user,actor_credential,p_idempotency_key,digest,result); RETURN result;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.dataset_version_rows_json(p_version_id uuid, p_limit integer DEFAULT 50000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_version api.dataset_versions;
  v_total bigint;
  v_rows jsonb;
  v_columns jsonb;
BEGIN
  SELECT * INTO v_version FROM api.dataset_versions
   WHERE id = p_version_id AND workspace_id = api.current_workspace_id();
  IF v_version.id IS NULL OR NOT api.is_workspace_member(v_version.workspace_id) THEN
    RAISE EXCEPTION 'dataset version not found' USING ERRCODE = 'SB015';
  END IF;
  PERFORM internal.assert_object_access('dataset', v_version.dataset_id, 'view');
  IF coalesce(p_limit, 0) NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'ask for between 1 and 100000 rows' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_total FROM api.dataset_version_rows WHERE dataset_version_id = p_version_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', f.key, 'label', f.label, 'type', f.logical_type)
                            ORDER BY f.display_order, f.key), '[]'::jsonb)
    INTO v_columns
    FROM api.dataset_schema_version_fields f
   WHERE f.schema_version_id = v_version.schema_version_id AND f.lifecycle = 'active';
  SELECT coalesce(jsonb_agg(row_doc ORDER BY row_id), '[]'::jsonb) INTO v_rows FROM (
    SELECT r.row_id,
           coalesce(jsonb_object_agg(f.key,
             CASE f.logical_type
               WHEN 'text' THEN to_jsonb(v.text_value)
               WHEN 'time' THEN to_jsonb(v.text_value)
               WHEN 'well' THEN to_jsonb(v.text_value)
               WHEN 'person' THEN to_jsonb(v.text_value)
               WHEN 'duration' THEN to_jsonb(v.numeric_value)
               WHEN 'integer' THEN to_jsonb(v.integer_value)
               WHEN 'decimal' THEN to_jsonb(v.numeric_value)
               WHEN 'boolean' THEN to_jsonb(v.boolean_value)
               WHEN 'date' THEN to_jsonb(v.date_value)
               WHEN 'timestamp' THEN to_jsonb(v.timestamp_value)
               WHEN 'category' THEN to_jsonb(v.category_option_id)
               ELSE to_jsonb(v.reference_id) END
           ) FILTER (WHERE f.key IS NOT NULL), '{}'::jsonb) AS row_doc
      FROM (SELECT row_id FROM api.dataset_version_rows
             WHERE dataset_version_id = p_version_id ORDER BY row_id LIMIT p_limit) r
      LEFT JOIN api.dataset_version_values v
        ON v.dataset_version_id = p_version_id AND v.row_id = r.row_id
       AND NOT EXISTS (SELECT 1 FROM api.dataset_version_flags fl
                        WHERE fl.dataset_version_id = v.dataset_version_id
                          AND fl.row_id = v.row_id AND fl.field_id = v.field_id)
      LEFT JOIN api.dataset_schema_version_fields f
        ON f.schema_version_id = v_version.schema_version_id AND f.field_id = v.field_id AND f.lifecycle = 'active'
     GROUP BY r.row_id
  ) q;
  RETURN jsonb_build_object('versionId', v_version.id, 'datasetId', v_version.dataset_id,
                            'label', v_version.label, 'columns', v_columns,
                            'rowCount', v_total, 'truncated', v_total > p_limit, 'rows', v_rows);
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.record_results(p_record_id uuid, p_include_snapshots boolean DEFAULT false, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_workspace uuid;
  v_total bigint;
  v_rows jsonb;
BEGIN
  PERFORM internal.assert_object_access('record', p_record_id, 'view');
  v_workspace := api.current_workspace_id();
  IF v_workspace IS NULL OR NOT EXISTS (
    SELECT 1 FROM api.records WHERE id = p_record_id AND workspace_id = v_workspace AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'invalid results window' USING ERRCODE = '22023';
  END IF;

  -- Which datasets hold a row linking here, and the person may see.
  WITH hits AS MATERIALIZED (
    SELECT row_number() OVER (ORDER BY h.recorded_at DESC NULLS LAST, h.row_id, h.version_id)::integer AS hit,
           h.dataset_id, h.row_id, h.version_id, h.version_label, h.schema_version_id, h.recorded_at, h.status
      FROM (
        SELECT DISTINCT r.dataset_id, r.id AS row_id, NULL::uuid AS version_id, NULL::text AS version_label,
               d.schema_version_id, r.updated_at AS recorded_at, r.status
          FROM api.dataset_row_values lv
          JOIN api.dataset_rows r ON r.id = lv.row_id
          JOIN api.datasets d ON d.id = r.dataset_id AND d.workspace_id = v_workspace AND d.lifecycle = 'active'
         WHERE lv.reference_id = p_record_id
        UNION ALL
        SELECT DISTINCT v.dataset_id, vv.row_id, v.id, v.label,
               v.schema_version_id, v.created_at, 'recorded'::text
          FROM api.dataset_version_values vv
          JOIN api.dataset_versions v ON v.id = vv.dataset_version_id AND v.workspace_id = v_workspace
          JOIN api.datasets d ON d.id = v.dataset_id AND d.lifecycle = 'active'
         WHERE p_include_snapshots AND vv.reference_id = p_record_id
      ) h
     WHERE internal.can_access_object('dataset', h.dataset_id, 'view')
  )
  SELECT (SELECT count(*) FROM hits), coalesce(jsonb_agg(item ORDER BY hit), '[]'::jsonb) INTO v_total, v_rows
    FROM (
      SELECT h.hit,
        jsonb_build_object(
          'rowId', h.row_id,
          'datasetId', d.id,
          'datasetDisplayId', d.display_id,
          'datasetName', d.name,
          'tableId', sd.id,
          'tableKey', sd.key,
          'tableName', sd.name,
          'tableVersion', sv.version,
          'source', CASE WHEN h.version_id IS NULL THEN 'live' ELSE 'snapshot' END,
          'snapshotId', h.version_id,
          'snapshotLabel', h.version_label,
          'status', h.status,
          'recordedAt', h.recorded_at,
          'values', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                     'fieldId', f.field_id,
                     'key', f.key,
                     'label', f.label,
                     'type', f.logical_type,
                     'unit', coalesce(f.quantity->>'symbol', f.quantity->>'storageUnit'),
                     'linksHere', f.logical_type = 'reference' AND x.vals @> to_jsonb(p_record_id::text),
                     'value', CASE WHEN f.cardinality = 'many' THEN x.vals ELSE x.vals->0 END
                   ) ORDER BY f.display_order)
              FROM api.dataset_schema_version_fields f
              JOIN LATERAL (
                SELECT jsonb_agg(
                         CASE f.logical_type
                           WHEN 'text' THEN to_jsonb(c.text_value)
                           WHEN 'time' THEN to_jsonb(c.text_value)
                           WHEN 'well' THEN to_jsonb(c.text_value)
                           WHEN 'person' THEN to_jsonb(c.text_value)
                           WHEN 'duration' THEN to_jsonb(c.numeric_value)
                           WHEN 'integer' THEN to_jsonb(c.integer_value)
                           WHEN 'decimal' THEN to_jsonb(c.numeric_value)
                           WHEN 'boolean' THEN to_jsonb(c.boolean_value)
                           WHEN 'date' THEN to_jsonb(c.date_value)
                           WHEN 'timestamp' THEN to_jsonb(c.timestamp_value)
                           WHEN 'category' THEN to_jsonb(coalesce(
                             (SELECT o->>'label' FROM jsonb_array_elements(coalesce(f.category->'options', '[]'::jsonb)) o
                               WHERE o->>'id' = c.category_option_id::text LIMIT 1),
                             c.category_option_id::text))
                           WHEN 'reference' THEN to_jsonb(c.reference_id::text)
                           ELSE to_jsonb(coalesce(c.numeric_value::text, c.integer_value::text, c.text_value))
                         END
                         ORDER BY c.ordinal) AS vals
                  FROM (
                    SELECT t.ordinal, t.text_value, t.integer_value, t.numeric_value, t.boolean_value, t.date_value,
                           t.timestamp_value, t.category_option_id, t.reference_id
                      FROM api.dataset_row_values t
                     WHERE h.version_id IS NULL AND t.row_id = h.row_id AND t.field_id = f.field_id
                    UNION ALL
                    SELECT t.ordinal, t.text_value, t.integer_value, t.numeric_value, t.boolean_value, t.date_value,
                           t.timestamp_value, t.category_option_id, t.reference_id
                      FROM api.dataset_version_values t
                     WHERE h.version_id IS NOT NULL AND t.dataset_version_id = h.version_id
                       AND t.row_id = h.row_id AND t.field_id = f.field_id
                  ) c
              ) x ON x.vals IS NOT NULL
             WHERE f.schema_version_id = h.schema_version_id
          ), '[]'::jsonb)
        ) AS item
        FROM hits h
        JOIN api.datasets d ON d.id = h.dataset_id
        JOIN api.dataset_schema_versions sv ON sv.id = h.schema_version_id
        JOIN api.dataset_schema_definitions sd ON sd.id = sv.schema_id
       ORDER BY h.hit
       LIMIT p_limit OFFSET p_offset
    ) page;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.query_dataset_rows(p_dataset_id uuid, p_query jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE dataset api.datasets; filter_item jsonb; sort_item jsonb; field api.dataset_schema_version_fields; filter_sql text := ''; base_sql text; sort_sql text := 'r.id'; sort_direction text := 'ASC'; value_column text; total_count bigint; rows jsonb; v_field_id uuid; operator text; value_text text;
BEGIN
 IF p_dataset_id IS NOT NULL THEN PERFORM internal.assert_object_access('dataset',p_dataset_id,'view'); END IF;
 SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id); IF dataset.id IS NULL THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_query) IS DISTINCT FROM 'object' OR p_query-ARRAY['filters','sort']<>'{}'::jsonb OR (p_query ? 'filters' AND jsonb_typeof(p_query->'filters') IS DISTINCT FROM 'array') OR (p_query ? 'sort' AND jsonb_typeof(p_query->'sort') IS DISTINCT FROM 'object') THEN RAISE EXCEPTION 'invalid Dataset query shape' USING ERRCODE='22023'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'Dataset query limit must be 1 to 1000 and offset non-negative' USING ERRCODE='22023'; END IF;
 IF coalesce(jsonb_array_length(p_query->'filters'),0)>8 THEN RAISE EXCEPTION 'Dataset query supports at most eight filters' USING ERRCODE='22023'; END IF;
 FOR filter_item IN SELECT value FROM jsonb_array_elements(coalesce(p_query->'filters','[]'::jsonb)) LOOP
  IF jsonb_typeof(filter_item)<>'object' OR filter_item-ARRAY['fieldId','operator','value']<>'{}'::jsonb OR jsonb_typeof(filter_item->'fieldId')<>'string' OR jsonb_typeof(filter_item->'operator')<>'string' OR NOT filter_item?'value' THEN RAISE EXCEPTION 'invalid Dataset filter shape' USING ERRCODE='22023'; END IF;
  BEGIN v_field_id:=(filter_item->>'fieldId')::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid Dataset field id' USING ERRCODE='22023'; END; SELECT * INTO field FROM api.dataset_schema_version_fields f WHERE f.schema_version_id=dataset.schema_version_id AND f.field_id=v_field_id AND f.lifecycle='active'; IF field.id IS NULL THEN RAISE EXCEPTION 'unknown active Dataset field' USING ERRCODE='22023'; END IF; operator:=filter_item->>'operator'; IF operator NOT IN ('eq','gt','gte','lt','lte') OR (operator<>'eq' AND field.logical_type NOT IN ('integer','decimal','date','timestamp','time','duration')) THEN RAISE EXCEPTION 'unsupported Dataset filter operator' USING ERRCODE='22023'; END IF; value_text:=filter_item->'value'#>>'{}'; BEGIN IF field.logical_type='integer' THEN PERFORM value_text::bigint; ELSIF field.logical_type='decimal' THEN PERFORM value_text::numeric; ELSIF field.logical_type='boolean' THEN PERFORM value_text::boolean; ELSIF field.logical_type='date' THEN PERFORM value_text::date; ELSIF field.logical_type='timestamp' THEN PERFORM value_text::timestamptz; ELSIF field.logical_type='time' THEN value_text:=internal.lab_time_text(value_text); ELSIF field.logical_type='duration' THEN PERFORM internal.lab_duration_seconds(to_jsonb(value_text::numeric)); ELSIF field.logical_type='well' THEN value_text:=internal.lab_well_text(value_text); ELSIF field.logical_type IN ('category','reference') THEN PERFORM value_text::uuid; END IF; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Dataset filter value does not match field type' USING ERRCODE='22023'; END; value_column:=CASE field.logical_type WHEN 'text' THEN 'text_value' WHEN 'time' THEN 'text_value' WHEN 'well' THEN 'text_value' WHEN 'person' THEN 'text_value' WHEN 'duration' THEN 'numeric_value' WHEN 'integer' THEN 'integer_value' WHEN 'decimal' THEN 'numeric_value' WHEN 'boolean' THEN 'boolean_value' WHEN 'date' THEN 'date_value' WHEN 'timestamp' THEN 'timestamp_value' WHEN 'category' THEN 'category_option_id' ELSE 'reference_id' END; filter_sql:=filter_sql||format(' AND EXISTS (SELECT 1 FROM api.dataset_row_values v WHERE v.row_id=r.id AND v.field_id=%L::uuid AND v.%I %s %L::%s)',v_field_id,value_column,CASE operator WHEN 'eq' THEN '=' WHEN 'gt' THEN '>' WHEN 'gte' THEN '>=' WHEN 'lt' THEN '<' ELSE '<=' END,value_text,CASE field.logical_type WHEN 'integer' THEN 'bigint' WHEN 'decimal' THEN 'numeric' WHEN 'duration' THEN 'numeric' WHEN 'boolean' THEN 'boolean' WHEN 'date' THEN 'date' WHEN 'timestamp' THEN 'timestamptz' WHEN 'category' THEN 'uuid' WHEN 'reference' THEN 'uuid' ELSE 'text' END);
 END LOOP;
 IF p_query ? 'sort' THEN sort_item:=p_query->'sort'; IF sort_item-ARRAY['fieldId','direction']<>'{}'::jsonb OR jsonb_typeof(sort_item->'fieldId') IS DISTINCT FROM 'string' OR jsonb_typeof(sort_item->'direction') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid Dataset sort shape' USING ERRCODE='22023'; END IF; BEGIN v_field_id:=(sort_item->>'fieldId')::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid Dataset field id' USING ERRCODE='22023'; END; SELECT * INTO field FROM api.dataset_schema_version_fields f WHERE f.schema_version_id=dataset.schema_version_id AND f.field_id=v_field_id AND f.lifecycle='active'; IF field.id IS NULL OR sort_item->>'direction' NOT IN ('asc','desc') THEN RAISE EXCEPTION 'invalid Dataset sort shape' USING ERRCODE='22023'; END IF; value_column:=CASE field.logical_type WHEN 'text' THEN 'text_value' WHEN 'time' THEN 'text_value' WHEN 'well' THEN 'text_value' WHEN 'person' THEN 'text_value' WHEN 'duration' THEN 'numeric_value' WHEN 'integer' THEN 'integer_value' WHEN 'decimal' THEN 'numeric_value' WHEN 'boolean' THEN 'boolean_value' WHEN 'date' THEN 'date_value' WHEN 'timestamp' THEN 'timestamp_value' WHEN 'category' THEN 'category_option_id' ELSE 'reference_id' END; sort_sql:=format('(SELECT %s FROM api.dataset_row_values v WHERE v.row_id=r.id AND v.field_id=%L::uuid ORDER BY v.ordinal LIMIT 1)',CASE field.logical_type WHEN 'well' THEN 'internal.lab_well_sort_key(v.text_value)' WHEN 'person' THEN 'internal.lab_person_sort_name(v.text_value)' ELSE format('v.%I',value_column) END,v_field_id); sort_direction:=upper(sort_item->>'direction'); END IF;
 base_sql:=format(' FROM api.dataset_rows r WHERE r.dataset_id=%L::uuid',dataset.id)||filter_sql; EXECUTE 'SELECT count(*)'||base_sql INTO total_count;
 EXECUTE 'SELECT coalesce(jsonb_agg(jsonb_build_object(''rowId'',p.id,''revision'',p.revision,''values'',p.values) ORDER BY p.sort_value '||sort_direction||' NULLS LAST,p.id),''[]''::jsonb) FROM (SELECT r.id,r.revision,'||sort_sql||' AS sort_value,(SELECT coalesce(jsonb_object_agg(f.field_id::text,CASE WHEN f.cardinality=''many'' THEN coalesce((SELECT jsonb_agg(coalesce(to_jsonb(v.text_value),to_jsonb(v.integer_value),to_jsonb(v.numeric_value),to_jsonb(v.boolean_value),to_jsonb(v.date_value),to_jsonb(v.timestamp_value),to_jsonb(v.category_option_id),to_jsonb(v.reference_id)) ORDER BY v.ordinal) FROM api.dataset_row_values v WHERE v.row_id=r.id AND v.field_id=f.field_id),''[]''::jsonb) ELSE (SELECT coalesce(to_jsonb(v.text_value),to_jsonb(v.integer_value),to_jsonb(v.numeric_value),to_jsonb(v.boolean_value),to_jsonb(v.date_value),to_jsonb(v.timestamp_value),to_jsonb(v.category_option_id),to_jsonb(v.reference_id)) FROM api.dataset_row_values v WHERE v.row_id=r.id AND v.field_id=f.field_id ORDER BY v.ordinal LIMIT 1) END),''{}''::jsonb) FROM api.dataset_schema_version_fields f WHERE f.schema_version_id='||quote_literal(dataset.schema_version_id)||'::uuid AND f.lifecycle=''active'') values'||base_sql||' ORDER BY '||sort_sql||' '||sort_direction||format(' NULLS LAST,r.id ASC LIMIT %s OFFSET %s) p',p_limit,p_offset) INTO rows;
 RETURN jsonb_build_object('datasetId',dataset.id,'datasetRevision',dataset.revision,'offset',p_offset,'limit',p_limit,'totalCount',total_count,'hasMore',p_offset+p_limit<total_count,'rows',rows);
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.query_measurement_table_rows(p_schema_definition_id uuid, p_query jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  ws uuid := api.current_workspace_id();
  def api.dataset_schema_definitions;
  latest api.dataset_schema_versions;
  mode text;
  include_sub boolean;
  wanted jsonb;
  pins jsonb;
  pin_key text;
  sources jsonb;
  skipped jsonb;
  columns jsonb;
  filter_item jsonb;
  field api.dataset_schema_version_fields;
  filter_sql text := '';
  sort_sql text := '';
  sort_direction text := 'ASC';
  sort_item jsonb;
  value_column text;
  value_text text;
  operator text;
  record_id uuid;
  src_sql text;
  val_expr constant text := 'coalesce(to_jsonb(v.text_value),to_jsonb(v.integer_value),to_jsonb(v.numeric_value),to_jsonb(v.boolean_value),to_jsonb(v.date_value),to_jsonb(v.timestamp_value),to_jsonb(v.category_option_id),to_jsonb(v.reference_id))';
  total bigint;
  unavailable boolean;
  page jsonb;
BEGIN
  SELECT * INTO def FROM api.dataset_schema_definitions WHERE id = p_schema_definition_id;
  IF def.id IS NULL OR def.workspace_id IS DISTINCT FROM ws OR NOT api.is_workspace_member(ws) THEN
    RAISE EXCEPTION 'measurement table not found' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_query) IS DISTINCT FROM 'object'
     OR p_query - ARRAY['mode','datasets','pins','includeSubtypes','recordId','filters','sort'] <> '{}'::jsonb
     OR (p_query ? 'filters' AND jsonb_typeof(p_query->'filters') IS DISTINCT FROM 'array')
     OR (p_query ? 'datasets' AND jsonb_typeof(p_query->'datasets') IS DISTINCT FROM 'array')
     OR (p_query ? 'pins' AND jsonb_typeof(p_query->'pins') IS DISTINCT FROM 'object')
     OR (p_query ? 'sort' AND jsonb_typeof(p_query->'sort') IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'invalid measurement table query shape' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'query limit must be 1 to 1000 and offset non-negative' USING ERRCODE = '22023';
  END IF;
  IF coalesce(jsonb_array_length(p_query->'filters'), 0) > 8 THEN
    RAISE EXCEPTION 'a measurement table query supports at most eight filters' USING ERRCODE = '22023';
  END IF;
  mode := coalesce(p_query->>'mode', 'live');
  IF mode NOT IN ('live', 'latest_snapshot') THEN
    RAISE EXCEPTION 'mode must be live or latest_snapshot' USING ERRCODE = '22023';
  END IF;
  BEGIN
    include_sub := coalesce((p_query->>'includeSubtypes')::boolean, true);
    record_id := (p_query->>'recordId')::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'invalid measurement table query value' USING ERRCODE = '22023';
  END;
  wanted := p_query->'datasets';
  pins := coalesce(p_query->'pins', '{}'::jsonb);

  SELECT * INTO latest FROM api.dataset_schema_versions
   WHERE schema_id = def.id AND lifecycle = 'active' ORDER BY version DESC LIMIT 1;
  IF latest.id IS NULL THEN
    RAISE EXCEPTION 'measurement table has no published version' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('fieldId', f.field_id, 'key', f.key, 'label', f.label,
           'logicalType', f.logical_type, 'cardinality', f.cardinality, 'quantity', f.quantity,
           'relationship', f.relationship) ORDER BY f.display_order, f.key), '[]'::jsonb)
    INTO columns
    FROM api.dataset_schema_version_fields f WHERE f.schema_version_id = latest.id AND f.lifecycle = 'active';

  -- A dataset named but not visible reads exactly like one that is not on this
  -- table, so the call never says whether a hidden dataset exists.
  WITH RECURSIVE tbl AS (
    SELECT id FROM api.dataset_schema_definitions WHERE id = def.id
    UNION ALL
    SELECT c.id FROM api.dataset_schema_definitions c JOIN tbl ON c.parent_id = tbl.id WHERE include_sub
  ), cand AS (
    SELECT d.id, d.display_id, d.name, d.revision, sv.version AS schema_version
      FROM api.datasets d JOIN api.dataset_schema_versions sv ON sv.id = d.schema_version_id
     WHERE d.workspace_id = ws AND d.lifecycle = 'active'
       AND sv.schema_id IN (SELECT id FROM tbl)
       AND internal.can_access_object('dataset', d.id, 'view')
  )
  SELECT
    EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(wanted, '[]'::jsonb)) w WHERE w NOT IN (SELECT id::text FROM cand))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(pins) k WHERE k NOT IN (SELECT id::text FROM cand))
  INTO STRICT unavailable;
  IF unavailable THEN
    RAISE EXCEPTION 'a dataset is not available for this measurement table' USING ERRCODE = '42501';
  END IF;

  FOR pin_key IN SELECT jsonb_object_keys(pins) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM api.dataset_versions dv
       WHERE dv.id::text = pins->>pin_key AND dv.dataset_id::text = pin_key
         AND NOT EXISTS (SELECT 1 FROM api.dataset_version_prunes p WHERE p.dataset_version_id = dv.id)) THEN
      RAISE EXCEPTION 'snapshot not found for that dataset' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  WITH RECURSIVE tbl AS (
    SELECT id FROM api.dataset_schema_definitions WHERE id = def.id
    UNION ALL
    SELECT c.id FROM api.dataset_schema_definitions c JOIN tbl ON c.parent_id = tbl.id WHERE include_sub
  ), cand AS (
    SELECT d.id, d.display_id, d.name, d.revision, d.schema_version_id
      FROM api.datasets d JOIN api.dataset_schema_versions sv ON sv.id = d.schema_version_id
     WHERE d.workspace_id = ws AND d.lifecycle = 'active'
       AND sv.schema_id IN (SELECT id FROM tbl)
       AND internal.can_access_object('dataset', d.id, 'view')
       AND (wanted IS NULL OR d.id::text IN (SELECT jsonb_array_elements_text(wanted)))
  ), chosen AS (
    SELECT c.*,
           CASE WHEN pins ? c.id::text THEN (pins->>c.id::text)::uuid
                WHEN mode = 'latest_snapshot' THEN (
                  SELECT dv.id FROM api.dataset_versions dv
                   WHERE dv.dataset_id = c.id
                     AND NOT EXISTS (SELECT 1 FROM api.dataset_version_prunes p WHERE p.dataset_version_id = dv.id)
                   ORDER BY dv.created_at DESC LIMIT 1) END AS version_id
      FROM cand c
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'datasetId', ch.id, 'displayId', ch.display_id, 'name', ch.name,
      'datasetVersionId', ch.version_id, 'snapshotLabel', dv.label, 'live', ch.version_id IS NULL,
      'schemaVersion', sv.version, 'revision', coalesce(dv.source_dataset_revision, ch.revision))
      ORDER BY ch.display_id, ch.name) FILTER (WHERE mode = 'live' OR ch.version_id IS NOT NULL), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('datasetId', ch.id, 'displayId', ch.display_id, 'name', ch.name, 'reason', 'no_snapshot')
      ORDER BY ch.display_id, ch.name) FILTER (WHERE mode = 'latest_snapshot' AND ch.version_id IS NULL), '[]'::jsonb)
  INTO sources, skipped
  FROM chosen ch
  LEFT JOIN api.dataset_versions dv ON dv.id = ch.version_id
  JOIN api.dataset_schema_versions sv ON sv.id = coalesce(dv.schema_version_id, ch.schema_version_id);

  -- One row per (dataset or snapshot, row): live rows from the dataset, snapshot
  -- rows from the frozen copy. Planned rows hold no values yet and are left out.
  src_sql := format($q$(
    SELECT s.dataset_id, s.version_id, s.display_id, s.name AS dname, s.snapshot_label, s.revision AS dataset_revision, s.schema_version,
           r.id AS row_id, r.revision
      FROM jsonb_to_recordset(%1$L::jsonb) AS s(dataset_id uuid, version_id uuid, display_id text, name text, snapshot_label text, revision bigint, schema_version integer)
      JOIN api.dataset_rows r ON r.dataset_id = s.dataset_id AND r.status = 'recorded'
     WHERE s.version_id IS NULL
    UNION ALL
    SELECT s.dataset_id, s.version_id, s.display_id, s.name, s.snapshot_label, s.revision, s.schema_version,
           vr.row_id, vr.revision
      FROM jsonb_to_recordset(%1$L::jsonb) AS s(dataset_id uuid, version_id uuid, display_id text, name text, snapshot_label text, revision bigint, schema_version integer)
      JOIN api.dataset_version_rows vr ON vr.dataset_version_id = s.version_id
     WHERE s.version_id IS NOT NULL
  )$q$, (SELECT coalesce(jsonb_agg(jsonb_build_object(
           'dataset_id', e->>'datasetId', 'version_id', e->>'datasetVersionId', 'display_id', e->>'displayId',
           'name', e->>'name', 'snapshot_label', e->>'snapshotLabel', 'revision', e->>'revision',
           'schema_version', e->>'schemaVersion')), '[]'::jsonb) FROM jsonb_array_elements(sources) e));

  IF record_id IS NOT NULL THEN
    filter_sql := filter_sql || format($q$ AND EXISTS (
      SELECT 1 FROM api.dataset_schema_version_fields lf
       WHERE lf.schema_version_id = %1$L::uuid AND lf.logical_type = 'reference' AND lf.lifecycle = 'active'
         AND ((s.version_id IS NULL AND EXISTS (SELECT 1 FROM api.dataset_row_values v WHERE v.row_id = s.row_id AND v.field_id = lf.field_id AND v.reference_id = %2$L::uuid))
           OR (s.version_id IS NOT NULL AND EXISTS (SELECT 1 FROM api.dataset_version_values v WHERE v.dataset_version_id = s.version_id AND v.row_id = s.row_id AND v.field_id = lf.field_id AND v.reference_id = %2$L::uuid))))$q$,
      latest.id, record_id);
  END IF;

  FOR filter_item IN SELECT value FROM jsonb_array_elements(coalesce(p_query->'filters', '[]'::jsonb)) LOOP
    IF jsonb_typeof(filter_item) <> 'object' OR filter_item - ARRAY['field','operator','value'] <> '{}'::jsonb
       OR jsonb_typeof(filter_item->'field') IS DISTINCT FROM 'string'
       OR jsonb_typeof(filter_item->'operator') IS DISTINCT FROM 'string' OR NOT filter_item ? 'value' THEN
      RAISE EXCEPTION 'invalid measurement table filter shape' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO field FROM api.dataset_schema_version_fields f
     WHERE f.schema_version_id = latest.id AND f.lifecycle = 'active'
       AND (f.key = filter_item->>'field' OR f.field_id::text = filter_item->>'field') LIMIT 1;
    IF field.id IS NULL THEN RAISE EXCEPTION 'unknown column in measurement table filter' USING ERRCODE = '22023'; END IF;
    operator := filter_item->>'operator';
    IF operator NOT IN ('eq','gt','gte','lt','lte') OR (operator <> 'eq' AND field.logical_type NOT IN ('integer','decimal','date','timestamp','time','duration')) THEN
      RAISE EXCEPTION 'unsupported measurement table filter operator' USING ERRCODE = '22023';
    END IF;
    value_text := filter_item->'value' #>> '{}';
    BEGIN
      IF field.logical_type = 'integer' THEN PERFORM value_text::bigint;
      ELSIF field.logical_type = 'decimal' THEN PERFORM value_text::numeric;
      ELSIF field.logical_type = 'boolean' THEN PERFORM value_text::boolean;
      ELSIF field.logical_type = 'date' THEN PERFORM value_text::date;
      ELSIF field.logical_type = 'timestamp' THEN PERFORM value_text::timestamptz; ELSIF field.logical_type='time' THEN value_text:=internal.lab_time_text(value_text); ELSIF field.logical_type='duration' THEN PERFORM internal.lab_duration_seconds(to_jsonb(value_text::numeric)); ELSIF field.logical_type='well' THEN value_text:=internal.lab_well_text(value_text);
      ELSIF field.logical_type IN ('category','reference') THEN PERFORM value_text::uuid;
      END IF;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'measurement table filter value does not match the column type' USING ERRCODE = '22023';
    END;
    value_column := CASE field.logical_type WHEN 'text' THEN 'text_value' WHEN 'time' THEN 'text_value' WHEN 'well' THEN 'text_value' WHEN 'person' THEN 'text_value' WHEN 'duration' THEN 'numeric_value' WHEN 'integer' THEN 'integer_value' WHEN 'decimal' THEN 'numeric_value'
      WHEN 'boolean' THEN 'boolean_value' WHEN 'date' THEN 'date_value' WHEN 'timestamp' THEN 'timestamp_value'
      WHEN 'category' THEN 'category_option_id' ELSE 'reference_id' END;
    filter_sql := filter_sql || format($q$ AND ((s.version_id IS NULL AND EXISTS (SELECT 1 FROM api.dataset_row_values v WHERE v.row_id = s.row_id AND v.field_id = %1$L::uuid AND v.%2$I %3$s %4$L::%5$s))
        OR (s.version_id IS NOT NULL AND EXISTS (SELECT 1 FROM api.dataset_version_values v WHERE v.dataset_version_id = s.version_id AND v.row_id = s.row_id AND v.field_id = %1$L::uuid AND v.%2$I %3$s %4$L::%5$s)))$q$,
      field.field_id, value_column,
      CASE operator WHEN 'eq' THEN '=' WHEN 'gt' THEN '>' WHEN 'gte' THEN '>=' WHEN 'lt' THEN '<' ELSE '<=' END,
      value_text,
      CASE field.logical_type WHEN 'integer' THEN 'bigint' WHEN 'decimal' THEN 'numeric' WHEN 'duration' THEN 'numeric' WHEN 'boolean' THEN 'boolean' WHEN 'date' THEN 'date'
        WHEN 'timestamp' THEN 'timestamptz' WHEN 'category' THEN 'uuid' WHEN 'reference' THEN 'uuid' ELSE 'text' END);
  END LOOP;

  IF p_query ? 'sort' THEN
    sort_item := p_query->'sort';
    IF sort_item - ARRAY['field','direction'] <> '{}'::jsonb
       OR jsonb_typeof(sort_item->'field') IS DISTINCT FROM 'string'
       OR sort_item->>'direction' NOT IN ('asc','desc') THEN
      RAISE EXCEPTION 'invalid measurement table sort shape' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO field FROM api.dataset_schema_version_fields f
     WHERE f.schema_version_id = latest.id AND f.lifecycle = 'active'
       AND (f.key = sort_item->>'field' OR f.field_id::text = sort_item->>'field') LIMIT 1;
    IF field.id IS NULL THEN RAISE EXCEPTION 'unknown column in measurement table sort' USING ERRCODE = '22023'; END IF;
    value_column := CASE field.logical_type WHEN 'text' THEN 'text_value' WHEN 'time' THEN 'text_value' WHEN 'well' THEN 'text_value' WHEN 'person' THEN 'text_value' WHEN 'duration' THEN 'numeric_value' WHEN 'integer' THEN 'integer_value' WHEN 'decimal' THEN 'numeric_value'
      WHEN 'boolean' THEN 'boolean_value' WHEN 'date' THEN 'date_value' WHEN 'timestamp' THEN 'timestamp_value'
      WHEN 'category' THEN 'category_option_id' ELSE 'reference_id' END;
    sort_sql := format($q$CASE WHEN s.version_id IS NULL
        THEN (SELECT %1$s FROM api.dataset_row_values v WHERE v.row_id = s.row_id AND v.field_id = %2$L::uuid ORDER BY v.ordinal LIMIT 1)
        ELSE (SELECT %1$s FROM api.dataset_version_values v WHERE v.dataset_version_id = s.version_id AND v.row_id = s.row_id AND v.field_id = %2$L::uuid ORDER BY v.ordinal LIMIT 1) END %3$s NULLS LAST, $q$,
      CASE field.logical_type WHEN 'well' THEN 'internal.lab_well_sort_key(v.text_value)' WHEN 'person' THEN 'internal.lab_person_sort_name(v.text_value)' ELSE format('v.%I',value_column) END, field.field_id, upper(sort_item->>'direction'));
  END IF;

  EXECUTE format('SELECT count(*) FROM %s s WHERE true %s', src_sql, filter_sql) INTO total;

  EXECUTE format($q$SELECT coalesce(jsonb_agg(jsonb_build_object(
      'rowId', p.row_id, 'datasetId', p.dataset_id, 'datasetDisplayId', p.display_id, 'datasetName', p.dname,
      'datasetVersionId', p.version_id, 'snapshotLabel', p.snapshot_label, 'live', p.version_id IS NULL,
      'datasetRevision', p.dataset_revision, 'schemaVersion', p.schema_version, 'revision', p.revision,
      'values', (SELECT coalesce(jsonb_object_agg(f.key,
          CASE WHEN f.cardinality = 'many' THEN coalesce(CASE WHEN p.version_id IS NULL
                 THEN (SELECT jsonb_agg(%1$s ORDER BY v.ordinal) FROM api.dataset_row_values v WHERE v.row_id = p.row_id AND v.field_id = f.field_id)
                 ELSE (SELECT jsonb_agg(%1$s ORDER BY v.ordinal) FROM api.dataset_version_values v WHERE v.dataset_version_id = p.version_id AND v.row_id = p.row_id AND v.field_id = f.field_id) END, '[]'::jsonb)
          ELSE CASE WHEN p.version_id IS NULL
                 THEN (SELECT %1$s FROM api.dataset_row_values v WHERE v.row_id = p.row_id AND v.field_id = f.field_id ORDER BY v.ordinal LIMIT 1)
                 ELSE (SELECT %1$s FROM api.dataset_version_values v WHERE v.dataset_version_id = p.version_id AND v.row_id = p.row_id AND v.field_id = f.field_id ORDER BY v.ordinal LIMIT 1) END
          END), '{}'::jsonb)
        FROM api.dataset_schema_version_fields f WHERE f.schema_version_id = %2$L::uuid AND f.lifecycle = 'active'))
      ORDER BY p.rn), '[]'::jsonb)
    FROM (SELECT s.*, row_number() OVER (ORDER BY %3$s s.display_id, s.dname, s.version_id NULLS FIRST, s.row_id) AS rn
            FROM %4$s s WHERE true %5$s ORDER BY rn LIMIT %6$s OFFSET %7$s) p$q$,
    val_expr, latest.id, sort_sql, src_sql, filter_sql, p_limit, p_offset) INTO page;

  RETURN jsonb_build_object(
    'tableId', def.id, 'tableKey', def.key, 'tableName', def.name,
    'schemaVersionId', latest.id, 'schemaVersion', latest.version,
    'mode', mode, 'columns', columns, 'sources', sources, 'skipped', skipped,
    'offset', p_offset, 'limit', p_limit, 'totalCount', total, 'hasMore', p_offset + p_limit < total,
    'rows', page);
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.agent_operation_contract_core(p_workspace_id uuid, p_operation jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_kind text;
  v_target jsonb;
  v_validation jsonb;
  v_workspace uuid;
  v_revision bigint;
  v_lifecycle text;
  v_errors jsonb;
  v_preview jsonb;
BEGIN
  IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'operation must be an object' USING ERRCODE = '22023';
  END IF;
  v_kind := p_operation->>'kind';

  IF v_kind = 'dataset_schema.create' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
    IF p_operation - ARRAY['kind','workspaceId','key','name','description','fields'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id
       OR p_operation->>'key' !~ '^[a-z][a-z0-9_]{0,59}$'
       OR length(btrim(p_operation->>'name')) NOT BETWEEN 1 AND 200
       OR jsonb_typeof(p_operation->'fields') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_operation->'fields') > 200 THEN
      RAISE EXCEPTION 'invalid Dataset Schema create operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','dataset_schema','id',NULL,'label',p_operation->>'name');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,
        'kind',v_kind,
        'target',v_target,
        'changes',jsonb_build_array(
          jsonb_build_object('path','definition','before',NULL,'after',
            jsonb_build_object('key',p_operation->>'key','name',p_operation->>'name')),
          jsonb_build_object('path','fields','before',0,'after',jsonb_array_length(p_operation->'fields'))
        )
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',true,'affectedRows',0,'destructive',false
      )
    );

  ELSIF v_kind = 'sheet_definition.create' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
    IF p_operation - ARRAY['kind','workspaceId','key','name','description','configuration'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'invalid Sheet Definition create operation' USING ERRCODE = '22023';
    END IF;
    PERFORM internal.validate_sheet_definition_configuration(p_operation->'configuration');
    v_target := jsonb_build_object('type','sheet_definition','id',NULL,'label',p_operation->>'name');

  ELSIF v_kind = 'sheet_definition.update_draft' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
    SELECT d.workspace_id, v.revision, v.lifecycle
      INTO v_workspace, v_revision, v_lifecycle
      FROM api.sheet_definition_versions v
      JOIN api.sheet_definitions d ON d.id = v.definition_id
     WHERE v.id = (p_operation->>'versionId')::uuid;
    IF p_operation - ARRAY['kind','versionId','expectedRevision','configuration'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Sheet Definition draft unavailable' USING ERRCODE = '42501';
    END IF;
    PERFORM internal.validate_sheet_definition_configuration(p_operation->'configuration');
    v_target := jsonb_build_object('type','sheet_definition_version','id',p_operation->>'versionId','label','Draft version');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','configuration',
          'before',(SELECT configuration FROM api.sheet_definition_versions WHERE id=(p_operation->>'versionId')::uuid),
          'after',p_operation->'configuration'
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',false,'affectedRows',0,'destructive',false
      )
    );

  ELSIF v_kind = 'pipeline_definition.create' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'pipelines.manage');
    IF p_operation - ARRAY['kind','workspaceId','key','name','description'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'invalid Pipeline Definition create operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','pipeline_definition','id',NULL,'label',p_operation->>'name');

  ELSIF v_kind = 'pipeline_definition.create_version' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'pipelines.manage');
    SELECT workspace_id, revision, lifecycle
      INTO v_workspace, v_revision, v_lifecycle
      FROM api.pipeline_definitions
     WHERE id = (p_operation->>'definitionId')::uuid;
    v_errors := api.pipeline_config_errors(p_operation->'configuration');
    IF p_operation - ARRAY['kind','workspaceId','definitionId','expectedDefinitionRevision','configuration'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'active'
       OR jsonb_array_length(v_errors) > 0 THEN
      RAISE EXCEPTION 'invalid Pipeline Definition version operation: %', v_errors USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','pipeline_definition','id',p_operation->>'definitionId','label','New draft version');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedDefinitionRevision')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object('path','configuration','before',NULL,'after',p_operation->'configuration'))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',true,'affectedRows',0,'destructive',false
      )
    );

  ELSIF v_kind = 'pipeline_definition.update_draft' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'pipelines.manage');
    SELECT workspace_id, revision, lifecycle
      INTO v_workspace, v_revision, v_lifecycle
      FROM api.pipeline_definition_versions
     WHERE id = (p_operation->>'versionId')::uuid;
    v_errors := api.pipeline_config_errors(p_operation->'configuration');
    IF p_operation - ARRAY['kind','workspaceId','versionId','expectedRevision','configuration'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'draft'
       OR jsonb_array_length(v_errors) > 0 THEN
      RAISE EXCEPTION 'invalid Pipeline draft operation: %', v_errors USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','pipeline_definition_version','id',p_operation->>'versionId','label','Draft version');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','configuration',
          'before',(SELECT configuration FROM api.pipeline_definition_versions WHERE id=(p_operation->>'versionId')::uuid),
          'after',p_operation->'configuration'
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',false,'affectedRows',0,'destructive',false
      )
    );

  ELSIF v_kind = 'dataset_rows.commit' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, revision, lifecycle
      INTO v_workspace, v_revision, v_lifecycle
      FROM api.datasets
     WHERE id = (p_operation->>'datasetId')::uuid;
    IF p_operation - ARRAY['kind','datasetId','expectedRevision','rows'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'active'
       OR jsonb_typeof(p_operation->'rows') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_operation->'rows') NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'invalid Dataset row operation' USING ERRCODE = '22023';
    END IF;
    v_validation := api.validate_dataset_row_batch(
      (p_operation->>'datasetId')::uuid,
      (p_operation->>'expectedRevision')::bigint,
      p_operation->'rows'
    );
    IF (v_validation->>'ok')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'Dataset row operation failed validation: %', v_validation USING ERRCODE = 'SB073';
    END IF;
    v_target := jsonb_build_object('type','dataset','id',p_operation->>'datasetId','label','Dataset rows');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes',(SELECT coalesce(jsonb_agg(jsonb_build_object(
          'path','rows.' || (item->>'rowId'),
          'before',NULL,
          'after',item
        ) ORDER BY ordinality),'[]'::jsonb) FROM jsonb_array_elements(p_operation->'rows') WITH ORDINALITY AS rows(item,ordinality))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','data','target',v_target,
        'createsDraft',false,'affectedRows',jsonb_array_length(p_operation->'rows'),
        'destructive',false,'validation',v_validation
      )
    );
  ELSIF v_kind = 'notebook_block.insert' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, structure_version INTO v_workspace, v_revision
      FROM api.records WHERE id = (p_operation->>'recordId')::uuid;
    IF p_operation - ARRAY['kind','recordId','afterBlockId','block','expectedRevision'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR p_operation->>'expectedRevision' IS NULL
       OR jsonb_typeof(p_operation->'block') IS DISTINCT FROM 'object'
       OR length(btrim(coalesce(p_operation->'block'->>'type',''))) NOT BETWEEN 1 AND 48
       OR jsonb_typeof(p_operation->'block'->'payload') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid notebook block operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','record','id',p_operation->>'recordId','label','Notebook block');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes', jsonb_build_array(jsonb_build_object(
          'path','blocks','before',NULL,
          'after', jsonb_build_object(
            'afterBlockId',p_operation->'afterBlockId',
            'type',p_operation->'block'->>'type',
            'payload',p_operation->'block'->'payload'
          )
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );
  ELSIF v_kind = 'record.create' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    IF p_operation - ARRAY['kind','workspaceId','projectId','recordKind','title','status','tags','properties'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id
       OR length(btrim(coalesce(p_operation->>'recordKind',''))) NOT BETWEEN 1 AND 48
       OR length(btrim(coalesce(p_operation->>'title',''))) NOT BETWEEN 1 AND 200
       OR (p_operation->>'projectId' IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM api.projects p
             WHERE p.id = (p_operation->>'projectId')::uuid
               AND p.workspace_id = p_workspace_id))
       OR (p_operation->'tags' IS NOT NULL AND jsonb_typeof(p_operation->'tags') IS DISTINCT FROM 'array')
       OR (p_operation->'properties' IS NOT NULL AND jsonb_typeof(p_operation->'properties') IS DISTINCT FROM 'object')
       OR (p_operation->>'projectId' IS NULL AND p_operation->>'recordKind' <> 'protocol_template') THEN
      RAISE EXCEPTION 'invalid record create operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','project','id',p_operation->>'projectId','label','New ' || coalesce(p_operation->>'recordKind','record'));
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','record','before',NULL,'after',p_operation - 'kind'
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'record.custom_fields.update' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, metadata_version INTO v_workspace, v_revision
      FROM api.records WHERE id = (p_operation->>'recordId')::uuid;
    IF p_operation - ARRAY['kind','recordId','expectedMetadataVersion','values'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR p_operation->>'expectedMetadataVersion' IS NULL
       OR jsonb_typeof(p_operation->'values') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid record custom-field operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','record','id',p_operation->>'recordId','label','Record fields');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedMetadataVersion')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','customFields','before',NULL,'after',p_operation->'values'
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'sheet_instance.create' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    IF p_operation - ARRAY['kind','workspaceId','name','description','sourceDefinitionVersionId','projectId','notebookRecordId','state','parameterInputs'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id
       OR length(btrim(coalesce(p_operation->>'name',''))) NOT BETWEEN 1 AND 200
       OR p_operation->>'sourceDefinitionVersionId' IS NULL
       OR NOT EXISTS (
            SELECT 1
              FROM api.sheet_definition_versions version
              JOIN api.sheet_definitions definition ON definition.id = version.definition_id
             WHERE version.id = (p_operation->>'sourceDefinitionVersionId')::uuid
               AND version.lifecycle = 'published'
               AND definition.workspace_id = p_workspace_id
               AND definition.lifecycle = 'active')
       OR (p_operation->>'projectId' IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM api.projects p
             WHERE p.id = (p_operation->>'projectId')::uuid
               AND p.workspace_id = p_workspace_id))
       OR (p_operation->>'notebookRecordId' IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM api.records r
             WHERE r.id = (p_operation->>'notebookRecordId')::uuid
               AND r.workspace_id = p_workspace_id))
       OR jsonb_typeof(p_operation->'state') IS DISTINCT FROM 'object'
       OR (p_operation->'parameterInputs' IS NOT NULL AND jsonb_typeof(p_operation->'parameterInputs') IS DISTINCT FROM 'object') THEN
      RAISE EXCEPTION 'invalid Sheet Instance create operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','sheet_definition_version','id',p_operation->>'sourceDefinitionVersionId','label','New Sheet Instance');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','instance','before',NULL,
          'after',jsonb_build_object(
            'name',p_operation->>'name',
            'projectId',p_operation->>'projectId',
            'notebookRecordId',p_operation->>'notebookRecordId',
            'state',p_operation->'state'
          )
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'template.instantiate' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    IF p_operation - ARRAY['kind','templateRecordId','targetProjectId','targetKind','title'] <> '{}'::jsonb
       OR p_operation->>'templateRecordId' IS NULL
       OR p_operation->>'targetProjectId' IS NULL
       OR p_operation->>'targetKind' NOT IN ('experiment','protocol_template')
       OR length(coalesce(p_operation->>'title','')) > 200
       OR NOT EXISTS (
            SELECT 1 FROM api.records r
             WHERE r.id = (p_operation->>'templateRecordId')::uuid
               AND r.workspace_id = p_workspace_id
               AND r.kind = 'protocol_template'
               AND r.archived_at IS NULL
               AND r.status = 'active')
       OR NOT EXISTS (
            SELECT 1 FROM api.projects p
             WHERE p.id = (p_operation->>'targetProjectId')::uuid
               AND p.workspace_id = p_workspace_id) THEN
      RAISE EXCEPTION 'invalid template instantiate operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','project','id',p_operation->>'targetProjectId','label','Instantiate template');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','template','before',NULL,
          'after',jsonb_build_object(
            'templateRecordId',p_operation->>'templateRecordId',
            'targetKind',p_operation->>'targetKind',
            'title',p_operation->>'title'
          )
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'notebook_block.update' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT r.workspace_id, b.version INTO v_workspace, v_revision
      FROM api.blocks b JOIN api.records r ON r.id = b.record_id
     WHERE b.id = (p_operation->>'blockId')::uuid;
    IF p_operation - ARRAY['kind','blockId','expectedVersion','payload','payloadSchemaVersion'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR p_operation->>'expectedVersion' IS NULL
       OR jsonb_typeof(p_operation->'payload') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid notebook block update operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','block','id',p_operation->>'blockId','label','Notebook block');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedVersion')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','payload',
          'before',(SELECT payload FROM api.blocks WHERE id=(p_operation->>'blockId')::uuid),
          'after',p_operation->'payload'
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'notebook_block.move' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT r.workspace_id, r.structure_version INTO v_workspace, v_revision
      FROM api.blocks b JOIN api.records r ON r.id = b.record_id
     WHERE b.id = (p_operation->>'blockId')::uuid;
    IF p_operation - ARRAY['kind','blockId','expectedStructureVersion','afterBlockId','beforeBlockId'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR p_operation->>'expectedStructureVersion' IS NULL THEN
      RAISE EXCEPTION 'invalid notebook block move operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','record','id',(SELECT record_id FROM api.blocks WHERE id=(p_operation->>'blockId')::uuid),'label','Notebook order');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedStructureVersion')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','order','before',NULL,
          'after',jsonb_build_object(
            'blockId',p_operation->>'blockId',
            'afterBlockId',p_operation->>'afterBlockId',
            'beforeBlockId',p_operation->>'beforeBlockId'
          )
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'notebook_block.delete' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT r.workspace_id, r.structure_version INTO v_workspace, v_revision
      FROM api.blocks b JOIN api.records r ON r.id = b.record_id
     WHERE b.id = (p_operation->>'blockId')::uuid;
    IF p_operation - ARRAY['kind','blockId','expectedStructureVersion'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR p_operation->>'expectedStructureVersion' IS NULL THEN
      RAISE EXCEPTION 'invalid notebook block delete operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','record','id',(SELECT record_id FROM api.blocks WHERE id=(p_operation->>'blockId')::uuid),'label','Notebook block');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedStructureVersion')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','block','before',(SELECT payload FROM api.blocks WHERE id=(p_operation->>'blockId')::uuid),'after',NULL
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',true
      )
    );

  ELSIF v_kind = 'sheet_instance.update' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, revision, lifecycle INTO v_workspace, v_revision, v_lifecycle
      FROM api.sheet_instances WHERE id = (p_operation->>'instanceId')::uuid;
    IF p_operation - ARRAY['kind','instanceId','expectedRevision','state'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'active'
       OR p_operation->>'expectedRevision' IS NULL
       OR jsonb_typeof(p_operation->'state') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid Sheet Instance update operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','sheet_instance','id',p_operation->>'instanceId','label','Sheet Instance');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','state','before',(SELECT state FROM api.sheet_instances WHERE id=(p_operation->>'instanceId')::uuid),
          'after',p_operation->'state'
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'sheet_instance.archive' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, revision, lifecycle INTO v_workspace, v_revision, v_lifecycle
      FROM api.sheet_instances WHERE id = (p_operation->>'instanceId')::uuid;
    IF p_operation - ARRAY['kind','instanceId','expectedRevision'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'active'
       OR p_operation->>'expectedRevision' IS NULL THEN
      RAISE EXCEPTION 'invalid Sheet Instance archive operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','sheet_instance','id',p_operation->>'instanceId','label','Sheet Instance');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object('path','lifecycle','before','active','after','archived'))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'sheet_instance.restore' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, revision, lifecycle INTO v_workspace, v_revision, v_lifecycle
      FROM api.sheet_instances WHERE id = (p_operation->>'instanceId')::uuid;
    IF p_operation - ARRAY['kind','instanceId','expectedRevision'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'archived'
       OR p_operation->>'expectedRevision' IS NULL THEN
      RAISE EXCEPTION 'invalid Sheet Instance restore operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','sheet_instance','id',p_operation->>'instanceId','label','Sheet Instance');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object('path','lifecycle','before','archived','after','active'))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'template.upgrade' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, structure_version INTO v_workspace, v_revision
      FROM api.records WHERE id = (p_operation->>'recordId')::uuid;
    IF p_operation - ARRAY['kind','recordId','expectedStructureVersion','targetVersionId','decisions','parameterInputs'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR p_operation->>'expectedStructureVersion' IS NULL
       OR p_operation->>'targetVersionId' IS NULL
       OR NOT EXISTS (
            SELECT 1 FROM api.notebook_template_versions v
             JOIN api.notebook_templates t ON t.id = v.template_id
            WHERE v.id = (p_operation->>'targetVersionId')::uuid
              AND v.lifecycle = 'published'
              AND t.workspace_id = p_workspace_id)
       OR jsonb_typeof(p_operation->'decisions') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_operation->'parameterInputs') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid template upgrade operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','record','id',p_operation->>'recordId','label','Notebook template upgrade');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedStructureVersion')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','templateVersion','before',NULL,
          'after',jsonb_build_object(
            'targetVersionId',p_operation->>'targetVersionId',
            'decisions',p_operation->'decisions'
          )
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'record.comment.create' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id INTO v_workspace FROM api.records WHERE id = (p_operation->>'recordId')::uuid;
    IF p_operation - ARRAY['kind','recordId','targetKind','target','body','mentions'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR p_operation->>'targetKind' NOT IN ('record','block')
       OR length(btrim(coalesce(p_operation->>'body',''))) NOT BETWEEN 1 AND 8000
       OR (p_operation->'target' IS NOT NULL AND jsonb_typeof(p_operation->'target') IS DISTINCT FROM 'object')
       OR (p_operation->'mentions' IS NOT NULL AND jsonb_typeof(p_operation->'mentions') IS DISTINCT FROM 'array')
       OR (p_operation->>'targetKind' = 'block' AND (
            p_operation->'target'->>'blockId' IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM api.blocks b
               WHERE b.id = (p_operation->'target'->>'blockId')::uuid
                 AND b.record_id = (p_operation->>'recordId')::uuid))) THEN
      RAISE EXCEPTION 'invalid record comment operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','record','id',p_operation->>'recordId','label','Notebook comment');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','comment','before',NULL,
          'after',jsonb_build_object(
            'targetKind',p_operation->>'targetKind',
            'target',p_operation->'target',
            'body',p_operation->>'body',
            'mentions',p_operation->'mentions'
          )
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'reagent_order.mark_ordered' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
    IF p_operation - ARRAY['kind','orderId','orderReference','expectedOn','supplier','supplierRecordId','totalPrice','currency'] <> '{}'::jsonb
       OR coalesce(p_operation->>'orderId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR (p_operation->>'supplierRecordId' IS NOT NULL AND p_operation->>'supplierRecordId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
       OR (p_operation->>'expectedOn' IS NOT NULL AND p_operation->>'expectedOn' !~ '^\d{4}-\d{2}-\d{2}$')
       OR length(coalesce(p_operation->>'orderReference','')) > 200
       OR length(coalesce(p_operation->>'supplier','')) > 200
       OR (p_operation ? 'totalPrice' AND (jsonb_typeof(p_operation->'totalPrice') <> 'number' OR (p_operation->>'totalPrice')::numeric < 0))
       OR (p_operation ? 'totalPrice' AND coalesce(p_operation->>'currency','') !~ '^[A-Z]{3}$')
       OR NOT EXISTS (
            SELECT 1 FROM api.reagent_orders o
             WHERE o.id = (p_operation->>'orderId')::uuid
               AND o.workspace_id = p_workspace_id
               AND o.status = 'requested') THEN
      RAISE EXCEPTION 'invalid reagent order operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','reagent_order','id',p_operation->>'orderId','label','Reagent order');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(
          jsonb_build_object('path','status','before','requested','after','ordered')
        ) || CASE WHEN p_operation ? 'totalPrice' THEN jsonb_build_array(
          jsonb_build_object('path','price','before',NULL,
            'after',jsonb_build_object('totalPrice',p_operation->'totalPrice','currency',p_operation->>'currency'))
        ) ELSE '[]'::jsonb END
          || CASE WHEN p_operation ? 'supplier' OR p_operation ? 'supplierRecordId' THEN jsonb_build_array(
          jsonb_build_object('path','supplier','before',NULL,
            'after',jsonb_build_object('supplier',p_operation->>'supplier','supplierRecordId',p_operation->>'supplierRecordId'))
        ) ELSE '[]'::jsonb END
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'reagent_order.set_price' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
    IF p_operation - ARRAY['kind','orderId','totalPrice','currency'] <> '{}'::jsonb
       OR coalesce(p_operation->>'orderId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR NOT (p_operation ? 'totalPrice')
       OR jsonb_typeof(p_operation->'totalPrice') NOT IN ('number','null')
       OR (jsonb_typeof(p_operation->'totalPrice') = 'number' AND (
             (p_operation->>'totalPrice')::numeric < 0
             OR coalesce(p_operation->>'currency','') !~ '^[A-Z]{3}$'))
       OR NOT EXISTS (
            SELECT 1 FROM api.reagent_orders o
             WHERE o.id = (p_operation->>'orderId')::uuid
               AND o.workspace_id = p_workspace_id) THEN
      RAISE EXCEPTION 'invalid reagent order price operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','reagent_order','id',p_operation->>'orderId','label','Reagent order price');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','price',
          -- The price now on file is shown only to someone who may see prices.
          'before',(SELECT CASE WHEN coalesce(api.has_capability(p_workspace_id,'schema.edit'),false)
                                THEN jsonb_build_object('totalPrice',p.total_price,'currency',p.currency) END
                      FROM api.reagent_order_prices p WHERE p.order_id = (p_operation->>'orderId')::uuid),
          'after',CASE WHEN jsonb_typeof(p_operation->'totalPrice') = 'number'
                       THEN jsonb_build_object('totalPrice',p_operation->'totalPrice','currency',p_operation->>'currency') END
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',jsonb_typeof(p_operation->'totalPrice') = 'null'
      )
    );

  ELSIF v_kind = 'instrument_rate.set' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'instrument.manage');
    IF p_operation - ARRAY['kind','instrumentId','ratePerHour','currency'] <> '{}'::jsonb
       OR coalesce(p_operation->>'instrumentId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR NOT (p_operation ? 'ratePerHour')
       OR jsonb_typeof(p_operation->'ratePerHour') NOT IN ('number','null')
       OR (jsonb_typeof(p_operation->'ratePerHour') = 'number' AND (
             (p_operation->>'ratePerHour')::numeric < 0
             OR coalesce(p_operation->>'currency','') !~ '^[A-Z]{3}$'))
       OR NOT EXISTS (
            SELECT 1 FROM api.instruments i
             WHERE i.id = (p_operation->>'instrumentId')::uuid
               AND i.workspace_id = p_workspace_id) THEN
      RAISE EXCEPTION 'invalid instrument rate operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','instrument','id',p_operation->>'instrumentId',
      'label',coalesce((SELECT i.name FROM api.instruments i WHERE i.id = (p_operation->>'instrumentId')::uuid),'Instrument'));
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','ratePerHour',
          'before',(SELECT jsonb_build_object('ratePerHour',r.rate_per_hour,'currency',r.currency)
                      FROM api.instrument_rates r WHERE r.instrument_id = (p_operation->>'instrumentId')::uuid),
          'after',CASE WHEN jsonb_typeof(p_operation->'ratePerHour') = 'number'
                       THEN jsonb_build_object('ratePerHour',p_operation->'ratePerHour','currency',p_operation->>'currency') END
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',jsonb_typeof(p_operation->'ratePerHour') = 'null'
      )
    );

  ELSIF v_kind = 'model_field.create' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
    IF p_operation - ARRAY['kind','workspaceId','modelKey','fieldName','label','logicalType','nullable','defaultValue','validation','unit','description'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id
       OR length(btrim(coalesce(p_operation->>'fieldName',''))) NOT BETWEEN 1 AND 63
       OR length(btrim(coalesce(p_operation->>'label',''))) NOT BETWEEN 1 AND 200
       OR p_operation->>'logicalType' NOT IN ('text','integer','decimal','boolean','date','timestamp','category','reference','time','duration','well','person')
       OR (p_operation->'validation' IS NOT NULL AND jsonb_typeof(p_operation->'validation') IS DISTINCT FROM 'object')
       OR (p_operation->'unit' IS NOT NULL AND jsonb_typeof(p_operation->'unit') IS DISTINCT FROM 'object') THEN
      RAISE EXCEPTION 'invalid model field create operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','workspace','id',p_operation->>'workspaceId','label','New model field');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object('path','field','before',NULL,'after',p_operation - 'kind'))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',true,'affectedRows',0,'destructive',false
      )
    );

  ELSIF v_kind = 'model_field.update' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
    SELECT workspace_id INTO v_workspace FROM api.record_field_definitions WHERE id = (p_operation->>'definitionId')::uuid;
    IF p_operation - ARRAY['kind','definitionId','patch'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR jsonb_typeof(p_operation->'patch') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid model field update operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','workspace','id',p_workspace_id,'label','Model field');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object('path','field','before',NULL,'after',p_operation->'patch'))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',false,'affectedRows',0,'destructive',false
      )
    );

  ELSIF v_kind = 'model_field.activate' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
    SELECT workspace_id INTO v_workspace FROM api.record_field_definitions WHERE id = (p_operation->>'definitionId')::uuid;
    IF p_operation - ARRAY['kind','definitionId'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'invalid model field activate operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','workspace','id',p_workspace_id,'label','Model field');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object('path','lifecycle','before','draft','after','active'))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',false,'affectedRows',0,'destructive',false
      )
    );

  ELSIF v_kind = 'sheet_instance.materialize' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, revision, lifecycle INTO v_workspace, v_revision, v_lifecycle
      FROM api.sheet_instances WHERE id = (p_operation->>'instanceId')::uuid;
    IF p_operation - ARRAY['kind','instanceId','expectedRevision','outputName','outputSchemaVersionId','previewDigest'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'active'
       OR p_operation->>'expectedRevision' IS NULL
       OR length(btrim(coalesce(p_operation->>'outputName',''))) NOT BETWEEN 1 AND 200
       OR coalesce(p_operation->>'previewDigest','') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'invalid Sheet Instance materialization operation' USING ERRCODE = '22023';
    END IF;
    v_preview := api.preview_sheet_materialization(
      (p_operation->>'instanceId')::uuid,
      (p_operation->>'expectedRevision')::bigint,
      nullif(p_operation->>'outputSchemaVersionId','')::uuid
    );
    IF v_preview->>'previewDigest' IS DISTINCT FROM p_operation->>'previewDigest' THEN
      RAISE EXCEPTION 'materialization preview digest is stale' USING ERRCODE = 'SB089';
    END IF;
    v_target := jsonb_build_object('type','sheet_instance','id',p_operation->>'instanceId','label','Sheet Instance materialization');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','materialization','before',NULL,
          'after',jsonb_build_object(
            'outputName',btrim(p_operation->>'outputName'),
            'outputSchemaVersionId',p_operation->>'outputSchemaVersionId',
            'previewDigest',p_operation->>'previewDigest',
            'fieldCount',jsonb_array_length(v_preview->'derivedOutputFields'),
            'sourceVersions',v_preview->'sourceVersions'
          )
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','data','target',v_target,
        'createsDraft',false,'affectedRows',0,'destructive',false
      )
    );

  ELSE
    RAISE EXCEPTION 'unsupported or human-only operation kind' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'preview', jsonb_build_object(
      'formatVersion',1,'kind',v_kind,'target',v_target,
      'changes',jsonb_build_array(jsonb_build_object('path','definition','before',NULL,'after',p_operation - 'kind'))
    ),
    'impact', jsonb_build_object(
      'formatVersion',1,'mutationClass','configuration','target',v_target,
      'createsDraft',v_kind = 'sheet_definition.create',
      'affectedRows',0,'destructive',false
    )
  );
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.assert_publishable_dataset_schema_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE field api.dataset_schema_version_fields; workspace_id uuid; error_code text;
BEGIN
  IF OLD.lifecycle='draft' AND NEW.lifecycle='active' THEN
    SELECT s.workspace_id INTO workspace_id FROM api.dataset_schema_definitions s WHERE s.id=NEW.schema_id;
    FOR field IN SELECT * FROM api.dataset_schema_version_fields WHERE schema_version_id=NEW.id LOOP
      IF btrim(field.key)='' OR btrim(field.label)='' THEN RAISE EXCEPTION 'Dataset Schema field key and label must be nonblank' USING ERRCODE='SB071'; END IF;
      IF field.cardinality NOT IN ('one','many') OR field.logical_type NOT IN ('text','integer','decimal','boolean','date','timestamp','category','reference','time','duration','well','person') THEN RAISE EXCEPTION 'invalid Dataset Schema field type metadata' USING ERRCODE='SB071'; END IF;
      IF field.cardinality='many' AND field.default_value IS NOT NULL AND field.default_value<>'null'::jsonb THEN RAISE EXCEPTION 'many Dataset fields cannot have defaults' USING ERRCODE='SB071'; END IF;
      IF jsonb_typeof(field.validation) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid Dataset validation metadata' USING ERRCODE='SB071'; END IF;
      BEGIN
        IF (field.validation ? 'min' AND jsonb_typeof(field.validation->'min')<>'number') OR (field.validation ? 'max' AND jsonb_typeof(field.validation->'max')<>'number') OR (field.validation ? 'min' AND field.validation ? 'max' AND (field.validation->>'min')::numeric>(field.validation->>'max')::numeric) THEN RAISE EXCEPTION 'invalid Dataset numeric validation metadata' USING ERRCODE='SB071'; END IF;
        IF (field.validation ? 'minLength' AND (jsonb_typeof(field.validation->'minLength')<>'number' OR (field.validation->>'minLength') !~ '^[0-9]+$')) OR (field.validation ? 'maxLength' AND (jsonb_typeof(field.validation->'maxLength')<>'number' OR (field.validation->>'maxLength') !~ '^[0-9]+$')) OR (field.validation ? 'minLength' AND field.validation ? 'maxLength' AND (field.validation->>'minLength')::integer>(field.validation->>'maxLength')::integer) THEN RAISE EXCEPTION 'invalid Dataset text validation metadata' USING ERRCODE='SB071'; END IF;
        IF field.validation ? 'pattern' THEN IF jsonb_typeof(field.validation->'pattern')<>'string' THEN RAISE EXCEPTION 'invalid Dataset text validation metadata' USING ERRCODE='SB071'; END IF; PERFORM '' ~ (field.validation->>'pattern'); END IF;
      EXCEPTION WHEN invalid_regular_expression OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'invalid Dataset validation metadata' USING ERRCODE='SB071'; END;
      IF field.quantity IS NOT NULL AND (field.logical_type NOT IN ('integer','decimal') OR jsonb_typeof(field.quantity)<>'object' OR coalesce(btrim(field.quantity->>'kind'),'')='' OR coalesce(btrim(field.quantity->>'dimension'),'')='' OR coalesce(btrim(field.quantity->>'storageUnit'),'')='') THEN RAISE EXCEPTION 'invalid Dataset quantity metadata' USING ERRCODE='SB071'; END IF;
      IF field.logical_type='category' THEN
        IF jsonb_typeof(field.category)<>'object' OR field.category->>'kind'<>'embedded' OR jsonb_typeof(field.category->'options')<>'array' THEN RAISE EXCEPTION 'unsupported Dataset category metadata' USING ERRCODE='SB071'; END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(field.category->'options') o WHERE jsonb_typeof(o)<>'object' OR coalesce(btrim(o->>'id'),'')='' OR coalesce(btrim(o->>'key'),'')='' OR coalesce(btrim(o->>'label'),'')='' OR o->>'lifecycle' NOT IN ('active','retired') OR coalesce(o->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') OR EXISTS (SELECT 1 FROM jsonb_array_elements(field.category->'options') o GROUP BY o->>'id' HAVING count(*)>1) OR EXISTS (SELECT 1 FROM jsonb_array_elements(field.category->'options') o GROUP BY o->>'key' HAVING count(*)>1) THEN RAISE EXCEPTION 'invalid Dataset category options' USING ERRCODE='SB071'; END IF;
      ELSIF field.category IS NOT NULL THEN RAISE EXCEPTION 'only category fields may have category metadata' USING ERRCODE='SB071'; END IF;
      IF field.logical_type='reference' THEN
        IF jsonb_typeof(field.relationship)<>'object' OR field.relationship->'target'->>'kind'<>'model' OR coalesce(btrim(field.relationship->'target'->>'modelKey'),'')='' OR field.relationship->>'cardinality'<>field.cardinality THEN RAISE EXCEPTION 'invalid Dataset relationship metadata' USING ERRCODE='SB071'; END IF;
        IF NOT internal.record_model_key_exists(workspace_id,field.relationship->'target'->>'modelKey') THEN RAISE EXCEPTION 'Dataset link targets an unknown record type' USING ERRCODE='SB071'; END IF;
      ELSIF field.relationship IS NOT NULL THEN RAISE EXCEPTION 'only reference fields may have relationship metadata' USING ERRCODE='SB071'; END IF;
      IF field.default_value IS NOT NULL AND field.default_value<>'null'::jsonb THEN
        error_code:=internal.dataset_batch_cell_error(workspace_id,field,field.default_value);
        IF error_code IS NOT NULL THEN RAISE EXCEPTION 'invalid Dataset field default: %',error_code USING ERRCODE='SB071'; END IF;
        -- Stored values may fall outside the range and are flagged; a field's own
        -- default must still sit inside it.
        IF field.logical_type IN ('integer','decimal') AND jsonb_typeof(field.default_value)='number' AND ((field.validation ? 'min' AND (field.default_value#>>'{}')::numeric<(field.validation->>'min')::numeric) OR (field.validation ? 'max' AND (field.default_value#>>'{}')::numeric>(field.validation->>'max')::numeric)) THEN RAISE EXCEPTION 'invalid Dataset field default: numeric_validation' USING ERRCODE='SB071'; END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.evaluate_check_item(p_envelope jsonb, p_check_item jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  rule_type text := p_check_item -> 'rule' ->> 'type';
  item_status text := 'pass';
  evidence jsonb := '{}';
  field_text text;
  field_value jsonb;
  array_len int;
  min_count int;
  path_text text;
  table_item jsonb;
  column_item jsonb;
  logical_type text;
  total_columns int := 0;
  invalid_columns jsonb := '[]';
  formula_item jsonb;
  calc_item jsonb;
  sheet jsonb;
  artifact jsonb;
  total_formulas int := 0;
  unsupported_formulas jsonb := '[]';
  stale_formulas jsonb := '[]';
  missing_results jsonb := '[]';
  formula_version_text text;
  calc_version_text text;
  tables jsonb := coalesce(p_envelope -> 'scientificTables', '[]');
  formulas jsonb := coalesce(p_envelope -> 'formulas', '[]');
  result_status text;
  link_item jsonb;
  link_type text;
  found_link_types text[] := '{}';
  required_link_types text[] := '{}';
  missing_link_types text[] := '{}';
  required_type text;
BEGIN
  -- Normalize frozen canonical evidence into the existing check vocabulary.
  -- No Dataset, Instance or calculation cache reads occur during review.
  FOR sheet IN
  SELECT
    value
  FROM
    jsonb_array_elements(coalesce(p_envelope -> 'sheetEvidence', '[]'))
    LOOP
      tables := tables || jsonb_build_array(jsonb_build_object('id', sheet ->> 'blockId', 'columns', coalesce(sheet -> 'composedGrid' -> 'fields', sheet -> 'instanceState' -> 'localFields', '[]')));
      FOR artifact IN
      SELECT
        value
      FROM
        jsonb_array_elements(coalesce(sheet -> 'composedGrid' -> 'calculations', sheet -> 'instanceState' -> 'instanceCalculations', '[]'))
        LOOP
          IF artifact ->> 'lifecycle' = 'retired' THEN
            CONTINUE;
          END IF;
          result_status := 'completed';
          IF artifact -> 'results' IS NULL OR jsonb_array_length(artifact -> 'results') = 0 OR EXISTS (
            SELECT
              1
            FROM
              jsonb_array_elements_text(coalesce(artifact -> 'expectedRowKeys', '[]')) k
            WHERE
              NOT EXISTS (
              SELECT
                1
              FROM
                jsonb_array_elements(coalesce(artifact -> 'results', '[]')) r
              WHERE
                r ->> 'row_key' = k.value)) THEN
            result_status := 'missing';
          ELSIF EXISTS (
              SELECT
                1
              FROM
                jsonb_array_elements(artifact -> 'results') r
              WHERE
                r ->> 'calculationStatus' IS DISTINCT FROM 'current') THEN
            result_status := 'stale';
          ELSIF EXISTS (
              SELECT
                1
              FROM
                jsonb_array_elements(artifact -> 'results') r
              WHERE
                r ->> 'result_kind' IS DISTINCT FROM 'value') THEN
            result_status := 'error';
          END IF;
          formulas := formulas || jsonb_build_array(jsonb_build_object('id', (sheet ->> 'blockId') || ':' || (artifact ->> 'id'), 'status', CASE WHEN artifact -> 'expression' ->> 'language' = 'sheetbase-formula-v1'
                AND NOT EXISTS (
                  SELECT
                    1
                  FROM jsonb_array_elements(coalesce(artifact -> 'results', '[]')) r
                WHERE
                  r ->> 'result_kind' = 'error') THEN
                'supported'
              ELSE
                'unsupported'
              END, 'version', sheet -> 'instanceRevision', 'calculation', CASE WHEN result_status = 'missing' THEN
                NULL
              ELSE
                jsonb_build_object('formula_version', sheet -> 'instanceRevision', 'status', result_status)
              END));
        END LOOP;
    END LOOP;
  IF rule_type = 'completeness-title' THEN
    field_text := p_envelope -> 'record' ->> 'title';
    IF field_text IS NULL OR btrim(field_text) = '' THEN
      item_status := 'fail';
    END IF;
    evidence := jsonb_build_object('title', to_jsonb (field_text));
  ELSIF rule_type = 'min-count' THEN
    path_text := p_check_item -> 'rule' ->> 'path';
    field_value := p_envelope -> path_text;
    array_len := CASE WHEN jsonb_typeof(field_value) = 'array' THEN
      jsonb_array_length(field_value)
    ELSE
      0
    END;
    min_count := coalesce((p_check_item -> 'rule' ->> 'minCount')::int, 0);
    IF array_len < min_count THEN
      item_status := 'fail';
    END IF;
    evidence := jsonb_build_object('path', path_text, 'count', array_len, 'minCount', min_count);
  ELSIF rule_type = 'schema-valid-columns' THEN
    FOR table_item IN
    SELECT
      value
    FROM
      jsonb_array_elements(tables)
      LOOP
        FOR column_item IN
        SELECT
          value
        FROM
          jsonb_array_elements(coalesce(table_item -> 'columns', '[]'))
          LOOP
            total_columns := total_columns + 1;
            logical_type := coalesce(column_item ->> 'logicalType', column_item ->> 'logical_type');
            IF logical_type IS NULL OR logical_type NOT IN ('text', 'integer', 'decimal', 'boolean', 'date', 'timestamp', 'category', 'reference', 'time', 'duration', 'well', 'person') THEN
              item_status := 'fail';
              invalid_columns := invalid_columns || jsonb_build_array(jsonb_build_object('tableId', table_item ->> 'id', 'columnId', coalesce(column_item ->> 'id', column_item ->> 'fieldId'), 'fieldName', coalesce(column_item ->> 'fieldName', column_item ->> 'field_name', column_item ->> 'key'), 'logicalType', to_jsonb (logical_type)));
            END IF;
          END LOOP;
      END LOOP;
    evidence := jsonb_build_object('totalColumns', total_columns, 'invalidColumns', invalid_columns);
  ELSIF rule_type = 'formula-supported' THEN
    FOR formula_item IN
    SELECT
      value
    FROM
      jsonb_array_elements(formulas)
      LOOP
        total_formulas := total_formulas + 1;
        IF formula_item ->> 'status' IS DISTINCT FROM 'supported' THEN
          item_status := 'fail';
          unsupported_formulas := unsupported_formulas || jsonb_build_array(jsonb_build_object('id', formula_item ->> 'id', 'status', formula_item ->> 'status'));
        END IF;
      END LOOP;
    evidence := jsonb_build_object('totalFormulas', total_formulas, 'unsupportedFormulas', unsupported_formulas);
  ELSIF rule_type = 'formula-no-stale' THEN
    FOR formula_item IN
    SELECT
      value
    FROM
      jsonb_array_elements(formulas)
      LOOP
        total_formulas := total_formulas + 1;
        calc_item := formula_item -> 'calculation';
        formula_version_text := formula_item ->> 'version';
        IF calc_item IS NULL OR jsonb_typeof(calc_item) = 'null' THEN
          item_status := 'fail';
          missing_results := missing_results || jsonb_build_array(jsonb_build_object('id', formula_item ->> 'id', 'reason', 'no_cached_result'));
        ELSE
          calc_version_text := calc_item ->> 'formula_version';
          IF calc_version_text IS DISTINCT FROM formula_version_text THEN
            item_status := 'fail';
            stale_formulas := stale_formulas || jsonb_build_array(jsonb_build_object('id', formula_item ->> 'id', 'formulaVersion', formula_version_text, 'cachedVersion', calc_version_text, 'reason', 'version_mismatch'));
          ELSIF calc_item ->> 'status' IS DISTINCT FROM 'completed' THEN
            item_status := 'fail';
            stale_formulas := stale_formulas || jsonb_build_array(jsonb_build_object('id', formula_item ->> 'id', 'calculationStatus', calc_item ->> 'status', 'reason', 'incomplete'));
          END IF;
        END IF;
      END LOOP;
    evidence := jsonb_build_object('totalFormulas', total_formulas, 'staleFormulas', stale_formulas, 'missingResults', missing_results);
  ELSIF rule_type = 'required-links' THEN
    FOR required_type IN
    SELECT
      value
    FROM
      jsonb_array_elements_text(coalesce(p_check_item -> 'rule' -> 'linkTypes', '[]'))
      LOOP
        required_link_types := array_append(required_link_types, required_type);
      END LOOP;
    FOR link_item IN
    SELECT
      value
    FROM
      jsonb_array_elements(coalesce(p_envelope -> 'links', '[]'))
      LOOP
        link_type := coalesce(link_item ->> 'linkType', link_item ->> 'link_type');
        IF link_type IS NOT NULL AND NOT (link_type = ANY (found_link_types)) THEN
          found_link_types := array_append(found_link_types, link_type);
        END IF;
      END LOOP;
    FOREACH required_type IN ARRAY required_link_types LOOP
      IF NOT (required_type = ANY (found_link_types)) THEN
        item_status := 'fail';
        missing_link_types := array_append(missing_link_types, required_type);
      END IF;
    END LOOP;
    evidence := jsonb_build_object('requiredLinkTypes', to_jsonb (required_link_types), 'foundLinkTypes', to_jsonb (found_link_types), 'missingLinkTypes', to_jsonb (missing_link_types));
  ELSE
    item_status := 'fail';
    evidence := jsonb_build_object('error', 'unknown rule type', 'ruleType', rule_type);
  END IF;
  RETURN jsonb_build_object('key', p_check_item ->> 'key', 'category', p_check_item ->> 'category', 'severity', p_check_item ->> 'severity', 'label', p_check_item ->> 'label', 'status', item_status, 'evidence', evidence);
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.guard_record_model_definition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE f jsonb; model api.record_models; seen_ids uuid[]:='{}'; seen_keys text[]:='{}'; field_id uuid; taken text;
BEGIN
  SELECT * INTO model FROM api.record_models WHERE id=NEW.model_id;
  IF model.workspace_id IS DISTINCT FROM NEW.workspace_id OR jsonb_typeof(NEW.definition->'fields') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid Record Model definition' USING ERRCODE='22023';
  END IF;
  IF NEW.definition ? 'migrationScope' AND NEW.definition->>'migrationScope' NOT IN ('new-records-only','also-migrate-open-experiments') THEN
    RAISE EXCEPTION 'invalid migration scope' USING ERRCODE='22023';
  END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(NEW.definition->'fields') LOOP
    PERFORM internal.canonical_model_field_value(jsonb_populate_record(NULL::api.record_field_definitions,
      f || jsonb_build_object('cardinality',coalesce(f->>'cardinality','one'))));
    field_id := (f->>'id')::uuid;
    IF (field_id IS NOT NULL AND f->>'field_name' ~ '^[a-z][a-z0-9_]{0,59}$'
      AND length(btrim(f->>'label')) BETWEEN 1 AND 200
      AND f->>'logical_type' IN ('text','integer','decimal','boolean','date','timestamp','category','reference','time','duration','well','person')
      AND jsonb_typeof(f->'nullable')='boolean' AND f->>'lifecycle' IN ('active','retired')
      AND coalesce(f->>'cardinality','one')='one' AND jsonb_typeof(f->'validation')='object') IS NOT TRUE THEN
      RAISE EXCEPTION 'invalid Record Model field' USING ERRCODE='SB071';
    END IF;
    IF field_id=ANY(seen_ids) OR f->>'field_name'=ANY(seen_keys) THEN
      RAISE EXCEPTION 'duplicate Record Model field' USING ERRCODE='SB071';
    END IF;
    seen_ids:=seen_ids||field_id; seen_keys:=seen_keys||(f->>'field_name');
    IF EXISTS(SELECT 1 FROM api.record_field_definitions d WHERE d.id=field_id
      AND (d.workspace_id<>NEW.workspace_id OR d.kind<>model.key)) OR EXISTS(
      SELECT 1 FROM api.record_model_versions v CROSS JOIN LATERAL jsonb_array_elements(v.definition->'fields') old_field
      WHERE v.model_id=NEW.model_id AND v.lifecycle='published' AND old_field->>'id'=f->>'id'
        AND old_field->>'field_name' IS DISTINCT FROM f->>'field_name') THEN
      RAISE EXCEPTION 'published field identity cannot change or be borrowed' USING ERRCODE='SB070';
    END IF;
    IF f->'quantity' IS NOT NULL AND f->'quantity'<>'null'::jsonb AND
      (f->>'logical_type' NOT IN ('integer','decimal') OR coalesce(f->'quantity'->>'kind','')='' OR
       coalesce(f->'quantity'->>'dimension','')='' OR coalesce(f->'quantity'->>'storageUnit','')='') THEN
      RAISE EXCEPTION 'quantity requires kind, dimension and storageUnit on a numeric field' USING ERRCODE='SB071';
    END IF;
  END LOOP;
  SELECT k INTO taken FROM internal.model_family_field_keys(NEW.workspace_id, model.key) k
   WHERE k = ANY(seen_keys) LIMIT 1;
  IF taken IS NOT NULL THEN
    RAISE EXCEPTION 'field % is already used by a related model', taken USING ERRCODE='SB082';
  END IF;
  RETURN NEW;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.validate_sheet_field_definition(p_field jsonb, p_path text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE option jsonb; unit jsonb; ids text[]:='{}'; keys text[]:='{}'; units text[]:='{}'; target jsonb;
BEGIN
  PERFORM internal.assert_sheet_definition_object(p_field,
    ARRAY['fieldId','key','label','description','logicalType','nullable','defaultValue','cardinality','quantity','validation','category','relationship','computation','lifecycle'],
    ARRAY['fieldId','key','label','description','logicalType','nullable','defaultValue','cardinality','quantity','validation','category','relationship','computation','lifecycle'],p_path);
  PERFORM internal.sheet_definition_uuid(p_field->>'fieldId',p_path||'.fieldId');
  IF p_field->>'key' !~ '^[a-z][a-z0-9_]{0,59}$' OR length(btrim(p_field->>'label')) NOT BETWEEN 1 AND 200
     OR p_field->>'logicalType' NOT IN ('text','integer','decimal','boolean','date','timestamp','category','reference','time','duration','well','person')
     OR jsonb_typeof(p_field->'nullable')<>'boolean' OR p_field->>'cardinality' NOT IN ('one','many')
     OR p_field->>'lifecycle' NOT IN ('draft','backfilling','active','retired')
     OR (p_field->'description'<>'null'::jsonb AND (jsonb_typeof(p_field->'description')<>'string' OR length(p_field->>'description')>2000))
  THEN RAISE EXCEPTION 'invalid canonical FieldDefinition at %',p_path USING ERRCODE='SB071'; END IF;
  IF jsonb_typeof(p_field->'validation')<>'object' OR (p_field->'validation') - ARRAY['min','max','minLength','maxLength','pattern','extensions'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid FieldDefinition validation at %',p_path USING ERRCODE='SB071';
  END IF;
  BEGIN
  IF (p_field->'validation' ? 'min' AND jsonb_typeof(p_field->'validation'->'min')<>'number')
     OR (p_field->'validation' ? 'max' AND jsonb_typeof(p_field->'validation'->'max')<>'number')
     OR (p_field->'validation' ? 'min' AND p_field->'validation' ? 'max' AND (p_field->'validation'->>'min')::numeric>(p_field->'validation'->>'max')::numeric)
     OR (p_field->'validation' ? 'minLength' AND (jsonb_typeof(p_field->'validation'->'minLength')<>'number' OR (p_field->'validation'->>'minLength')::numeric<>trunc((p_field->'validation'->>'minLength')::numeric) OR (p_field->'validation'->>'minLength')::numeric NOT BETWEEN 0 AND 100000))
     OR (p_field->'validation' ? 'maxLength' AND (jsonb_typeof(p_field->'validation'->'maxLength')<>'number' OR (p_field->'validation'->>'maxLength')::numeric<>trunc((p_field->'validation'->>'maxLength')::numeric) OR (p_field->'validation'->>'maxLength')::numeric NOT BETWEEN 0 AND 100000))
     OR (p_field->'validation' ? 'minLength' AND p_field->'validation' ? 'maxLength' AND (p_field->'validation'->>'minLength')::integer>(p_field->'validation'->>'maxLength')::integer)
     OR (p_field->'validation' ? 'pattern' AND (jsonb_typeof(p_field->'validation'->'pattern')<>'string' OR length(p_field->'validation'->>'pattern')>1000))
     OR (p_field->'validation' ? 'extensions' AND jsonb_typeof(p_field->'validation'->'extensions')<>'object')
  THEN RAISE EXCEPTION 'invalid FieldDefinition validation at %',p_path USING ERRCODE='SB071'; END IF;
  IF p_field->'validation' ? 'min' THEN PERFORM (p_field->'validation'->>'min')::double precision; END IF;
  IF p_field->'validation' ? 'max' THEN PERFORM (p_field->'validation'->>'max')::double precision; END IF;
  IF p_field->'validation' ? 'pattern' THEN PERFORM '' ~ (p_field->'validation'->>'pattern'); END IF;
  EXCEPTION WHEN invalid_regular_expression OR invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid FieldDefinition validation at %',p_path USING ERRCODE='SB071';
  END;
  IF p_field->'quantity'<>'null'::jsonb THEN
    PERFORM internal.assert_sheet_definition_object(p_field->'quantity',ARRAY['kind','dimension','storageUnit'],ARRAY['kind','dimension','storageUnit','allowedInputUnits','preferredDisplayUnit'],p_path||'.quantity');
    IF p_field->>'logicalType' NOT IN ('integer','decimal') OR length(btrim(p_field->'quantity'->>'kind')) NOT BETWEEN 1 AND 200
       OR length(btrim(p_field->'quantity'->>'dimension')) NOT BETWEEN 1 AND 200 OR length(btrim(p_field->'quantity'->>'storageUnit')) NOT BETWEEN 1 AND 200
       OR (p_field->'quantity' ? 'allowedInputUnits' AND (jsonb_typeof(p_field->'quantity'->'allowedInputUnits')<>'array' OR jsonb_array_length(p_field->'quantity'->'allowedInputUnits')>32))
       OR (p_field->'quantity' ? 'preferredDisplayUnit' AND (jsonb_typeof(p_field->'quantity'->'preferredDisplayUnit')<>'string' OR length(btrim(p_field->'quantity'->>'preferredDisplayUnit')) NOT BETWEEN 1 AND 200))
    THEN RAISE EXCEPTION 'invalid FieldDefinition quantity at %',p_path USING ERRCODE='SB071'; END IF;
    IF p_field->'quantity' ? 'allowedInputUnits' THEN
      FOR unit IN SELECT value FROM jsonb_array_elements(p_field->'quantity'->'allowedInputUnits') LOOP
        IF jsonb_typeof(unit)<>'string' OR length(btrim(unit#>>'{}')) NOT BETWEEN 1 AND 200 OR unit#>>'{}'=ANY(units) THEN RAISE EXCEPTION 'invalid or duplicate FieldDefinition input unit' USING ERRCODE='SB071'; END IF;
        units:=array_append(units,unit#>>'{}');
      END LOOP;
    END IF;
    IF p_field->'quantity' ? 'preferredDisplayUnit' AND p_field->'quantity'->>'preferredDisplayUnit'<>p_field->'quantity'->>'storageUnit' AND p_field->'quantity'->>'preferredDisplayUnit'<>ALL(units) THEN RAISE EXCEPTION 'preferred display unit must be a storage or input unit' USING ERRCODE='SB071'; END IF;
  END IF;
  IF p_field->>'cardinality'='many' AND p_field->'defaultValue'<>'null'::jsonb THEN RAISE EXCEPTION 'many FieldDefinitions cannot have defaults' USING ERRCODE='SB071'; END IF;
  IF p_field->'defaultValue'<>'null'::jsonb AND NOT internal.sheet_definition_scalar_matches(p_field->>'logicalType',p_field->'defaultValue') THEN RAISE EXCEPTION 'FieldDefinition default does not match logical type' USING ERRCODE='SB071'; END IF;
  IF p_field->>'logicalType'='category' THEN
    IF jsonb_typeof(p_field->'category')<>'object' OR p_field->'category'->>'kind' NOT IN ('embedded','vocabulary') THEN RAISE EXCEPTION 'category FieldDefinition requires a source' USING ERRCODE='SB071'; END IF;
    IF p_field->'category'->>'kind'='embedded' THEN
      PERFORM internal.assert_sheet_definition_object(p_field->'category',ARRAY['kind','options'],ARRAY['kind','options'],p_path||'.category');
      IF jsonb_typeof(p_field->'category'->'options')<>'array' OR jsonb_array_length(p_field->'category'->'options')>256 THEN RAISE EXCEPTION 'invalid embedded category options' USING ERRCODE='SB071'; END IF;
      FOR option IN SELECT value FROM jsonb_array_elements(p_field->'category'->'options') LOOP
        PERFORM internal.assert_sheet_definition_object(option,ARRAY['id','key','label','displayOrder','lifecycle'],ARRAY['id','key','label','displayOrder','lifecycle'],p_path||'.category.options');
        PERFORM internal.sheet_definition_uuid(option->>'id',p_path||'.category.options.id');
        IF option->>'id'=ANY(ids) OR option->>'key'=ANY(keys) OR option->>'key' !~ '^[a-z][a-z0-9_]{0,59}$'
           OR length(btrim(option->>'label')) NOT BETWEEN 1 AND 200 OR jsonb_typeof(option->'displayOrder')<>'number' OR (option->>'displayOrder')::numeric<>trunc((option->>'displayOrder')::numeric) OR (option->>'displayOrder')::numeric NOT BETWEEN 0 AND 10000
           OR option->>'lifecycle' NOT IN ('active','retired') THEN RAISE EXCEPTION 'invalid or duplicate embedded category option' USING ERRCODE='SB071'; END IF;
        ids:=array_append(ids,option->>'id'); keys:=array_append(keys,option->>'key');
      END LOOP;
      IF p_field->'defaultValue'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_field->'category'->'options') value WHERE value->>'id'=p_field->>'defaultValue' AND value->>'lifecycle'='active') THEN RAISE EXCEPTION 'category default must name an active option' USING ERRCODE='SB071'; END IF;
    ELSE
      PERFORM internal.assert_sheet_definition_object(p_field->'category',ARRAY['kind','vocabularyId'],ARRAY['kind','vocabularyId'],p_path||'.category');
      PERFORM internal.sheet_definition_uuid(p_field->'category'->>'vocabularyId',p_path||'.category.vocabularyId');
    END IF;
  ELSIF p_field->'category'<>'null'::jsonb THEN RAISE EXCEPTION 'only category FieldDefinitions may define category metadata' USING ERRCODE='SB071'; END IF;
  IF p_field->>'logicalType'='reference' THEN
    PERFORM internal.assert_sheet_definition_object(p_field->'relationship',ARRAY['target','cardinality'],ARRAY['target','cardinality'],p_path||'.relationship');
    target:=p_field->'relationship'->'target';
    IF jsonb_typeof(target)<>'object' OR target->>'kind' NOT IN ('model','dataset-schema') OR p_field->'relationship'->>'cardinality'<>p_field->>'cardinality' THEN RAISE EXCEPTION 'invalid FieldDefinition relationship' USING ERRCODE='SB071'; END IF;
    IF target->>'kind'='model' THEN
      PERFORM internal.assert_sheet_definition_object(target,ARRAY['kind','modelKey'],ARRAY['kind','modelKey'],p_path||'.relationship.target');
      IF target->>'modelKey' !~ '^[a-z][a-z0-9_]{0,59}$' THEN RAISE EXCEPTION 'invalid relationship model key' USING ERRCODE='SB071'; END IF;
    ELSE
      PERFORM internal.assert_sheet_definition_object(target,ARRAY['kind','schemaId'],ARRAY['kind','schemaId'],p_path||'.relationship.target');
      PERFORM internal.sheet_definition_uuid(target->>'schemaId',p_path||'.relationship.target.schemaId');
    END IF;
  ELSIF p_field->'relationship'<>'null'::jsonb THEN RAISE EXCEPTION 'only reference FieldDefinitions may define relationships' USING ERRCODE='SB071'; END IF;
  IF jsonb_typeof(p_field->'computation')<>'object' OR p_field->'computation'->>'mode' NOT IN ('stored','computed') THEN RAISE EXCEPTION 'invalid FieldDefinition computation' USING ERRCODE='SB071'; END IF;
  IF p_field->'computation'->>'mode'='stored' THEN
    PERFORM internal.assert_sheet_definition_object(p_field->'computation',ARRAY['mode'],ARRAY['mode'],p_path||'.computation');
  ELSE
    PERFORM internal.assert_sheet_definition_object(p_field->'computation',ARRAY['mode','expressionId'],ARRAY['mode','expressionId'],p_path||'.computation');
    PERFORM internal.sheet_definition_uuid(p_field->'computation'->>'expressionId',p_path||'.computation.expressionId');
    IF p_field->'defaultValue'<>'null'::jsonb THEN RAISE EXCEPTION 'computed FieldDefinitions cannot have defaults' USING ERRCODE='SB071'; END IF;
  END IF;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.validate_sheet_instance_state_core037(p_state jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE identity jsonb:=p_state->'resolvedRowIdentity'; identity_column text; logical_type text;
BEGIN
  PERFORM internal.validate_sheet_instance_state_core034(p_state-'resolvedRowIdentity');
  IF identity IS NOT NULL THEN
    PERFORM internal.assert_sheet_definition_object(identity,ARRAY['formatVersion','kind','columnIds','logicalTypes','sourceBindingId','sourceFieldId'],ARRAY['formatVersion','kind','columnIds','logicalTypes','sourceBindingId','sourceFieldId'],'resolvedRowIdentity');
    IF identity->>'formatVersion'<>'1' OR identity->>'kind' NOT IN ('source','composite','local') OR jsonb_typeof(identity->'columnIds')<>'array' OR jsonb_typeof(identity->'logicalTypes')<>'array' OR jsonb_array_length(identity->'columnIds')<>jsonb_array_length(identity->'logicalTypes') OR jsonb_array_length(identity->'columnIds') NOT BETWEEN 1 AND 8 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(identity->'columnIds') x GROUP BY x HAVING count(*)>1) OR jsonb_typeof(identity->'sourceBindingId') NOT IN ('string','null') OR jsonb_typeof(identity->'sourceFieldId') NOT IN ('string','null') THEN RAISE EXCEPTION 'invalid resolved row identity' USING ERRCODE='SB073'; END IF;
    FOR identity_column IN SELECT value FROM jsonb_array_elements_text(identity->'columnIds') LOOP PERFORM internal.sheet_definition_uuid(identity_column,'resolvedRowIdentity.columnIds'); END LOOP;
    FOR logical_type IN SELECT value FROM jsonb_array_elements_text(identity->'logicalTypes') LOOP IF logical_type NOT IN ('text','integer','decimal','boolean','date','timestamp','category','reference','time','duration','well','person') THEN RAISE EXCEPTION 'invalid resolved row identity logical type' USING ERRCODE='SB073'; END IF; END LOOP;
    IF (identity->>'kind'='source' AND (jsonb_array_length(identity->'columnIds')<>1 OR jsonb_typeof(identity->'sourceBindingId')<>'string' OR jsonb_typeof(identity->'sourceFieldId')<>'string')) OR (identity->>'kind' IN ('composite','local') AND (identity->'sourceBindingId' IS DISTINCT FROM 'null'::jsonb OR identity->'sourceFieldId' IS DISTINCT FROM 'null'::jsonb)) OR (identity->>'kind'='local' AND identity->'logicalTypes'->>0<>'reference') THEN RAISE EXCEPTION 'invalid row identity provenance' USING ERRCODE='SB073'; END IF;
    IF identity->>'kind'='source' THEN PERFORM internal.sheet_definition_uuid(identity->>'sourceBindingId','resolvedRowIdentity.sourceBindingId'); PERFORM internal.sheet_definition_uuid(identity->>'sourceFieldId','resolvedRowIdentity.sourceFieldId'); END IF;
  END IF;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.create_dataset_structure_from_file(p_workspace_id uuid, p_name text, p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_key text;
  v_base text;
  item jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF api.has_capability(p_workspace_id, 'work.datasets') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs work.datasets' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'name the dataset' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields) = 0 THEN
    RAISE EXCEPTION 'keep at least one column' USING ERRCODE = '22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_fields) LOOP
    IF coalesce(item->>'logical_type', '') NOT IN ('text', 'integer', 'decimal', 'boolean', 'date', 'timestamp', 'time', 'duration', 'well') THEN
      RAISE EXCEPTION 'unsupported column type %', item->>'logical_type' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_base := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '_', 'g');
  v_base := btrim(v_base, '_');
  IF v_base !~ '^[a-z]' THEN v_base := 'file_' || v_base; END IF;
  v_base := left(v_base, 46);
  LOOP
    v_key := v_base || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM api.dataset_schema_definitions d
                           WHERE d.workspace_id = p_workspace_id AND d.key = v_key);
  END LOOP;
  RETURN internal.create_published_dataset_structure(
    p_workspace_id, api.current_user_id(), v_key, p_name,
    'Made from an imported file.', p_fields, 'import');
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.sheet_definition_scalar_matches(p_type text, p_value jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE value_text text;
BEGIN
  IF p_value IS NULL THEN RETURN false; END IF;
  value_text:=p_value#>>'{}';
  IF p_type='text' THEN RETURN jsonb_typeof(p_value)='string';
  ELSIF p_type='integer' THEN
    RETURN jsonb_typeof(p_value)='number' AND value_text::numeric=trunc(value_text::numeric)
      AND value_text::numeric BETWEEN -9007199254740991 AND 9007199254740991;
  ELSIF p_type='decimal' THEN
    IF jsonb_typeof(p_value)<>'number' THEN RETURN false; END IF;
    PERFORM value_text::double precision; RETURN true;
  ELSIF p_type='boolean' THEN RETURN jsonb_typeof(p_value)='boolean';
  ELSIF p_type='date' THEN
    RETURN jsonb_typeof(p_value)='string' AND internal.sheet_definition_date_matches(value_text);
  ELSIF p_type='timestamp' THEN
    RETURN jsonb_typeof(p_value)='string' AND internal.sheet_definition_timestamp_matches(value_text);
  ELSIF p_type='time' THEN
    RETURN jsonb_typeof(p_value)='string' AND internal.lab_time_or_null(value_text) IS NOT NULL;
  ELSIF p_type='duration' THEN
    RETURN internal.lab_duration_seconds(p_value) IS NOT NULL;
  ELSIF p_type='well' THEN
    RETURN jsonb_typeof(p_value)='string' AND coalesce(internal.lab_well_or_null(value_text) = value_text, false);
  ELSIF p_type='person' THEN
    RETURN jsonb_typeof(p_value)='string' AND btrim(value_text)<>'';
  ELSIF p_type IN ('category','reference') THEN
    IF jsonb_typeof(p_value)<>'string' THEN RETURN false; END IF;
    PERFORM internal.sheet_definition_uuid(value_text,'scalar'); RETURN true;
  END IF;
  RETURN false;
EXCEPTION WHEN others THEN RETURN false;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.validate_model_fields(p_workspace uuid, p_model text, p_new jsonb, p_old jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d record; k text; v jsonb; out jsonb:=coalesce(p_new,'{}'); target api.records;
BEGIN
 IF jsonb_typeof(out)<>'object' THEN RAISE EXCEPTION 'custom_fields must be an object' USING ERRCODE='22023'; END IF;
 FOR d IN SELECT * FROM api.record_field_definitions
   WHERE workspace_id=p_workspace AND kind=p_model AND lifecycle='retired' AND coalesce(p_old,'{}') ? field_name
 LOOP
   IF NOT out ? d.field_name OR out->d.field_name IS DISTINCT FROM p_old->d.field_name THEN
     RAISE EXCEPTION 'retired custom field % is immutable',d.field_name USING ERRCODE='SB070';
   END IF;
 END LOOP;
 FOR k IN SELECT jsonb_object_keys(out) LOOP
   IF EXISTS(SELECT 1 FROM api.model_base_fields WHERE model_key=p_model AND field_key=k) THEN RAISE EXCEPTION 'protected custom field: %',k USING ERRCODE='SB070'; END IF;
   SELECT * INTO d FROM api.record_field_definitions WHERE workspace_id=p_workspace AND kind=p_model AND field_name=k;
   IF NOT FOUND THEN RAISE EXCEPTION 'unknown custom field: %',k USING ERRCODE='SB070'; END IF;
   IF d.lifecycle NOT IN ('active','backfilling') THEN
     IF NOT coalesce(p_old,'{}') ? k OR p_old->k IS DISTINCT FROM out->k THEN RAISE EXCEPTION 'retired custom field: %',k USING ERRCODE='SB070'; END IF;
     CONTINUE;
   END IF;
   v:=out->k;
   IF v='null' AND NOT d.nullable THEN RAISE EXCEPTION 'field % may not be null',k USING ERRCODE='SB071'; END IF;
   IF v='null' THEN CONTINUE; END IF;
   IF (d.logical_type='text' AND jsonb_typeof(v)<>'string') OR
      (d.logical_type='integer' AND (jsonb_typeof(v)<>'number' OR (v#>>'{}') !~ '^-?[0-9]+$')) OR
      (d.logical_type IN ('decimal','duration') AND jsonb_typeof(v)<>'number') OR
      (d.logical_type='boolean' AND jsonb_typeof(v)<>'boolean') OR
      (d.logical_type IN ('date','timestamp','time','well','person','category','reference') AND jsonb_typeof(v)<>'string') THEN
      RAISE EXCEPTION 'invalid % value for %',d.logical_type,k USING ERRCODE='SB071'; END IF;
   IF d.logical_type='date' THEN BEGIN PERFORM (v#>>'{}')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid date' USING ERRCODE='SB071'; END; END IF;
   IF d.logical_type='timestamp' THEN BEGIN PERFORM (v#>>'{}')::timestamptz; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid timestamp' USING ERRCODE='SB071'; END; END IF;
   IF d.logical_type='time' THEN BEGIN v:=to_jsonb(internal.lab_time_text(v#>>'{}')); out:=jsonb_set(out,ARRAY[k],v); EXCEPTION WHEN others THEN RAISE EXCEPTION '%: use a time such as 09:30', d.label USING ERRCODE='SB071'; END; END IF;
   IF d.logical_type='duration' THEN BEGIN PERFORM internal.lab_duration_seconds(v); EXCEPTION WHEN others THEN RAISE EXCEPTION '%: use a duration of zero or more', d.label USING ERRCODE='SB071'; END; END IF;
   IF d.logical_type='well' THEN BEGIN v:=to_jsonb(internal.lab_well_text(v#>>'{}')); out:=jsonb_set(out,ARRAY[k],v); EXCEPTION WHEN others THEN RAISE EXCEPTION '%: use a well such as A1 or H12', d.label USING ERRCODE='SB071'; END; END IF;
   IF d.logical_type='person' AND NOT internal.lab_is_workspace_person(p_workspace,v#>>'{}') THEN RAISE EXCEPTION '%: choose someone in this workspace', d.label USING ERRCODE='SB071'; END IF;
   IF d.logical_type='text' AND ((d.validation ? 'minLength' AND length(v#>>'{}')<(d.validation->>'minLength')::integer) OR (d.validation ? 'maxLength' AND length(v#>>'{}')>(d.validation->>'maxLength')::integer) OR (d.validation ? 'regex' AND NOT (v#>>'{}' ~ (d.validation->>'regex')))) THEN RAISE EXCEPTION 'text validation failed for %',k USING ERRCODE='SB071'; END IF;
   IF d.logical_type IN ('integer','decimal') AND ((d.validation ? 'min' AND (v#>>'{}')::numeric<(d.validation->>'min')::numeric) OR (d.validation ? 'max' AND (v#>>'{}')::numeric>(d.validation->>'max')::numeric)) THEN RAISE EXCEPTION 'numeric validation failed for %',k USING ERRCODE='SB071'; END IF;
   PERFORM internal.check_plugin_field_type(p_workspace, p_model, k, d.label, d.logical_type, v);
   IF d.logical_type='category' AND NOT EXISTS(SELECT 1 FROM api.model_field_options o WHERE o.definition_id=d.id AND o.key=v#>>'{}' AND (o.lifecycle='active' OR p_old->k IS NOT DISTINCT FROM v)) THEN RAISE EXCEPTION 'inactive category option' USING ERRCODE='SB071'; END IF;
   IF d.logical_type='reference' THEN
     IF d.validation->>'targetModelKey' IS NULL THEN RAISE EXCEPTION 'reference targetModelKey required' USING ERRCODE='SB071'; END IF;
     BEGIN
       SELECT r.* INTO target FROM api.records r JOIN api.model_kinds m ON m.record_kind=r.kind
        WHERE r.id=(v#>>'{}')::uuid AND r.workspace_id=p_workspace AND m.key=d.validation->>'targetModelKey'
          AND (r.deleted_at IS NULL OR p_old->k IS NOT DISTINCT FROM v);
     EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid reference' USING ERRCODE='SB071'; END;
     IF NOT FOUND THEN RAISE EXCEPTION 'invalid reference' USING ERRCODE='SB071'; END IF;
   END IF;
 END LOOP;
 FOR d IN SELECT * FROM api.record_field_definitions WHERE workspace_id=p_workspace AND kind=p_model AND lifecycle='active' LOOP
   IF NOT out ? d.field_name AND d.default_value IS NOT NULL THEN out:=out||jsonb_build_object(d.field_name,d.default_value); END IF;
   IF NOT d.nullable AND (NOT out ? d.field_name OR out->d.field_name='null') THEN RAISE EXCEPTION 'required field % missing',d.field_name USING ERRCODE='SB071'; END IF;
 END LOOP;
 RETURN out;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.validate_versioned_model_fields(p_workspace uuid, p_model text, p_new jsonb, p_old jsonb, p_version uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d record; k text; v jsonb; out jsonb:=coalesce(p_new,'{}'); target api.records;
BEGIN
 IF jsonb_typeof(out)<>'object' THEN RAISE EXCEPTION 'custom_fields must be an object' USING ERRCODE='22023'; END IF;
 FOR d IN SELECT * FROM internal.record_model_fields(p_workspace,p_model,p_version)
   WHERE workspace_id=p_workspace AND kind=p_model AND lifecycle='retired' AND coalesce(p_old,'{}') ? field_name
 LOOP
   IF NOT out ? d.field_name OR out->d.field_name IS DISTINCT FROM p_old->d.field_name THEN
     RAISE EXCEPTION 'retired custom field % is immutable',d.field_name USING ERRCODE='SB070';
   END IF;
 END LOOP;
 FOR k IN SELECT jsonb_object_keys(out) LOOP
   IF EXISTS(SELECT 1 FROM api.model_base_fields WHERE model_key=p_model AND field_key=k) THEN RAISE EXCEPTION 'protected custom field: %',k USING ERRCODE='SB070'; END IF;
   SELECT * INTO d FROM internal.record_model_fields(p_workspace,p_model,p_version) WHERE workspace_id=p_workspace AND kind=p_model AND field_name=k;
   IF NOT FOUND THEN RAISE EXCEPTION 'unknown custom field: %',k USING ERRCODE='SB070'; END IF;
   IF d.lifecycle NOT IN ('active','backfilling') THEN
     IF NOT coalesce(p_old,'{}') ? k OR p_old->k IS DISTINCT FROM out->k THEN RAISE EXCEPTION 'retired custom field: %',k USING ERRCODE='SB070'; END IF;
     CONTINUE;
   END IF;
   v:=out->k;
   IF v='null' AND NOT d.nullable THEN RAISE EXCEPTION 'field % may not be null',k USING ERRCODE='SB071'; END IF;
   IF v='null' THEN CONTINUE; END IF;
   IF (d.logical_type='text' AND jsonb_typeof(v)<>'string') OR
      (d.logical_type='integer' AND (jsonb_typeof(v)<>'number' OR (v#>>'{}') !~ '^-?[0-9]+$')) OR
      (d.logical_type IN ('decimal','duration') AND jsonb_typeof(v)<>'number') OR
      (d.logical_type='boolean' AND jsonb_typeof(v)<>'boolean') OR
      (d.logical_type IN ('date','timestamp','time','well','person','category','reference') AND jsonb_typeof(v)<>'string') THEN
      RAISE EXCEPTION 'invalid % value for %',d.logical_type,k USING ERRCODE='SB071'; END IF;
   IF d.logical_type='date' THEN BEGIN PERFORM (v#>>'{}')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid date' USING ERRCODE='SB071'; END; END IF;
   IF d.logical_type='timestamp' THEN BEGIN PERFORM (v#>>'{}')::timestamptz; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid timestamp' USING ERRCODE='SB071'; END; END IF;
   IF d.logical_type='time' THEN BEGIN v:=to_jsonb(internal.lab_time_text(v#>>'{}')); out:=jsonb_set(out,ARRAY[k],v); EXCEPTION WHEN others THEN RAISE EXCEPTION '%: use a time such as 09:30', d.label USING ERRCODE='SB071'; END; END IF;
   IF d.logical_type='duration' THEN BEGIN PERFORM internal.lab_duration_seconds(v); EXCEPTION WHEN others THEN RAISE EXCEPTION '%: use a duration of zero or more', d.label USING ERRCODE='SB071'; END; END IF;
   IF d.logical_type='well' THEN BEGIN v:=to_jsonb(internal.lab_well_text(v#>>'{}')); out:=jsonb_set(out,ARRAY[k],v); EXCEPTION WHEN others THEN RAISE EXCEPTION '%: use a well such as A1 or H12', d.label USING ERRCODE='SB071'; END; END IF;
   IF d.logical_type='person' AND NOT internal.lab_is_workspace_person(p_workspace,v#>>'{}') THEN RAISE EXCEPTION '%: choose someone in this workspace', d.label USING ERRCODE='SB071'; END IF;
   IF d.logical_type='text' AND ((d.validation ? 'minLength' AND length(v#>>'{}')<(d.validation->>'minLength')::integer) OR (d.validation ? 'maxLength' AND length(v#>>'{}')>(d.validation->>'maxLength')::integer) OR (d.validation ? 'regex' AND NOT (v#>>'{}' ~ (d.validation->>'regex')))) THEN RAISE EXCEPTION 'text validation failed for %',k USING ERRCODE='SB071'; END IF;
   IF d.logical_type IN ('integer','decimal') AND ((d.validation ? 'min' AND (v#>>'{}')::numeric<(d.validation->>'min')::numeric) OR (d.validation ? 'max' AND (v#>>'{}')::numeric>(d.validation->>'max')::numeric)) THEN RAISE EXCEPTION 'numeric validation failed for %',k USING ERRCODE='SB071'; END IF;
   IF d.logical_type='category' AND NOT EXISTS(SELECT 1 FROM internal.record_model_options(p_version,d.id) o WHERE o.definition_id=d.id AND o.key=v#>>'{}' AND (o.lifecycle='active' OR p_old->k IS NOT DISTINCT FROM v)) THEN RAISE EXCEPTION 'inactive category option' USING ERRCODE='SB071'; END IF;
   IF d.logical_type='reference' THEN
     IF d.validation->>'targetModelKey' IS NULL THEN RAISE EXCEPTION 'reference targetModelKey required' USING ERRCODE='SB071'; END IF;
     BEGIN
       SELECT r.* INTO target FROM api.records r JOIN (SELECT key,record_kind FROM api.model_kinds UNION ALL SELECT key,key FROM api.record_models WHERE workspace_id=p_workspace) m ON m.record_kind=r.kind
        WHERE r.id=(v#>>'{}')::uuid AND r.workspace_id=p_workspace AND m.key=d.validation->>'targetModelKey'
          AND (r.deleted_at IS NULL OR p_old->k IS NOT DISTINCT FROM v);
     EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid reference' USING ERRCODE='SB071'; END;
     IF NOT FOUND THEN RAISE EXCEPTION 'invalid reference' USING ERRCODE='SB071'; END IF;
   END IF;
 END LOOP;
 FOR d IN SELECT * FROM internal.record_model_fields(p_workspace,p_model,p_version) WHERE workspace_id=p_workspace AND kind=p_model AND lifecycle='active' LOOP
   IF p_old IS NULL AND NOT out ? d.field_name AND d.default_value IS NOT NULL THEN out:=out||jsonb_build_object(d.field_name,d.default_value); END IF;
   IF NOT d.nullable AND (NOT out ? d.field_name OR out->d.field_name='null') THEN RAISE EXCEPTION 'required field % missing',d.field_name USING ERRCODE='SB071'; END IF;
 END LOOP;
 RETURN out;
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.validate_record_properties()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_def record;
  v_value jsonb;
  v_raw text;
  v_enum text[];
BEGIN
  -- Only kinds that use configurable properties have definitions.
  IF NEW.kind NOT IN ('sample', 'material', 'protocol_template') THEN
    RETURN NEW;
  END IF;
  IF NEW.properties IS NULL THEN
    NEW.properties := '{}'::jsonb;
  END IF;

  FOR v_def IN
    SELECT field_name, logical_type, nullable, validation
      FROM "api"."record_field_definitions"
      WHERE workspace_id = NEW.workspace_id
        AND kind = NEW.kind
        AND lifecycle = 'active'
  LOOP
    v_value := NEW.properties -> v_def.field_name;
    -- A missing key is null for validation purposes.
    IF jsonb_typeof(v_value) = 'null' OR v_value IS NULL THEN
      IF NOT v_def.nullable THEN
        RAISE EXCEPTION 'property "%" is required for kind %',
          v_def.field_name, NEW.kind USING ERRCODE = 'SB005';
      END IF;
      CONTINUE;
    END IF;

    -- Type-check the value against the logical_type.
    v_raw := v_value #>> '{}';
    CASE v_def.logical_type
      WHEN 'text' THEN
        IF jsonb_typeof(v_value) <> 'string' THEN
          RAISE EXCEPTION 'property "%" must be text', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'integer' THEN
        IF jsonb_typeof(v_value) <> 'number'
           OR v_raw !~ '^-?[0-9]+$' THEN
          RAISE EXCEPTION 'property "%" must be an integer', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'decimal' THEN
        IF jsonb_typeof(v_value) <> 'number'
           OR v_raw !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
          RAISE EXCEPTION 'property "%" must be a decimal number', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'boolean' THEN
        IF jsonb_typeof(v_value) <> 'boolean' THEN
          RAISE EXCEPTION 'property "%" must be a boolean', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'date' THEN
        IF jsonb_typeof(v_value) <> 'string'
           OR v_raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           OR v_raw::date IS NULL THEN
          RAISE EXCEPTION 'property "%" must be a date (YYYY-MM-DD)', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'timestamp' THEN
        IF jsonb_typeof(v_value) <> 'string' THEN
          RAISE EXCEPTION 'property "%" must be a timestamp', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'time' THEN
        IF jsonb_typeof(v_value) <> 'string' OR internal.lab_time_or_null(v_raw) IS NULL THEN
          RAISE EXCEPTION 'property "%" must be a time (HH:MM)', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'well' THEN
        IF jsonb_typeof(v_value) <> 'string' OR internal.lab_well_or_null(v_raw) IS NULL THEN
          RAISE EXCEPTION 'property "%" must be a well position such as A1', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'person' THEN
        IF jsonb_typeof(v_value) <> 'string' OR NOT internal.lab_is_workspace_person(NEW.workspace_id, v_raw) THEN
          RAISE EXCEPTION 'property "%" must be someone in this workspace', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'duration' THEN
        IF jsonb_typeof(v_value) <> 'number' OR v_raw::numeric < 0 THEN
          RAISE EXCEPTION 'property "%" must be a duration in seconds', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'category' THEN
        IF jsonb_typeof(v_value) <> 'string' THEN
          RAISE EXCEPTION 'property "%" must be a category string', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
        v_enum := COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(v_def.validation -> 'enum')),
          ARRAY[]::text[]
        );
        IF array_length(v_enum, 1) IS NOT NULL AND NOT (v_raw = ANY(v_enum)) THEN
          RAISE EXCEPTION 'property "%" must be one of: %',
            v_def.field_name, array_to_string(v_enum, ', ')
            USING ERRCODE = 'SB005';
        END IF;
      ELSE
        RAISE EXCEPTION 'unknown logical_type "%" for field "%"',
          v_def.logical_type, v_def.field_name USING ERRCODE = 'SB005';
    END CASE;
  END LOOP;

  RETURN NEW;
END;
$function$;
--> statement-breakpoint
