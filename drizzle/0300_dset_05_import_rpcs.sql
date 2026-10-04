-- DSET-05 / DSET-06.1 — import flow persistence, parser registry and the
-- review/commit RPCs.
--
-- The import never writes Dataset rows itself. `api.commit_dataset_import`
-- wraps the one canonical batch writer (`api.commit_dataset_row_batch_atomic`)
-- and then takes exactly one snapshot (`api.snapshot_dataset`) and records one
-- import receipt, in a single transaction. `api.preview_dataset_import_rows`
-- computes the planned/new/flagged/skipped outcomes without writing anything.
--
-- Tables are workspace-scoped; members read, writers go through the RPCs.

REVOKE ALL ON api.parsers, api.parser_versions, api.parser_mappings,
  api.dataset_import_files, api.dataset_imports FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT SELECT ON api.parsers, api.parser_versions, api.parser_mappings,
  api.dataset_import_files, api.dataset_imports TO authenticated;
--> statement-breakpoint
ALTER TABLE api.parsers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.parser_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.parser_mappings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.dataset_import_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.dataset_imports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY parsers_select ON api.parsers
  FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY parser_versions_select ON api.parser_versions
  FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY parser_mappings_select ON api.parser_mappings
  FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY dataset_import_files_select ON api.dataset_import_files
  FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY dataset_imports_select ON api.dataset_imports
  FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint

-- Change events. Parsers/versions/mappings use the generic emitter; an import
-- carries the experiment record id so the experiment's History shows it.
CREATE TRIGGER change_event_parsers AFTER INSERT OR UPDATE OR DELETE ON api.parsers
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument('parser');
--> statement-breakpoint
CREATE TRIGGER change_event_parser_versions AFTER INSERT OR UPDATE OR DELETE ON api.parser_versions
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument('parser_version');
--> statement-breakpoint
CREATE TRIGGER change_event_dataset_import_files AFTER INSERT OR UPDATE OR DELETE ON api.dataset_import_files
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument('dataset_import_file');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.trg_change_event_dataset_import()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_op text;
  v_row jsonb;
  v_entity uuid;
BEGIN
  v_row := CASE TG_OP WHEN 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_op := CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END;
  v_entity := coalesce((v_row ->> 'id')::uuid, (v_row ->> 'dataset_id')::uuid);
  PERFORM internal.emit_change_event(
    (v_row ->> 'workspace_id')::uuid,
    'dataset_import',
    v_entity,
    v_op,
    (v_row ->> 'experiment_record_id')::uuid,
    NULL,
    v_row - 'metadata');
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.trg_change_event_dataset_import() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER change_event_dataset_imports AFTER INSERT OR UPDATE ON api.dataset_imports
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_dataset_import();
--> statement-breakpoint

