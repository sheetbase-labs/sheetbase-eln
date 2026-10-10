-- DSET-01.1 — system rule-generated value flags: missing_unit and high_cv.
--
-- Rules live in `dataset_schema_version_fields.validation.extensions.systemFlags`:
--
--   "out_of_range": { "min": 2, "max": 4 }                     (existing)
--   "missing_unit": { "requiresUnit": true }                   (new)
--   "high_cv":      { "maxCvPercent": 20,                      (new)
--                     "groupByFieldId": "<uuid>",
--                     "minReplicates": 3 }
--
-- `above_curve` is deliberately not implemented yet (no calibration-curve
-- store); see docs/knowledge/roadmap-4/tasks/DSET.md.
--
-- Evaluation stays in the write path, matching the existing out_of_range rule:
-- `validate_dataset_row_batch` previews the row-level rules for a written row,
-- `commit_dataset_row_batch` reconciles them against the committed values and
-- recomputes high_cv across the dataset (a per-row rule cannot see a group).
-- `recompute_dataset_system_flags` re-runs everything on demand, so a rule
-- change does not have to wait for the next edit.

-- The stored text value of a field on a row, preferring an in-flight provided
-- value (validation runs before a batch is written).
CREATE OR REPLACE FUNCTION internal.dataset_row_field_value_text(
  p_row_id uuid,
  p_field_id uuid,
  p_provided jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v text;
BEGIN
  IF p_provided IS NOT NULL AND p_provided ? p_field_id::text THEN
    IF p_provided -> p_field_id::text = 'null'::jsonb THEN RETURN NULL; END IF;
    RETURN p_provided ->> p_field_id::text;
  END IF;
  SELECT coalesce(
           v.text_value,
           v.integer_value::text,
           v.numeric_value::text,
           v.boolean_value::text,
           v.date_value::text,
           v.timestamp_value::text,
           v.category_option_id::text,
           v.reference_id::text
         )
    INTO v
    FROM api.dataset_row_values v
   WHERE v.row_id = p_row_id AND v.field_id = p_field_id
   ORDER BY v.ordinal
   LIMIT 1;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.dataset_row_field_value_text(uuid, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint

-- The numeric value of a field on a row, or NULL when it is not numeric.
CREATE OR REPLACE FUNCTION internal.dataset_row_field_numeric(
  p_row_id uuid,
  p_field_id uuid
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v numeric;
BEGIN
  SELECT coalesce(v.numeric_value, v.integer_value::numeric)
    INTO v
    FROM api.dataset_row_values v
   WHERE v.row_id = p_row_id AND v.field_id = p_field_id
   ORDER BY v.ordinal
   LIMIT 1;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.dataset_row_field_numeric(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint

-- Write, refresh or clear one system flag with its provenance. Only
-- `source = 'system'` rows are touched, so a manual flag on the same value is
-- preserved. A person may dismiss a system flag by clearing it with a reason;
-- that override stands while the evaluated value is unchanged.
CREATE OR REPLACE FUNCTION internal.apply_system_flag(
  p_workspace_id uuid,
  p_dataset_id uuid,
  p_row_id uuid,
  p_field_id uuid,
  p_kind text,
  p_reason text,
  p_evaluated jsonb,
  p_threshold jsonb,
  p_violated boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_violated THEN
    IF EXISTS (
      SELECT 1 FROM api.dataset_value_flags f
       WHERE f.dataset_id = p_dataset_id AND f.row_id = p_row_id
         AND f.field_id = p_field_id AND f.kind = p_kind
         AND f.source = 'system' AND f.cleared_reason IS NOT NULL
         AND f.evaluated_value IS NOT DISTINCT FROM p_evaluated
    ) THEN
      -- A person reviewed exactly this value and dismissed the rule; keep it
      -- dismissed, and never leave a stale active flag behind.
      UPDATE api.dataset_value_flags
         SET cleared_at = now(), cleared_by_user_id = api.current_user_id()
       WHERE dataset_id = p_dataset_id AND row_id = p_row_id
         AND field_id = p_field_id AND kind = p_kind
         AND source = 'system' AND cleared_at IS NULL;
      RETURN;
    END IF;
    INSERT INTO api.dataset_value_flags
      (workspace_id, dataset_id, row_id, field_id, kind, source, system_rule,
       reason, evaluated_value, threshold, evaluated_at, set_by_user_id, set_at)
    VALUES
      (p_workspace_id, p_dataset_id, p_row_id, p_field_id, p_kind, 'system',
       p_kind, left(p_reason, 200), p_evaluated, p_threshold, now(),
       api.current_user_id(), now())
    ON CONFLICT (dataset_id, row_id, field_id, kind, source) WHERE cleared_at IS NULL
    DO UPDATE SET reason = left(EXCLUDED.reason, 200), comment = NULL,
                  system_rule = EXCLUDED.system_rule,
                  evaluated_value = EXCLUDED.evaluated_value,
                  threshold = EXCLUDED.threshold,
                  evaluated_at = now(),
                  set_by_user_id = EXCLUDED.set_by_user_id, set_at = now();
  ELSE
    UPDATE api.dataset_value_flags
       SET cleared_at = now(), cleared_by_user_id = api.current_user_id()
     WHERE dataset_id = p_dataset_id AND row_id = p_row_id
       AND field_id = p_field_id AND kind = p_kind
       AND source = 'system' AND cleared_at IS NULL;
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.apply_system_flag(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, boolean) FROM PUBLIC;
--> statement-breakpoint

-- Reconcile the row-level rules for one row: out_of_range (a soft min/max) and
-- missing_unit (the Schema declares a unit is required but none is recorded).
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
  has_value boolean;
  unit_text text;
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
    -- out_of_range: exactly the existing soft min/max rule, now with provenance.
    rule := field.validation #> '{extensions,systemFlags,out_of_range}';
    violated := false;
    v_reason := NULL;
    v_num := NULL;
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
    PERFORM internal.apply_system_flag(
      workspace, p_dataset_id, p_row_id, field.field_id, 'out_of_range',
      coalesce(v_reason, 'Out of range rule now passes'),
      to_jsonb(v_num),
      jsonb_strip_nulls(jsonb_build_object('min', rule -> 'min', 'max', rule -> 'max')),
      violated);

    -- missing_unit: opt-in per field, numeric fields only, and pinned to the
    -- Schema's unit metadata rather than the value.
    rule := field.validation #> '{extensions,systemFlags,missing_unit}';
    violated := false;
    v_reason := NULL;
    has_value := (p_provided ? field.field_id::text
                  AND p_provided -> field.field_id::text <> 'null'::jsonb)
                 OR internal.dataset_row_field_value_text(p_row_id, field.field_id) IS NOT NULL;
    unit_text := nullif(btrim(coalesce(field.quantity ->> 'storageUnit', field.quantity ->> 'symbol')), '');
    IF rule IS NOT NULL AND jsonb_typeof(rule) = 'object'
       AND coalesce((rule ->> 'requiresUnit')::boolean, false) IS TRUE
       AND field.logical_type IN ('integer','decimal')
       AND has_value AND unit_text IS NULL THEN
      violated := true;
      v_reason := format('No unit is recorded for %s', field.label);
    END IF;
    PERFORM internal.apply_system_flag(
      workspace, p_dataset_id, p_row_id, field.field_id, 'missing_unit',
      coalesce(v_reason, 'Unit now recorded'),
      to_jsonb(unit_text),
      jsonb_build_object('requiresUnit', true),
      violated);
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.sync_dataset_value_system_flags(uuid, uuid, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint

-- Recompute high_cv across a whole dataset. A replicate group is the rows that
-- share the group field's value; when at least `minReplicates` numeric values
-- have a coefficient of variation above `maxCvPercent`, every value in the
-- group is flagged. Runs after a commit and on demand, never per row.
CREATE OR REPLACE FUNCTION internal.reconcile_dataset_high_cv(
  p_dataset_id uuid,
  p_schema_version_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  workspace uuid;
  hc_field api.dataset_schema_version_fields;
  hc jsonb;
  group_field_id uuid;
  max_cv numeric;
  min_reps integer;
  group_rec record;
  row_rec record;
  cv numeric;
BEGIN
  SELECT d.workspace_id INTO workspace FROM api.datasets d
    WHERE d.id = p_dataset_id AND d.workspace_id = api.current_workspace_id()
      AND api.is_workspace_writer(d.workspace_id) AND api.has_write_actor();
  IF workspace IS NULL THEN RETURN; END IF;

  FOR hc_field IN
    SELECT * FROM api.dataset_schema_version_fields f
     WHERE f.schema_version_id = p_schema_version_id AND f.lifecycle = 'active'
       AND f.logical_type IN ('integer','decimal')
       AND jsonb_typeof(f.validation #> '{extensions,systemFlags,high_cv}') = 'object'
     ORDER BY f.display_order
  LOOP
    hc := hc_field.validation #> '{extensions,systemFlags,high_cv}';
    IF hc ->> 'groupByFieldId' IS NULL OR hc ->> 'maxCvPercent' IS NULL
       OR hc ->> 'groupByFieldId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR hc ->> 'maxCvPercent' !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      CONTINUE;
    END IF;
    group_field_id := (hc ->> 'groupByFieldId')::uuid;
    max_cv := (hc ->> 'maxCvPercent')::numeric;
    min_reps := greatest(coalesce((hc ->> 'minReplicates')::integer, 3), 2);

    -- Start from "passes": anything still violating is re-flagged below.
    UPDATE api.dataset_value_flags f
       SET cleared_at = now(), cleared_by_user_id = api.current_user_id()
     WHERE f.dataset_id = p_dataset_id AND f.field_id = hc_field.field_id
       AND f.kind = 'high_cv' AND f.source = 'system' AND f.cleared_at IS NULL;

    FOR group_rec IN
      SELECT g.group_key, count(*) AS n, avg(g.val) AS mean, stddev_samp(g.val) AS sd
        FROM (
          SELECT internal.dataset_row_field_value_text(r.id, group_field_id) AS group_key,
                 internal.dataset_row_field_numeric(r.id, hc_field.field_id) AS val
            FROM api.dataset_rows r
           WHERE r.dataset_id = p_dataset_id
        ) g
       WHERE g.group_key IS NOT NULL AND g.val IS NOT NULL
       GROUP BY g.group_key
      HAVING count(*) >= min_reps
    LOOP
      IF group_rec.mean IS NOT NULL AND group_rec.mean <> 0 AND group_rec.sd IS NOT NULL THEN
        cv := abs(group_rec.sd / group_rec.mean) * 100;
        IF cv > max_cv THEN
          FOR row_rec IN
            SELECT r.id AS row_id,
                   internal.dataset_row_field_numeric(r.id, hc_field.field_id) AS val
              FROM api.dataset_rows r
             WHERE r.dataset_id = p_dataset_id
               AND internal.dataset_row_field_value_text(r.id, group_field_id) = group_rec.group_key
          LOOP
            IF row_rec.val IS NOT NULL THEN
              PERFORM internal.apply_system_flag(
                workspace, p_dataset_id, row_rec.row_id, hc_field.field_id, 'high_cv',
                format('Replicate CV %s%% exceeds %s%%', round(cv, 2), max_cv),
                to_jsonb(row_rec.val),
                jsonb_build_object(
                  'maxCvPercent', max_cv,
                  'minReplicates', min_reps,
                  'groupByFieldId', group_field_id,
                  'groupKey', group_rec.group_key,
                  'cvPercent', round(cv, 2),
                  'mean', group_rec.mean,
                  'sd', group_rec.sd,
                  'replicateCount', group_rec.n),
                true);
            END IF;
          END LOOP;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.reconcile_dataset_high_cv(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint

-- Clearing a flag now takes a reason. A system flag must have one: the reason
-- and the actor are recorded, the override stands while the value is unchanged,
-- and a rule can only be dismissed by a workspace writer. Manual flags keep
-- their behaviour and a reason stays optional.
DROP FUNCTION IF EXISTS api.clear_dataset_value_flag(uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.clear_dataset_value_flag(
  p_flag_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS api.dataset_value_flags
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.dataset_value_flags;
BEGIN
  SELECT f.* INTO v FROM api.dataset_value_flags f
    WHERE f.id = p_flag_id AND f.workspace_id = api.current_workspace_id()
      AND api.is_workspace_writer(f.workspace_id) AND api.has_write_actor()
    FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'flag not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v.cleared_at IS NOT NULL THEN
    RAISE EXCEPTION 'flag is already cleared' USING ERRCODE = '22023';
  END IF;
  IF v.source = 'system'
     AND (p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 200) THEN
    RAISE EXCEPTION 'a reason is required to clear a system flag' USING ERRCODE = '22023';
  END IF;
  UPDATE api.dataset_value_flags
    SET cleared_at = now(),
        cleared_by_user_id = api.current_user_id(),
        cleared_reason = nullif(btrim(coalesce(p_reason, '')), '')
    WHERE id = v.id
    RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.clear_dataset_value_flag(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.clear_dataset_value_flag(uuid, text) TO authenticated;
--> statement-breakpoint

-- Re-run every system rule over a Dataset's recorded rows, so a rule change is
-- reflected without waiting for the next edit. Writer-gated; returns the number
-- of rows evaluated.
CREATE OR REPLACE FUNCTION api.recompute_dataset_system_flags(p_dataset_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  d api.datasets;
  r record;
  n integer := 0;
BEGIN
  SELECT * INTO d FROM api.datasets
    WHERE id = p_dataset_id AND workspace_id = api.current_workspace_id()
      AND api.is_workspace_writer(workspace_id) AND api.has_write_actor()
    FOR UPDATE;
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'Dataset denied' USING ERRCODE = '42501';
  END IF;
  FOR r IN SELECT id FROM api.dataset_rows WHERE dataset_id = d.id ORDER BY id LOOP
    PERFORM internal.sync_dataset_value_system_flags(d.id, r.id, d.schema_version_id, NULL);
    n := n + 1;
  END LOOP;
  PERFORM internal.reconcile_dataset_high_cv(d.id, d.schema_version_id);
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.recompute_dataset_system_flags(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.recompute_dataset_system_flags(uuid) TO authenticated;
--> statement-breakpoint

-- Commit reconciles the row-level rules after the values are written and then
-- recomputes high_cv once across the dataset's replicate groups.
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
 PERFORM internal.reconcile_dataset_high_cv(dataset.id,dataset.schema_version_id);
 UPDATE api.datasets SET revision=revision+1,updated_at=now() WHERE id=dataset.id RETURNING revision INTO dataset.revision; result:=jsonb_build_object('ok',true,'datasetId',dataset.id,'datasetRevision',dataset.revision,'rows',result_rows,'idempotent',false); INSERT INTO api.dataset_bulk_commits(workspace_id,dataset_id,actor_user_id,actor_credential_id,idempotency_key,request_digest,result) VALUES(dataset.workspace_id,dataset.id,actor_user,actor_credential,p_idempotency_key,digest,result); RETURN result;
END $$;--> statement-breakpoint

-- Snapshots freeze the rule provenance too, so a review can see which flags a
-- person set and which a rule derived, and on what values.
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
  INSERT INTO api.dataset_version_flags(dataset_version_id,row_id,field_id,kind,source,system_rule,reason,comment,evaluated_value,threshold,evaluated_at,set_by_user_id,set_at)
  SELECT version.id,f.row_id,f.field_id,f.kind,f.source,f.system_rule,f.reason,f.comment,f.evaluated_value,f.threshold,f.evaluated_at,f.set_by_user_id,f.set_at
  FROM api.dataset_value_flags f
  WHERE f.dataset_id=dataset.id AND f.cleared_at IS NULL
    AND EXISTS (SELECT 1 FROM api.dataset_version_rows vr WHERE vr.dataset_version_id=version.id AND vr.row_id=f.row_id);
  RETURN version;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.snapshot_dataset(uuid, bigint, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.snapshot_dataset(uuid, bigint, text) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.snapshot_dataset(uuid, bigint, text) TO api_client;--> statement-breakpoint


NOTIFY pgrst, 'reload schema';