-- DSET-05.1 — record the raw file identity before parsing. Called after the
-- bytes are in object storage; the checksum is the stored bytes' sha256.
CREATE OR REPLACE FUNCTION api.create_dataset_import_file(
  p_workspace_id uuid,
  p_filename text,
  p_media_type text,
  p_byte_size bigint,
  p_checksum text,
  p_storage_key text,
  p_format text,
  p_dataset_id uuid DEFAULT NULL
) RETURNS api.dataset_import_files
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v api.dataset_import_files;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB105';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'not permitted to import' USING ERRCODE = '42501';
  END IF;
  IF p_filename IS NULL OR length(btrim(p_filename)) NOT BETWEEN 1 AND 400 THEN
    RAISE EXCEPTION 'a file name is required' USING ERRCODE = '22023';
  END IF;
  IF p_checksum IS NULL OR p_checksum !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'a sha256 checksum is required' USING ERRCODE = '22023';
  END IF;
  IF p_byte_size IS NULL OR p_byte_size <= 0 THEN
    RAISE EXCEPTION 'file size must be positive' USING ERRCODE = '22023';
  END IF;
  IF p_format NOT IN ('csv', 'tsv', 'xlsx', 'json') THEN
    RAISE EXCEPTION 'unknown file format' USING ERRCODE = '22023';
  END IF;
  IF p_storage_key IS NULL OR length(p_storage_key) NOT BETWEEN 1 AND 400 THEN
    RAISE EXCEPTION 'a storage key is required' USING ERRCODE = '22023';
  END IF;
  IF p_dataset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.datasets d
     WHERE d.id = p_dataset_id AND d.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Dataset not found in workspace' USING ERRCODE = 'SB106';
  END IF;
  INSERT INTO api.dataset_import_files
    (workspace_id, dataset_id, filename, media_type, byte_size, checksum,
     storage_key, format, status, created_by_user_id)
  VALUES
    (p_workspace_id, p_dataset_id, btrim(p_filename),
     nullif(btrim(coalesce(p_media_type, '')), ''), p_byte_size, p_checksum,
     p_storage_key, p_format, 'stored', api.current_user_id())
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_dataset_import_file(uuid, text, text, bigint, text, text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_dataset_import_file(uuid, text, text, bigint, text, text, text, uuid) TO authenticated;
--> statement-breakpoint

-- Records whether the stored file parsed, so a failure is visible and the file
-- stays for retry.
CREATE OR REPLACE FUNCTION api.record_dataset_import_file_parse(
  p_file_id uuid,
  p_status text,
  p_error text DEFAULT NULL
) RETURNS api.dataset_import_files
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v api.dataset_import_files;
BEGIN
  IF p_status NOT IN ('stored', 'parsed', 'failed') THEN
    RAISE EXCEPTION 'unknown parse status' USING ERRCODE = '22023';
  END IF;
  UPDATE api.dataset_import_files f
     SET status = p_status,
         parse_error = nullif(btrim(coalesce(p_error, '')), ''),
         updated_at = now()
   WHERE f.id = p_file_id
     AND f.workspace_id = api.current_workspace_id()
     AND api.is_workspace_writer(f.workspace_id) AND api.has_write_actor()
  RETURNING * INTO v;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'import file not found' USING ERRCODE = 'SB106';
  END IF;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_dataset_import_file_parse(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.record_dataset_import_file_parse(uuid, text, text) TO authenticated;
--> statement-breakpoint

-- DSET-06.1 — register a shipped parser and its version. Idempotent: called
-- while recognising a file; the code registry is the source of truth for the
-- signature, so the stored version keeps its governance status.
DROP FUNCTION IF EXISTS api.ensure_parser(uuid, text, text, text, integer, jsonb, jsonb, uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.ensure_parser(
  p_workspace_id uuid,
  p_key text,
  p_name text,
  p_format text,
  p_version integer,
  p_signature jsonb,
  p_mapping jsonb DEFAULT '{}'::jsonb,
  p_instrument_id uuid DEFAULT NULL,
  p_status text DEFAULT 'approved'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_parser api.parsers;
  v_version api.parser_versions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB105';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'not permitted to register a parser' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('draft', 'validated', 'approved') THEN
    RAISE EXCEPTION 'unknown parser status' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.parsers (workspace_id, key, name, format, instrument_id, created_by_user_id)
  VALUES (p_workspace_id, btrim(p_key), btrim(p_name), p_format, p_instrument_id, api.current_user_id())
  ON CONFLICT (workspace_id, key) DO UPDATE
    SET name = EXCLUDED.name, format = EXCLUDED.format,
        instrument_id = coalesce(EXCLUDED.instrument_id, api.parsers.instrument_id),
        updated_at = now()
  RETURNING * INTO v_parser;
  INSERT INTO api.parser_versions
    (workspace_id, parser_id, version, status, signature, mapping, approved_at, created_by_user_id)
  VALUES
    (p_workspace_id, v_parser.id, p_version, p_status, coalesce(p_signature, '{}'::jsonb),
     coalesce(p_mapping, '{}'::jsonb),
     CASE WHEN p_status = 'approved' THEN now() ELSE NULL END,
     api.current_user_id())
  ON CONFLICT (parser_id, version) DO UPDATE
    SET signature = EXCLUDED.signature,
        mapping = CASE WHEN api.parser_versions.mapping = '{}'::jsonb
                       THEN EXCLUDED.mapping ELSE api.parser_versions.mapping END,
        updated_at = now()
  RETURNING * INTO v_version;
  RETURN jsonb_build_object(
    'parserId', v_parser.id, 'parserVersionId', v_version.id,
    'version', v_version.version, 'status', v_version.status);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.ensure_parser(uuid, text, text, text, integer, jsonb, jsonb, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.ensure_parser(uuid, text, text, text, integer, jsonb, jsonb, uuid, text) TO authenticated;
--> statement-breakpoint

-- DSET-06.1 — a workspace-authored parser starts as a draft. Validation stores
-- the test-file result; approval needs the schema.publish capability.
CREATE OR REPLACE FUNCTION api.create_parser_version(
  p_workspace_id uuid,
  p_key text,
  p_name text,
  p_format text,
  p_version integer,
  p_signature jsonb,
  p_mapping jsonb DEFAULT '{}'::jsonb,
  p_instrument_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_parser api.parsers;
  v_version api.parser_versions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB105';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'not permitted to create a parser' USING ERRCODE = '42501';
  END IF;
  IF p_version IS NULL OR p_version < 1 THEN
    RAISE EXCEPTION 'a positive parser version is required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.parsers (workspace_id, key, name, format, instrument_id, created_by_user_id)
  VALUES (p_workspace_id, btrim(p_key), btrim(p_name), p_format, p_instrument_id, api.current_user_id())
  ON CONFLICT (workspace_id, key) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
  RETURNING * INTO v_parser;
  INSERT INTO api.parser_versions
    (workspace_id, parser_id, version, status, signature, mapping, created_by_user_id)
  VALUES
    (p_workspace_id, v_parser.id, p_version, 'draft', coalesce(p_signature, '{}'::jsonb),
     coalesce(p_mapping, '{}'::jsonb), api.current_user_id())
  RETURNING * INTO v_version;
  RETURN jsonb_build_object(
    'parserId', v_parser.id, 'parserVersionId', v_version.id,
    'version', v_version.version, 'status', v_version.status);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_parser_version(uuid, text, text, text, integer, jsonb, jsonb, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_parser_version(uuid, text, text, text, integer, jsonb, jsonb, uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.approve_parser_version(p_parser_version_id uuid)
RETURNS api.parser_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v api.parser_versions;
BEGIN
  SELECT * INTO v FROM api.parser_versions pv
   WHERE pv.id = p_parser_version_id
     AND pv.workspace_id = api.current_workspace_id()
     AND api.is_workspace_writer(pv.workspace_id) AND api.has_write_actor()
   FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'parser version not found' USING ERRCODE = 'SB106';
  END IF;
  IF NOT api.has_capability(v.workspace_id, 'schema.publish') THEN
    RAISE EXCEPTION 'not permitted to approve a parser' USING ERRCODE = '42501';
  END IF;
  IF v.status = 'retired' THEN
    RAISE EXCEPTION 'a retired parser cannot be approved' USING ERRCODE = '22023';
  END IF;
  UPDATE api.parser_versions
     SET status = 'approved', approved_at = now(),
         approved_by_user_id = api.current_user_id(), updated_at = now()
   WHERE id = v.id RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.approve_parser_version(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.approve_parser_version(uuid) TO authenticated;
--> statement-breakpoint

-- DSET-05.3 — remember a parser's mapping for one target (dataset or schema).
CREATE OR REPLACE FUNCTION api.save_parser_mapping(
  p_workspace_id uuid,
  p_parser_id uuid,
  p_target_key text,
  p_mapping jsonb
) RETURNS api.parser_mappings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v api.parser_mappings;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB105';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'not permitted to save a mapping' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.parsers p WHERE p.id = p_parser_id AND p.workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'parser not found' USING ERRCODE = 'SB106';
  END IF;
  IF p_target_key IS NULL OR length(btrim(p_target_key)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'a mapping target is required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.parser_mappings (workspace_id, parser_id, target_key, mapping, is_default, created_by_user_id)
  VALUES (p_workspace_id, p_parser_id, btrim(p_target_key), coalesce(p_mapping, '{}'::jsonb), true, api.current_user_id())
  ON CONFLICT (workspace_id, parser_id, target_key) WHERE is_default
  DO UPDATE SET mapping = EXCLUDED.mapping, updated_at = now()
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_parser_mapping(uuid, uuid, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.save_parser_mapping(uuid, uuid, text, jsonb) TO authenticated;
--> statement-breakpoint

-- DSET-05.4 — compute row outcomes without writing: planned (fills an active
-- planned row), new, skipped (a control), and flagged by the same system rules
-- the commit will apply (out_of_range, missing_unit, and high_cv across the
-- batch's replicate groups). Nothing here mutates Dataset state.
CREATE OR REPLACE FUNCTION api.preview_dataset_import_rows(
  p_dataset_id uuid,
  p_rows jsonb,
  p_control_field_id uuid DEFAULT NULL,
  p_control_pattern text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_variable
DECLARE
  dataset api.datasets;
  item jsonb;
  row_index integer := 0;
  keys text[] := '{}';
  planned_map jsonb := '{}'::jsonb;
  out_rows jsonb := '[]'::jsonb;
  field api.dataset_schema_version_fields;
  effective jsonb;
  v_num numeric;
  lo numeric;
  hi numeric;
  rule jsonb;
  violated boolean;
  v_reason text;
  has_value boolean;
  unit_text text;
  v_planned_id uuid;
  v_outcome text;
  control_value text;
  hc_field api.dataset_schema_version_fields;
  hc jsonb;
  group_field_id uuid;
  max_cv numeric;
  min_reps integer;
  group_rec record;
  idx integer;
  flag jsonb;
BEGIN
  SELECT * INTO dataset FROM api.datasets d
   WHERE d.id = p_dataset_id AND d.workspace_id = api.current_workspace_id()
     AND api.is_workspace_member(d.workspace_id);
  IF dataset.id IS NULL THEN
    RAISE EXCEPTION 'dataset denied' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'rows must be an array' USING ERRCODE = '22023';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(item -> 'plannedKey') = 'string' THEN
      keys := array_append(keys, item ->> 'plannedKey');
    END IF;
  END LOOP;
  IF array_length(keys, 1) IS NOT NULL THEN
    SELECT coalesce(jsonb_object_agg(r.planned_key, r.id), '{}'::jsonb) INTO planned_map
      FROM api.dataset_rows r
     WHERE r.dataset_id = dataset.id AND r.status = 'planned'
       AND r.planned_key = ANY(keys);
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    row_index := row_index + 1;
    v_planned_id := NULL;
    v_outcome := 'new';
    control_value := NULL;
    IF jsonb_typeof(item -> 'plannedKey') = 'string' THEN
      v_planned_id := nullif(planned_map ->> (item ->> 'plannedKey'), '')::uuid;
    END IF;
    IF v_planned_id IS NOT NULL THEN v_outcome := 'planned'; END IF;

    IF p_control_field_id IS NOT NULL AND p_control_pattern IS NOT NULL
       AND item -> 'values' ? p_control_field_id::text THEN
      control_value := item -> 'values' ->> p_control_field_id::text;
      IF control_value IS NOT NULL AND control_value ~* p_control_pattern THEN
        v_outcome := 'skipped';
      END IF;
    END IF;

    out_rows := out_rows || jsonb_build_array(jsonb_build_object(
      'index', row_index,
      'outcome', v_outcome,
      'plannedKey', item ->> 'plannedKey',
      'plannedRowId', v_planned_id,
      'flags', '[]'::jsonb));

    FOR field IN
      SELECT * FROM api.dataset_schema_version_fields f
       WHERE f.schema_version_id = dataset.schema_version_id AND f.lifecycle = 'active'
       ORDER BY f.display_order
    LOOP
      effective := item -> 'values' -> field.field_id::text;

      rule := field.validation #> '{extensions,systemFlags,out_of_range}';
      violated := false;
      v_reason := NULL;
      v_num := NULL;
      IF rule IS NOT NULL AND jsonb_typeof(rule) = 'object'
         AND field.logical_type IN ('integer', 'decimal')
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
        flag := jsonb_build_object('fieldId', field.field_id, 'kind', 'out_of_range', 'reason', v_reason);
        out_rows := jsonb_set(out_rows, ARRAY[row_index - 1, 'flags'],
          (out_rows -> (row_index - 1) -> 'flags') || jsonb_build_array(flag));
      END IF;

      rule := field.validation #> '{extensions,systemFlags,missing_unit}';
      violated := false;
      v_reason := NULL;
      has_value := effective IS NOT NULL AND effective <> 'null'::jsonb;
      unit_text := nullif(btrim(coalesce(field.quantity ->> 'storageUnit', field.quantity ->> 'symbol')), '');
      IF rule IS NOT NULL AND jsonb_typeof(rule) = 'object'
         AND coalesce((rule ->> 'requiresUnit')::boolean, false) IS TRUE
         AND field.logical_type IN ('integer', 'decimal')
         AND has_value AND unit_text IS NULL THEN
        violated := true;
        v_reason := format('No unit is recorded for %s', field.label);
      END IF;
      IF violated THEN
        flag := jsonb_build_object('fieldId', field.field_id, 'kind', 'missing_unit', 'reason', v_reason);
        out_rows := jsonb_set(out_rows, ARRAY[row_index - 1, 'flags'],
          (out_rows -> (row_index - 1) -> 'flags') || jsonb_build_array(flag));
      END IF;
    END LOOP;
  END LOOP;

  -- high_cv across the batch's replicate groups.
  FOR hc_field IN
    SELECT * FROM api.dataset_schema_version_fields f
     WHERE f.schema_version_id = dataset.schema_version_id AND f.lifecycle = 'active'
       AND f.logical_type IN ('integer', 'decimal')
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
    FOR group_rec IN
      SELECT g.group_key, count(*) AS n, avg(g.val) AS mean, stddev_samp(g.val) AS sd,
             array_agg(g.idx) AS idxs
        FROM (
          SELECT (e.ord - 1) AS idx,
                 e.item -> 'values' ->> group_field_id::text AS group_key,
                 nullif(e.item -> 'values' ->> hc_field.field_id::text, '')::numeric AS val
            FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS e(item, ord)
        ) g
       WHERE g.group_key IS NOT NULL AND g.group_key <> '' AND g.val IS NOT NULL
       GROUP BY g.group_key
      HAVING count(*) >= min_reps
    LOOP
      IF group_rec.mean IS NOT NULL AND group_rec.mean <> 0 AND group_rec.sd IS NOT NULL
         AND abs(group_rec.sd / group_rec.mean) * 100 > max_cv THEN
        FOR idx IN SELECT unnest(group_rec.idxs) LOOP
          flag := jsonb_build_object(
            'fieldId', hc_field.field_id, 'kind', 'high_cv',
            'reason', format('Replicate CV %s%% exceeds %s%%', round(abs(group_rec.sd / group_rec.mean) * 100, 2), max_cv));
          out_rows := jsonb_set(out_rows, ARRAY[idx, 'flags'],
            (out_rows -> idx -> 'flags') || jsonb_build_array(flag));
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  -- Any row with a flag is classified flagged (skipped wins over flagged).
  FOR idx IN SELECT generate_series(0, jsonb_array_length(out_rows) - 1) LOOP
    IF (out_rows -> idx ->> 'outcome') <> 'skipped'
       AND jsonb_array_length(out_rows -> idx -> 'flags') > 0 THEN
      out_rows := jsonb_set(out_rows, ARRAY[idx, 'outcome'], '"flagged"'::jsonb);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'rows', out_rows,
    'summary', jsonb_build_object(
      'total', jsonb_array_length(out_rows),
      'added', (SELECT count(*) FROM jsonb_array_elements(out_rows) x
                 WHERE x ->> 'outcome' <> 'skipped'),
      'planned', (SELECT count(*) FROM jsonb_array_elements(out_rows) x WHERE x ->> 'outcome' = 'planned'),
      'new', (SELECT count(*) FROM jsonb_array_elements(out_rows) x WHERE x ->> 'outcome' = 'new'),
      'flagged', (SELECT count(*) FROM jsonb_array_elements(out_rows) x WHERE x ->> 'outcome' = 'flagged'),
      'skipped', (SELECT count(*) FROM jsonb_array_elements(out_rows) x WHERE x ->> 'outcome' = 'skipped')));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.preview_dataset_import_rows(uuid, jsonb, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.preview_dataset_import_rows(uuid, jsonb, uuid, text) TO authenticated;
--> statement-breakpoint

-- DSET-05.4 — commit through the one canonical batch writer, take exactly one
-- snapshot, and record exactly one import receipt, atomically. A replay of the
-- same idempotency key returns the original receipt and writes nothing new.
CREATE OR REPLACE FUNCTION api.commit_dataset_import(
  p_dataset_id uuid,
  p_expected_dataset_revision bigint,
  p_rows jsonb,
  p_idempotency_key text,
  p_file_id uuid,
  p_mapping jsonb,
  p_outcome jsonb,
  p_parser_id uuid DEFAULT NULL,
  p_parser_version_id uuid DEFAULT NULL,
  p_experiment_record_id uuid DEFAULT NULL,
  p_instrument_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  dataset api.datasets;
  existing api.dataset_imports;
  v_commit jsonb;
  v_new_revision bigint;
  v_snapshot api.dataset_versions;
  v_import api.dataset_imports;
  v_label text;
BEGIN
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'an idempotency key is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO dataset FROM api.datasets d
   WHERE d.id = p_dataset_id AND d.workspace_id = api.current_workspace_id()
     AND api.is_workspace_writer(d.workspace_id) AND api.has_write_actor()
   FOR UPDATE;
  IF dataset.id IS NULL THEN
    RAISE EXCEPTION 'dataset denied' USING ERRCODE = '42501';
  END IF;
  IF dataset.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'cannot import into an archived Dataset' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO existing FROM api.dataset_imports i
   WHERE i.workspace_id = dataset.workspace_id AND i.idempotency_key = btrim(p_idempotency_key);
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'importId', existing.id,
      'snapshotVersionId', existing.snapshot_version_id, 'outcome', existing.outcome);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM api.dataset_import_files f
     WHERE f.id = p_file_id AND f.workspace_id = dataset.workspace_id
  ) THEN
    RAISE EXCEPTION 'import file not found' USING ERRCODE = 'SB106';
  END IF;
  IF p_parser_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.parser_versions pv
     WHERE pv.id = p_parser_version_id AND pv.workspace_id = dataset.workspace_id
       AND pv.status <> 'retired'
  ) THEN
    RAISE EXCEPTION 'parser version not usable' USING ERRCODE = 'SB107';
  END IF;

  v_commit := api.commit_dataset_row_batch_atomic(
    p_dataset_id, p_expected_dataset_revision, p_rows, btrim(p_idempotency_key));
  IF coalesce((v_commit ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_commit;
  END IF;
  v_new_revision := (v_commit ->> 'datasetRevision')::bigint;

  SELECT filename INTO v_label FROM api.dataset_import_files WHERE id = p_file_id;
  v_snapshot := api.snapshot_dataset(p_dataset_id, v_new_revision, left('Import ' || coalesce(v_label, ''), 200));

  INSERT INTO api.dataset_imports
    (workspace_id, dataset_id, experiment_record_id, instrument_id, parser_id,
     parser_version_id, file_id, mapping, outcome, snapshot_version_id, status,
     idempotency_key, created_by_user_id)
  VALUES
    (dataset.workspace_id, dataset.id, p_experiment_record_id, p_instrument_id, p_parser_id,
     p_parser_version_id, p_file_id, coalesce(p_mapping, '{}'::jsonb), coalesce(p_outcome, '{}'::jsonb),
     v_snapshot.id, 'committed', btrim(p_idempotency_key), api.current_user_id())
  RETURNING * INTO v_import;

  UPDATE api.dataset_import_files
     SET dataset_id = dataset.id, status = 'parsed', updated_at = now()
   WHERE id = p_file_id;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false, 'importId', v_import.id,
    'snapshotVersionId', v_snapshot.id, 'datasetRevision', v_new_revision,
    'rows', coalesce(v_commit -> 'rows', '[]'::jsonb),
    'outcome', v_import.outcome);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.commit_dataset_import(uuid, bigint, jsonb, text, uuid, jsonb, jsonb, uuid, uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.commit_dataset_import(uuid, bigint, jsonb, text, uuid, jsonb, jsonb, uuid, uuid, uuid, uuid) TO authenticated;
--> statement-breakpoint

-- DSET-02.3 — the Imports tab reads one Dataset's import receipts.
CREATE OR REPLACE FUNCTION api.dataset_import_list(p_dataset_id uuid)
RETURNS SETOF api.dataset_imports
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT i.* FROM api.dataset_imports i
   WHERE i.dataset_id = p_dataset_id
     AND i.workspace_id = api.current_workspace_id()
     AND api.is_workspace_member(i.workspace_id)
   ORDER BY i.created_at DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.dataset_import_list(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.dataset_import_list(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
