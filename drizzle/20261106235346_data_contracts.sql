-- Data contracts: a lab says what good data looks like, and Sheetbase checks it.
--
-- A contract sits on a dataset schema (a table model) or on a record model. It
-- holds rules: a field is required or unique, a number stays in a range, a unit
-- is one of a few, a share of values is filled in, a dataset has at least so
-- many rows, or new rows keep arriving. Each rule is "warn" (the data is kept,
-- the badge says Warning) or "block" (an import or pipeline commit that breaks
-- it is refused and the badge says Fail). Nothing blocks manual typing.
--
-- Checks run on import commit, pipeline commit, on demand and on a schedule.
-- Every check is kept as a run. Rules are kept in a shape that maps onto the
-- Open Data Contract Standard (ODCS v3.1), which can be imported and exported.

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  IF position('''data_contract''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''data_contract''::text, ''data_contract_run''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('contract.created'), ('contract.updated'), ('contract.deleted'),
  ('contract.check.completed'), ('contract.breached'), ('contract.restored')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE TABLE api.data_contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    dataset_schema_id uuid,
    record_model_key text,
    name text NOT NULL,
    description text,
    owner_user_id text,
    version integer DEFAULT 1 NOT NULL,
    lifecycle text DEFAULT 'active' NOT NULL,
    rules jsonb DEFAULT '[]'::jsonb NOT NULL,
    schedule_minutes integer,
    next_check_at timestamp with time zone,
    last_status text,
    last_checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text NOT NULL,
    updated_by_user_id text,
    CONSTRAINT data_contracts_pkey PRIMARY KEY (id),
    CONSTRAINT data_contracts_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT data_contracts_schema_fkey FOREIGN KEY (dataset_schema_id) REFERENCES api.dataset_schema_definitions(id) ON DELETE CASCADE,
    CONSTRAINT data_contracts_owner_fkey FOREIGN KEY (owner_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL,
    CONSTRAINT chk_data_contracts_one_target CHECK (
      (dataset_schema_id IS NOT NULL)::integer + (record_model_key IS NOT NULL)::integer = 1),
    CONSTRAINT chk_data_contracts_lifecycle CHECK (lifecycle IN ('draft', 'active', 'retired')),
    CONSTRAINT chk_data_contracts_status CHECK (last_status IS NULL OR last_status IN ('pass', 'warning', 'fail')),
    CONSTRAINT chk_data_contracts_rules CHECK (jsonb_typeof(rules) = 'array'),
    CONSTRAINT chk_data_contracts_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT chk_data_contracts_schedule CHECK (schedule_minutes IS NULL OR schedule_minutes BETWEEN 5 AND 525600),
    CONSTRAINT chk_data_contracts_version CHECK (version > 0)
);
--> statement-breakpoint
ALTER TABLE api.data_contracts OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_data_contracts_schema ON api.data_contracts (workspace_id, dataset_schema_id)
  WHERE dataset_schema_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_data_contracts_model ON api.data_contracts (workspace_id, record_model_key)
  WHERE record_model_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_data_contracts_due ON api.data_contracts (next_check_at)
  WHERE lifecycle = 'active' AND schedule_minutes IS NOT NULL;
--> statement-breakpoint
ALTER TABLE api.data_contracts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY data_contracts_select ON api.data_contracts FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.data_contracts TO authenticated;
--> statement-breakpoint

CREATE TABLE api.data_contract_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    contract_version integer NOT NULL,
    dataset_id uuid,
    trigger text NOT NULL,
    scope text NOT NULL,
    status text NOT NULL,
    rows_checked bigint DEFAULT 0 NOT NULL,
    failed_rules integer DEFAULT 0 NOT NULL,
    blocked boolean DEFAULT false NOT NULL,
    results jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT data_contract_runs_pkey PRIMARY KEY (id),
    CONSTRAINT data_contract_runs_contract_fkey FOREIGN KEY (contract_id) REFERENCES api.data_contracts(id) ON DELETE CASCADE,
    CONSTRAINT data_contract_runs_dataset_fkey FOREIGN KEY (dataset_id) REFERENCES api.datasets(id) ON DELETE SET NULL,
    CONSTRAINT chk_data_contract_runs_trigger CHECK (trigger IN ('import', 'pipeline', 'manual', 'schedule')),
    CONSTRAINT chk_data_contract_runs_scope CHECK (scope IN ('stored', 'batch')),
    CONSTRAINT chk_data_contract_runs_status CHECK (status IN ('pass', 'warning', 'fail')),
    CONSTRAINT chk_data_contract_runs_results CHECK (jsonb_typeof(results) = 'array')
);
--> statement-breakpoint
ALTER TABLE api.data_contract_runs OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_data_contract_runs_contract ON api.data_contract_runs (contract_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_data_contract_runs_dataset ON api.data_contract_runs (dataset_id, created_at DESC)
  WHERE dataset_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE api.data_contract_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY data_contract_runs_select ON api.data_contract_runs FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.data_contract_runs TO authenticated;
--> statement-breakpoint

-- Where each dataset stands: its latest full check under each contract.
CREATE VIEW api.data_contract_dataset_status WITH (security_invoker = 'true') AS
SELECT DISTINCT ON (r.contract_id, r.dataset_id)
       r.contract_id, r.dataset_id, r.workspace_id, r.status, r.failed_rules,
       r.id AS run_id, r.created_at AS checked_at
  FROM api.data_contract_runs r
 WHERE r.scope = 'stored' AND r.dataset_id IS NOT NULL
 ORDER BY r.contract_id, r.dataset_id, r.created_at DESC;
--> statement-breakpoint
ALTER VIEW api.data_contract_dataset_status OWNER TO migrator;
--> statement-breakpoint
GRANT SELECT ON api.data_contract_dataset_status TO authenticated;
--> statement-breakpoint

-- Rules ------------------------------------------------------------------------

-- Tidy a list of rules: keep only known keys, give each rule an id and a mode.
CREATE FUNCTION internal.contract_normalise_rules(p_rules jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'id', coalesce(nullif(btrim(e.rule->>'id'), ''), 'r' || substr(md5(e.rule::text || e.n::text), 1, 8)),
      'kind', e.rule->>'kind',
      'field', nullif(btrim(e.rule->>'field'), ''),
      'mode', coalesce(nullif(e.rule->>'mode', ''), 'warn'),
      'min', e.rule->'min',
      'max', e.rule->'max',
      'units', e.rule->'units',
      'threshold', e.rule->'threshold',
      'maxAgeMinutes', e.rule->'maxAgeMinutes',
      'note', nullif(btrim(e.rule->>'note'), '')))
    ORDER BY e.n), '[]'::jsonb)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_rules) = 'array' THEN p_rules ELSE '[]'::jsonb END)
       WITH ORDINALITY AS e(rule, n)
  WHERE jsonb_typeof(e.rule) = 'object'
$$;
--> statement-breakpoint
ALTER FUNCTION internal.contract_normalise_rules(jsonb) OWNER TO migrator;
--> statement-breakpoint

-- Rules in a fixed order, so two lists of the same rules compare equal.
CREATE FUNCTION internal.contract_rules_canon(p_rules jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT coalesce(jsonb_agg(r ORDER BY r->>'id'), '[]'::jsonb) FROM jsonb_array_elements(p_rules) r
$$;
--> statement-breakpoint
ALTER FUNCTION internal.contract_rules_canon(jsonb) OWNER TO migrator;
--> statement-breakpoint

-- Why a list of (normalised) rules cannot be saved, or NULL when it can.
CREATE FUNCTION internal.contract_rules_error(p_rules jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  r jsonb;
  v_kind text;
  v_ids text[] := '{}';
  v_min numeric;
  v_max numeric;
BEGIN
  IF jsonb_typeof(p_rules) IS DISTINCT FROM 'array' THEN RETURN 'rules must be a list'; END IF;
  IF jsonb_array_length(p_rules) > 200 THEN RETURN 'a contract can hold at most 200 rules'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rules) LOOP
    v_kind := r->>'kind';
    IF v_kind IS NULL OR v_kind NOT IN ('required', 'unique', 'range', 'units', 'completeness', 'row_count', 'freshness') THEN
      RETURN 'unknown rule kind: ' || coalesce(v_kind, '(none)');
    END IF;
    IF (r->>'id') !~ '^[A-Za-z0-9_-]{1,40}$' THEN RETURN 'a rule id is 1 to 40 letters, numbers, - or _'; END IF;
    IF (r->>'id') = ANY (v_ids) THEN RETURN 'two rules share the id ' || (r->>'id'); END IF;
    v_ids := v_ids || (r->>'id');
    IF r->>'mode' NOT IN ('warn', 'block') THEN RETURN 'a rule is either warn or block'; END IF;
    IF v_kind IN ('required', 'unique', 'range', 'units', 'completeness') THEN
      IF (r->>'field') IS NULL OR (r->>'field') !~ '^[a-z][a-z0-9_]{0,62}$' THEN
        RETURN 'the ' || v_kind || ' rule needs a field';
      END IF;
    ELSIF r ? 'field' THEN
      RETURN 'the ' || v_kind || ' rule is about the whole dataset, not a field';
    END IF;
    IF v_kind = 'range' THEN
      IF jsonb_typeof(r->'min') IS DISTINCT FROM 'number' AND jsonb_typeof(r->'max') IS DISTINCT FROM 'number' THEN
        RETURN 'a range rule needs a lowest or highest value';
      END IF;
      IF (r ? 'min' AND jsonb_typeof(r->'min') <> 'number') OR (r ? 'max' AND jsonb_typeof(r->'max') <> 'number') THEN
        RETURN 'range limits must be numbers';
      END IF;
      v_min := (r->>'min')::numeric; v_max := (r->>'max')::numeric;
      IF v_min IS NOT NULL AND v_max IS NOT NULL AND v_min > v_max THEN
        RETURN 'the lowest value is above the highest value';
      END IF;
    ELSIF v_kind = 'units' THEN
      IF jsonb_typeof(r->'units') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'units') NOT BETWEEN 1 AND 20
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(r->'units') u
                     WHERE jsonb_typeof(u) <> 'string' OR length(btrim(u #>> '{}')) NOT BETWEEN 1 AND 40) THEN
        RETURN 'a units rule needs one to twenty unit names';
      END IF;
    ELSIF v_kind = 'completeness' THEN
      IF jsonb_typeof(r->'threshold') IS DISTINCT FROM 'number'
         OR (r->>'threshold')::numeric <= 0 OR (r->>'threshold')::numeric > 100 THEN
        RETURN 'completeness is a percentage above 0 and up to 100';
      END IF;
    ELSIF v_kind = 'row_count' THEN
      IF jsonb_typeof(r->'min') IS DISTINCT FROM 'number' AND jsonb_typeof(r->'max') IS DISTINCT FROM 'number' THEN
        RETURN 'a row count rule needs a fewest or most rows';
      END IF;
      IF (r ? 'min' AND (jsonb_typeof(r->'min') <> 'number' OR (r->>'min')::numeric < 0 OR (r->>'min')::numeric <> trunc((r->>'min')::numeric)))
         OR (r ? 'max' AND (jsonb_typeof(r->'max') <> 'number' OR (r->>'max')::numeric < 0 OR (r->>'max')::numeric <> trunc((r->>'max')::numeric))) THEN
        RETURN 'row counts are whole numbers from 0';
      END IF;
      v_min := (r->>'min')::numeric; v_max := (r->>'max')::numeric;
      IF v_min IS NOT NULL AND v_max IS NOT NULL AND v_min > v_max THEN
        RETURN 'the fewest rows is above the most rows';
      END IF;
    ELSIF v_kind = 'freshness' THEN
      IF jsonb_typeof(r->'maxAgeMinutes') IS DISTINCT FROM 'number'
         OR (r->>'maxAgeMinutes')::numeric < 1 OR (r->>'maxAgeMinutes')::numeric > 5256000
         OR (r->>'maxAgeMinutes')::numeric <> trunc((r->>'maxAgeMinutes')::numeric) THEN
        RETURN 'freshness is a whole number of minutes from 1';
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.contract_rules_error(jsonb) OWNER TO migrator;
--> statement-breakpoint

-- A cell's value as a number: a JSON number, or text that reads as one.
CREATE FUNCTION internal.contract_num(p_raw jsonb) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE jsonb_typeof(p_raw)
    WHEN 'number' THEN (p_raw #>> '{}')::numeric
    WHEN 'string' THEN CASE WHEN btrim(p_raw #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
                            THEN btrim(p_raw #>> '{}')::numeric END
  END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.contract_num(jsonb) OWNER TO migrator;
--> statement-breakpoint

-- Has the cell been filled in? Missing, null, empty text and empty lists are not.
CREATE FUNCTION internal.contract_present(p_raw jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT p_raw IS NOT NULL AND jsonb_typeof(p_raw) <> 'null'
     AND NOT (jsonb_typeof(p_raw) = 'string' AND btrim(p_raw #>> '{}') = '')
     AND NOT (jsonb_typeof(p_raw) = 'array' AND jsonb_array_length(p_raw) = 0)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.contract_present(jsonb) OWNER TO migrator;
--> statement-breakpoint

-- The fields a contract can talk about, with the unit each carries.
CREATE FUNCTION internal.contract_fields(p_workspace_id uuid, p_dataset_id uuid, p_model_key text)
RETURNS TABLE (field_key text, logical_type text, unit text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT vf.key, vf.logical_type, nullif(vf.quantity->>'storageUnit', '')
    FROM api.datasets d
    JOIN api.dataset_schema_version_fields vf
      ON vf.schema_version_id = d.schema_version_id AND vf.lifecycle = 'active'
   WHERE p_dataset_id IS NOT NULL AND d.id = p_dataset_id AND d.workspace_id = p_workspace_id
  UNION ALL
  SELECT fd.field_name, fd.logical_type, nullif(fd.quantity->>'storageUnit', '')
    FROM api.record_field_definitions fd
   WHERE p_dataset_id IS NULL AND p_model_key IS NOT NULL
     AND fd.workspace_id = p_workspace_id AND fd.kind = p_model_key AND fd.lifecycle = 'active'
$$;
--> statement-breakpoint
ALTER FUNCTION internal.contract_fields(uuid, uuid, text) OWNER TO migrator;
--> statement-breakpoint

-- Every cell of the data being checked: the dataset's recorded rows (or the
-- rows about to be committed, when p_pending is given), or the records of a
-- model. row_key is the row's id for stored data and its place in the batch
-- (1, 2, 3...) for a batch.
CREATE FUNCTION internal.contract_cells(
    p_workspace_id uuid, p_dataset_id uuid, p_model_key text, p_pending jsonb, p_field text DEFAULT NULL)
RETURNS TABLE (row_key text, field_key text, num numeric, txt text, present boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_dataset_id IS NOT NULL AND p_pending IS NULL THEN
    RETURN QUERY
    SELECT r.id::text, vf.key,
           coalesce(v.numeric_value, v.integer_value::numeric),
           coalesce(v.text_value, v.date_value::text, v.timestamp_value::text, v.boolean_value::text,
                    v.category_option_id::text, v.reference_id::text),
           v.row_id IS NOT NULL
      FROM api.datasets d
      JOIN api.dataset_rows r ON r.dataset_id = d.id AND r.status = 'recorded'
      JOIN api.dataset_schema_version_fields vf
        ON vf.schema_version_id = d.schema_version_id AND vf.lifecycle = 'active'
       AND (p_field IS NULL OR vf.key = p_field)
      LEFT JOIN api.dataset_row_values v
        ON v.row_id = r.id AND v.field_id = vf.field_id AND v.ordinal = 0
     WHERE d.id = p_dataset_id AND d.workspace_id = p_workspace_id;
  ELSIF p_dataset_id IS NOT NULL THEN
    RETURN QUERY
    SELECT e.ord::text, vf.key, internal.contract_num(j.raw), j.raw #>> '{}', internal.contract_present(j.raw)
      FROM api.datasets d
      CROSS JOIN LATERAL jsonb_array_elements(p_pending) WITH ORDINALITY AS e(item, ord)
      JOIN api.dataset_schema_version_fields vf
        ON vf.schema_version_id = d.schema_version_id AND vf.lifecycle = 'active'
       AND (p_field IS NULL OR vf.key = p_field)
      CROSS JOIN LATERAL (
        SELECT CASE
                 WHEN (e.item->'values') ? vf.field_id::text THEN e.item->'values'->vf.field_id::text
                 WHEN e.item->>'operation' = 'update' THEN (
                   SELECT to_jsonb(coalesce(v.text_value, v.numeric_value::text, v.integer_value::text,
                                            v.date_value::text, v.timestamp_value::text, v.boolean_value::text))
                     FROM api.dataset_row_values v
                    WHERE v.row_id = nullif(e.item->>'rowId', '')::uuid
                      AND v.field_id = vf.field_id AND v.ordinal = 0)
               END AS raw) j
     WHERE d.id = p_dataset_id AND d.workspace_id = p_workspace_id
       AND coalesce(e.item->>'operation', 'create') IN ('create', 'update');
  ELSIF p_pending IS NULL THEN
    RETURN QUERY
    SELECT rec.id::text, fd.field_name, internal.contract_num(rec.custom_fields->fd.field_name),
           rec.custom_fields->>fd.field_name, internal.contract_present(rec.custom_fields->fd.field_name)
      FROM api.records rec
      JOIN api.record_field_definitions fd
        ON fd.workspace_id = rec.workspace_id AND fd.kind = rec.kind AND fd.lifecycle = 'active'
       AND (p_field IS NULL OR fd.field_name = p_field)
     WHERE rec.workspace_id = p_workspace_id AND rec.kind = p_model_key
       AND rec.deleted_at IS NULL AND rec.archived_at IS NULL;
  ELSE
    RETURN QUERY
    SELECT e.ord::text, fd.field_name, internal.contract_num(e.item->'values'->fd.field_name),
           e.item->'values'->>fd.field_name, internal.contract_present(e.item->'values'->fd.field_name)
      FROM jsonb_array_elements(p_pending) WITH ORDINALITY AS e(item, ord)
      JOIN api.record_field_definitions fd
        ON fd.workspace_id = p_workspace_id AND fd.kind = p_model_key AND fd.lifecycle = 'active'
       AND (p_field IS NULL OR fd.field_name = p_field);
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.contract_cells(uuid, uuid, text, jsonb, text) OWNER TO migrator;
--> statement-breakpoint

-- Check data against a contract's rules. p_pending is a batch of rows about to
-- be committed (checked before they exist); without it the stored data is
-- checked. Returns { status, rowsChecked, failedRules, results[] }; each result
-- says what a rule found without any display text.
CREATE FUNCTION internal.contract_evaluate(p_contract api.data_contracts, p_dataset_id uuid, p_pending jsonb)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_rule jsonb;
  v_kind text;
  v_field text;
  v_mode text;
  v_res jsonb;
  v_results jsonb := '[]'::jsonb;
  v_status text;
  v_run_status text := 'pass';
  v_pending boolean := p_pending IS NOT NULL;
  v_ws uuid := p_contract.workspace_id;
  v_model text := p_contract.record_model_key;
  v_rows bigint;
  v_checked bigint;
  v_failed bigint;
  v_samples jsonb;
  v_min numeric;
  v_max numeric;
  v_threshold numeric;
  v_unit text;
  v_known boolean;
  v_latest timestamp with time zone;
  v_age numeric;
  v_failed_rules integer := 0;
  v_ids text[];
BEGIN
  IF v_pending THEN
    v_rows := jsonb_array_length(p_pending);
    SELECT coalesce(array_agg(e.item->>'rowId'), '{}') INTO v_ids
      FROM jsonb_array_elements(p_pending) e(item) WHERE e.item ? 'rowId';
  ELSIF p_dataset_id IS NOT NULL THEN
    SELECT count(*) INTO v_rows FROM api.dataset_rows r
     WHERE r.dataset_id = p_dataset_id AND r.status = 'recorded';
  ELSE
    SELECT count(*) INTO v_rows FROM api.records rec
     WHERE rec.workspace_id = v_ws AND rec.kind = v_model
       AND rec.deleted_at IS NULL AND rec.archived_at IS NULL;
  END IF;

  FOR v_rule IN SELECT value FROM jsonb_array_elements(p_contract.rules) LOOP
    v_kind := v_rule->>'kind';
    v_field := v_rule->>'field';
    v_mode := coalesce(v_rule->>'mode', 'warn');
    v_status := 'pass';
    v_checked := 0; v_failed := 0; v_samples := '[]'::jsonb;
    v_res := jsonb_strip_nulls(jsonb_build_object(
      'ruleId', v_rule->>'id', 'kind', v_kind, 'field', v_field, 'mode', v_mode));

    IF v_field IS NOT NULL THEN
      SELECT true, f.unit INTO v_known, v_unit
        FROM internal.contract_fields(v_ws, p_dataset_id, v_model) f WHERE f.field_key = v_field;
      IF v_known IS NOT TRUE THEN
        v_results := v_results || (v_res || jsonb_build_object('status', 'skipped', 'reason', 'field_missing'));
        CONTINUE;
      END IF;
    END IF;

    IF v_kind = 'required' THEN
      SELECT count(*), count(*) FILTER (WHERE NOT s.present),
             coalesce((SELECT jsonb_agg(jsonb_build_object('row', x.row_key))
                         FROM (SELECT c.row_key FROM internal.contract_cells(v_ws, p_dataset_id, v_model, p_pending, v_field) c
                                WHERE NOT c.present
                                ORDER BY CASE WHEN c.row_key ~ '^[0-9]{1,9}$' THEN c.row_key::int END, c.row_key
                                LIMIT 10) x), '[]'::jsonb)
        INTO v_checked, v_failed, v_samples
        FROM internal.contract_cells(v_ws, p_dataset_id, v_model, p_pending, v_field) s;
      v_res := v_res || jsonb_build_object('checked', v_checked, 'failed', v_failed, 'samples', v_samples);
      IF v_failed > 0 THEN v_status := 'fail'; END IF;

    ELSIF v_kind = 'range' THEN
      v_min := (v_rule->>'min')::numeric; v_max := (v_rule->>'max')::numeric;
      SELECT count(*), count(*) FILTER (WHERE (v_min IS NOT NULL AND s.num < v_min) OR (v_max IS NOT NULL AND s.num > v_max)),
             coalesce((SELECT jsonb_agg(jsonb_build_object('row', x.row_key, 'value', trim_scale(x.num)::text))
                         FROM (SELECT c.row_key, c.num FROM internal.contract_cells(v_ws, p_dataset_id, v_model, p_pending, v_field) c
                                WHERE c.num IS NOT NULL
                                  AND ((v_min IS NOT NULL AND c.num < v_min) OR (v_max IS NOT NULL AND c.num > v_max))
                                ORDER BY CASE WHEN c.row_key ~ '^[0-9]{1,9}$' THEN c.row_key::int END, c.row_key
                                LIMIT 10) x), '[]'::jsonb)
        INTO v_checked, v_failed, v_samples
        FROM internal.contract_cells(v_ws, p_dataset_id, v_model, p_pending, v_field) s
       WHERE s.num IS NOT NULL;
      v_res := v_res || jsonb_build_object('checked', v_checked, 'failed', v_failed, 'samples', v_samples);
      IF v_failed > 0 THEN v_status := 'fail'; END IF;

    ELSIF v_kind = 'unique' THEN
      WITH pend AS (
        SELECT c.row_key, coalesce(trim_scale(c.num)::text, c.txt) AS val
          FROM internal.contract_cells(v_ws, p_dataset_id, v_model, p_pending, v_field) c WHERE c.present),
      other AS (
        SELECT coalesce(trim_scale(c.num)::text, c.txt) AS val
          FROM internal.contract_cells(v_ws, p_dataset_id, v_model, NULL, v_field) c
         WHERE v_pending AND c.present AND NOT (c.row_key = ANY (coalesce(v_ids, '{}')))),
      flagged AS (
        SELECT p.row_key, p.val,
               (count(*) OVER (PARTITION BY p.val) > 1
                OR EXISTS (SELECT 1 FROM other o WHERE o.val = p.val)) AS bad
          FROM pend p)
      SELECT (SELECT count(*) FROM flagged), (SELECT count(*) FROM flagged WHERE bad),
             coalesce((SELECT jsonb_agg(jsonb_build_object('row', x.row_key, 'value', x.val))
                         FROM (SELECT f.row_key, f.val FROM flagged f WHERE f.bad
                                ORDER BY f.val, CASE WHEN f.row_key ~ '^[0-9]{1,9}$' THEN f.row_key::int END, f.row_key
                                LIMIT 10) x), '[]'::jsonb)
        INTO v_checked, v_failed, v_samples;
      v_res := v_res || jsonb_build_object('checked', v_checked, 'failed', v_failed, 'samples', v_samples);
      IF v_failed > 0 THEN v_status := 'fail'; END IF;

    ELSIF v_kind = 'completeness' THEN
      v_threshold := (v_rule->>'threshold')::numeric;
      SELECT count(*), count(*) FILTER (WHERE NOT s.present)
        INTO v_checked, v_failed
        FROM internal.contract_cells(v_ws, p_dataset_id, v_model, p_pending, v_field) s;
      IF v_checked = 0 THEN
        v_res := v_res || jsonb_build_object('checked', 0, 'failed', 0);
      ELSE
        v_res := v_res || jsonb_build_object('checked', v_checked, 'failed', v_failed,
          'percent', round(100.0 * (v_checked - v_failed) / v_checked, 2), 'threshold', v_threshold);
        IF 100.0 * (v_checked - v_failed) / v_checked < v_threshold THEN v_status := 'fail'; END IF;
      END IF;

    ELSIF v_kind = 'units' THEN
      v_res := v_res || jsonb_build_object('checked', 1, 'actual', to_jsonb(v_unit));
      IF v_unit IS NULL OR NOT (v_rule->'units') @> to_jsonb(v_unit) THEN
        v_status := 'fail';
        v_res := v_res || jsonb_build_object('failed', 1);
      ELSE
        v_res := v_res || jsonb_build_object('failed', 0);
      END IF;

    ELSIF v_kind = 'row_count' THEN
      IF v_pending THEN
        v_results := v_results || (v_res || jsonb_build_object('status', 'skipped', 'reason', 'batch'));
        CONTINUE;
      END IF;
      v_min := (v_rule->>'min')::numeric; v_max := (v_rule->>'max')::numeric;
      v_res := v_res || jsonb_build_object('checked', v_rows, 'failed', 0, 'rowCount', v_rows);
      IF (v_min IS NOT NULL AND v_rows < v_min) OR (v_max IS NOT NULL AND v_rows > v_max) THEN
        v_status := 'fail';
        v_res := v_res || jsonb_build_object('failed', 1);
      END IF;

    ELSIF v_kind = 'freshness' THEN
      IF v_pending THEN
        v_results := v_results || (v_res || jsonb_build_object('status', 'skipped', 'reason', 'batch'));
        CONTINUE;
      END IF;
      IF p_dataset_id IS NOT NULL THEN
        SELECT coalesce(max(r.updated_at), (SELECT d.created_at FROM api.datasets d WHERE d.id = p_dataset_id))
          INTO v_latest FROM api.dataset_rows r WHERE r.dataset_id = p_dataset_id AND r.status = 'recorded';
      ELSE
        SELECT max(rec.updated_at) INTO v_latest FROM api.records rec
         WHERE rec.workspace_id = v_ws AND rec.kind = v_model AND rec.deleted_at IS NULL AND rec.archived_at IS NULL;
      END IF;
      IF v_latest IS NULL THEN
        v_results := v_results || (v_res || jsonb_build_object('status', 'skipped', 'reason', 'no_rows'));
        CONTINUE;
      END IF;
      v_age := round(extract(epoch FROM (now() - v_latest)) / 60);
      v_res := v_res || jsonb_build_object('checked', 1, 'failed', 0, 'ageMinutes', v_age,
        'maxAgeMinutes', (v_rule->>'maxAgeMinutes')::numeric, 'latestAt', v_latest);
      IF v_age > (v_rule->>'maxAgeMinutes')::numeric THEN
        v_status := 'fail';
        v_res := v_res || jsonb_build_object('failed', 1);
      END IF;
    END IF;

    v_res := v_res || jsonb_build_object('status', v_status);
    IF v_status = 'fail' THEN
      v_failed_rules := v_failed_rules + 1;
      IF v_mode = 'block' THEN v_run_status := 'fail';
      ELSIF v_run_status = 'pass' THEN v_run_status := 'warning'; END IF;
    END IF;
    v_results := v_results || v_res;
  END LOOP;

  RETURN jsonb_build_object('status', v_run_status, 'rowsChecked', v_rows,
                            'failedRules', v_failed_rules, 'results', v_results);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.contract_evaluate(api.data_contracts, uuid, jsonb) OWNER TO migrator;
--> statement-breakpoint

-- Record a run, keep the contract's standing up to date and say what changed.
CREATE FUNCTION internal.contract_record_run(
    p_contract api.data_contracts, p_dataset_id uuid, p_trigger text, p_eval jsonb)
RETURNS api.data_contract_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_run api.data_contract_runs;
  v_scope text := CASE WHEN p_trigger IN ('manual', 'schedule') THEN 'stored' ELSE 'batch' END;
  v_status text := p_eval->>'status';
  v_blocked boolean := p_trigger IN ('import', 'pipeline') AND p_eval->>'status' = 'fail';
  v_prev text := p_contract.last_status;
  v_new text;
  v_actor text := coalesce(api.current_user_id(), p_contract.owner_user_id, p_contract.created_by_user_id);
  v_rank constant jsonb := '{"pass":0,"warning":1,"fail":2}';
BEGIN
  INSERT INTO api.data_contract_runs
    (workspace_id, contract_id, contract_version, dataset_id, trigger, scope, status,
     rows_checked, failed_rules, blocked, results, created_by_user_id)
  VALUES (p_contract.workspace_id, p_contract.id, p_contract.version, p_dataset_id, p_trigger, v_scope, v_status,
          (p_eval->>'rowsChecked')::bigint, (p_eval->>'failedRules')::integer, v_blocked,
          p_eval->'results', api.current_user_id())
  RETURNING * INTO v_run;

  IF v_scope = 'stored' THEN
    SELECT s.status INTO v_new
      FROM (SELECT DISTINCT ON (coalesce(r.dataset_id, '00000000-0000-0000-0000-000000000000'::uuid)) r.status
              FROM api.data_contract_runs r
              LEFT JOIN api.datasets d ON d.id = r.dataset_id
             WHERE r.contract_id = p_contract.id AND r.scope = 'stored'
               AND (r.dataset_id IS NULL OR d.lifecycle = 'active')
             ORDER BY coalesce(r.dataset_id, '00000000-0000-0000-0000-000000000000'::uuid), r.created_at DESC, r.id DESC) s
     ORDER BY (v_rank->>s.status)::integer DESC LIMIT 1;
    v_new := coalesce(v_new, v_status);
  ELSIF v_blocked THEN
    v_new := v_prev;
  ELSE
    v_new := CASE WHEN coalesce((v_rank->>v_prev)::integer, 0) >= (v_rank->>v_status)::integer
                  THEN coalesce(v_prev, v_status) ELSE v_status END;
  END IF;

  UPDATE api.data_contracts SET last_status = v_new, last_checked_at = now()
   WHERE id = p_contract.id;

  IF v_actor IS NOT NULL AND EXISTS (SELECT 1 FROM internal."user" WHERE id = v_actor) THEN
    PERFORM internal.emit_change_event_as_actor(
      v_actor, p_contract.workspace_id, 'data_contract_run', v_run.id, 'create', NULL, NULL,
      jsonb_strip_nulls(jsonb_build_object(
        'runId', v_run.id, 'contractId', p_contract.id, 'name', p_contract.name,
        'status', v_status, 'trigger', p_trigger, 'datasetId', p_dataset_id,
        'rowsChecked', v_run.rows_checked, 'failedRules', v_run.failed_rules, 'blocked', v_blocked)));
    IF (v_rank->>v_new)::integer > coalesce((v_rank->>v_prev)::integer, 0) THEN
      PERFORM internal.emit_change_event_as_actor(
        v_actor, p_contract.workspace_id, 'data_contract', p_contract.id, 'update', NULL, NULL,
        jsonb_strip_nulls(jsonb_build_object(
          'effect', 'breached', 'contractId', p_contract.id, 'name', p_contract.name,
          'status', v_new, 'previousStatus', coalesce(v_prev, 'pass'),
          'datasetSchemaId', p_contract.dataset_schema_id, 'recordModelKey', p_contract.record_model_key,
          'datasetId', p_dataset_id, 'runId', v_run.id)));
    ELSIF v_new = 'pass' AND v_prev IN ('warning', 'fail') THEN
      PERFORM internal.emit_change_event_as_actor(
        v_actor, p_contract.workspace_id, 'data_contract', p_contract.id, 'update', NULL, NULL,
        jsonb_strip_nulls(jsonb_build_object(
          'effect', 'restored', 'contractId', p_contract.id, 'name', p_contract.name,
          'status', v_new, 'previousStatus', v_prev,
          'datasetSchemaId', p_contract.dataset_schema_id, 'recordModelKey', p_contract.record_model_key,
          'datasetId', p_dataset_id, 'runId', v_run.id)));
    END IF;
  END IF;
  RETURN v_run;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.contract_record_run(api.data_contracts, uuid, text, jsonb) OWNER TO migrator;
--> statement-breakpoint

-- Run the full check of one contract: every active dataset under a dataset
-- schema contract, or the records of a model contract.
CREATE FUNCTION internal.contract_run_stored(p_contract api.data_contracts, p_dataset_id uuid, p_trigger text)
RETURNS SETOF api.data_contract_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  d record;
  v_current api.data_contracts;
BEGIN
  IF p_contract.dataset_schema_id IS NULL THEN
    RETURN NEXT internal.contract_record_run(
      p_contract, NULL, p_trigger, internal.contract_evaluate(p_contract, NULL, NULL));
    RETURN;
  END IF;
  FOR d IN
    SELECT ds.id FROM api.datasets ds
      JOIN api.dataset_schema_versions sv ON sv.id = ds.schema_version_id
     WHERE ds.workspace_id = p_contract.workspace_id AND sv.schema_id = p_contract.dataset_schema_id
       AND ds.lifecycle = 'active' AND (p_dataset_id IS NULL OR ds.id = p_dataset_id)
     ORDER BY ds.updated_at DESC LIMIT 200
  LOOP
    SELECT * INTO v_current FROM api.data_contracts WHERE id = p_contract.id;
    RETURN NEXT internal.contract_record_run(
      v_current, d.id, p_trigger, internal.contract_evaluate(v_current, d.id, NULL));
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.contract_run_stored(api.data_contracts, uuid, text) OWNER TO migrator;
--> statement-breakpoint

-- Contracts: save, change, remove --------------------------------------------

-- Make or change the contract on a dataset schema or a record model. An empty
-- argument keeps what is there (or the default for a new contract); a schedule
-- of 0 turns scheduled checks off. A change to the rules makes a new version.
CREATE FUNCTION internal.contract_upsert(
    p_workspace_id uuid, p_dataset_schema_id uuid, p_record_model_key text, p_rules jsonb,
    p_name text, p_description text, p_owner_user_id text, p_lifecycle text, p_schedule_minutes integer)
RETURNS api.data_contracts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_existing api.data_contracts;
  v_row api.data_contracts;
  v_rules jsonb;
  v_error text;
  v_default_name text;
  v_schedule integer;
  v_freshest integer;
  v_actor text := api.current_user_id();
BEGIN
  IF (p_dataset_schema_id IS NOT NULL)::integer + (p_record_model_key IS NOT NULL)::integer <> 1 THEN
    RAISE EXCEPTION 'name a dataset schema or a record model, not both' USING ERRCODE = '22023';
  END IF;
  IF p_dataset_schema_id IS NOT NULL THEN
    SELECT s.name INTO v_default_name FROM api.dataset_schema_definitions s
     WHERE s.id = p_dataset_schema_id AND s.workspace_id = p_workspace_id;
    IF v_default_name IS NULL THEN RAISE EXCEPTION 'dataset schema not found' USING ERRCODE = 'SB106'; END IF;
    SELECT * INTO v_existing FROM api.data_contracts
     WHERE workspace_id = p_workspace_id AND dataset_schema_id = p_dataset_schema_id FOR UPDATE;
  ELSE
    SELECT m.name INTO v_default_name FROM api.record_models m
     WHERE m.workspace_id = p_workspace_id AND m.key = p_record_model_key;
    IF v_default_name IS NULL THEN RAISE EXCEPTION 'record model not found' USING ERRCODE = 'SB106'; END IF;
    SELECT * INTO v_existing FROM api.data_contracts
     WHERE workspace_id = p_workspace_id AND record_model_key = p_record_model_key FOR UPDATE;
  END IF;

  IF p_lifecycle IS NOT NULL AND p_lifecycle NOT IN ('draft', 'active', 'retired') THEN
    RAISE EXCEPTION 'a contract is draft, active or retired' USING ERRCODE = '22023';
  END IF;
  IF p_schedule_minutes IS NOT NULL AND p_schedule_minutes <> 0 AND p_schedule_minutes NOT BETWEEN 5 AND 525600 THEN
    RAISE EXCEPTION 'scheduled checks run every 5 minutes to every year' USING ERRCODE = '22023';
  END IF;
  IF p_owner_user_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM api.workspace_memberships m
        WHERE m.workspace_id = p_workspace_id AND m.user_id = p_owner_user_id AND m.suspended_at IS NULL) THEN
    RAISE EXCEPTION 'the owner must be a member of this workspace' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NOT NULL AND length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'a contract name is 1 to 200 characters' USING ERRCODE = '22023';
  END IF;

  v_rules := CASE WHEN p_rules IS NULL THEN NULL ELSE internal.contract_normalise_rules(p_rules) END;
  IF p_rules IS NOT NULL AND jsonb_typeof(p_rules) <> 'array' THEN
    RAISE EXCEPTION 'rules must be a list' USING ERRCODE = '22023';
  END IF;
  IF v_rules IS NOT NULL THEN
    v_error := internal.contract_rules_error(v_rules);
    IF v_error IS NOT NULL THEN RAISE EXCEPTION '%', v_error USING ERRCODE = '22023'; END IF;
  END IF;

  IF v_existing.id IS NULL THEN
    v_rules := coalesce(v_rules, '[]'::jsonb);
    SELECT min((r->>'maxAgeMinutes')::integer) INTO v_freshest
      FROM jsonb_array_elements(v_rules) r WHERE r->>'kind' = 'freshness';
    v_schedule := CASE
      WHEN p_schedule_minutes = 0 THEN NULL
      WHEN p_schedule_minutes IS NOT NULL THEN p_schedule_minutes
      WHEN v_freshest IS NOT NULL THEN least(1440, greatest(5, v_freshest / 2))
      ELSE 1440 END;
    INSERT INTO api.data_contracts
      (workspace_id, dataset_schema_id, record_model_key, name, description, owner_user_id, lifecycle,
       rules, schedule_minutes, next_check_at, created_by_user_id, updated_by_user_id)
    VALUES (p_workspace_id, p_dataset_schema_id, p_record_model_key,
            coalesce(nullif(btrim(p_name), ''), v_default_name || ' contract'),
            nullif(btrim(p_description), ''), coalesce(p_owner_user_id, v_actor),
            coalesce(p_lifecycle, 'active'), v_rules, v_schedule,
            CASE WHEN v_schedule IS NOT NULL THEN now() + make_interval(mins => v_schedule) END,
            coalesce(v_actor, p_owner_user_id), v_actor)
    RETURNING * INTO v_row;
  ELSE
    v_schedule := CASE
      WHEN p_schedule_minutes = 0 THEN NULL
      WHEN p_schedule_minutes IS NOT NULL THEN p_schedule_minutes
      ELSE v_existing.schedule_minutes END;
    UPDATE api.data_contracts SET
        name = coalesce(nullif(btrim(p_name), ''), name),
        description = CASE WHEN p_description IS NULL THEN description ELSE nullif(btrim(p_description), '') END,
        owner_user_id = coalesce(p_owner_user_id, owner_user_id),
        lifecycle = coalesce(p_lifecycle, lifecycle),
        rules = coalesce(v_rules, rules),
        version = CASE WHEN v_rules IS NOT NULL
                         AND internal.contract_rules_canon(v_rules) IS DISTINCT FROM internal.contract_rules_canon(rules)
                       THEN version + 1 ELSE version END,
        schedule_minutes = v_schedule,
        next_check_at = CASE
          WHEN v_schedule IS NULL THEN NULL
          WHEN v_schedule IS DISTINCT FROM schedule_minutes OR next_check_at IS NULL
            THEN now() + make_interval(mins => v_schedule)
          ELSE next_check_at END,
        updated_at = now(), updated_by_user_id = v_actor
      WHERE id = v_existing.id
    RETURNING * INTO v_row;
  END IF;

  IF v_actor IS NOT NULL THEN
    PERFORM internal.emit_change_event(p_workspace_id, 'data_contract', v_row.id,
      CASE WHEN v_existing.id IS NULL THEN 'create' ELSE 'update' END, NULL, NULL,
      jsonb_build_object('effect', 'saved', 'contractId', v_row.id, 'name', v_row.name,
                         'version', v_row.version, 'lifecycle', v_row.lifecycle));
  END IF;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.contract_upsert(uuid, uuid, text, jsonb, text, text, text, text, integer) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION api.save_data_contract(
    p_dataset_schema_id uuid DEFAULT NULL, p_record_model_key text DEFAULT NULL, p_rules jsonb DEFAULT NULL,
    p_name text DEFAULT NULL, p_description text DEFAULT NULL, p_owner_user_id text DEFAULT NULL,
    p_lifecycle text DEFAULT NULL, p_schedule_minutes integer DEFAULT NULL)
RETURNS api.data_contracts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
BEGIN
  PERFORM api.require_capability(v_ws, 'schema.edit');
  RETURN internal.contract_upsert(v_ws, p_dataset_schema_id, p_record_model_key, p_rules, p_name,
                                  p_description, p_owner_user_id, p_lifecycle, p_schedule_minutes);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_data_contract(uuid, text, jsonb, text, text, text, text, integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_data_contract(uuid, text, jsonb, text, text, text, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_data_contract(uuid, text, jsonb, text, text, text, text, integer) TO authenticated;
--> statement-breakpoint

-- Add one rule to a contract (the rule's id is made if you leave it out).
CREATE FUNCTION api.add_contract_rule(p_contract_id uuid, p_rule jsonb)
RETURNS api.data_contracts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c api.data_contracts;
BEGIN
  SELECT * INTO c FROM api.data_contracts
   WHERE id = p_contract_id AND workspace_id = api.current_workspace_id();
  IF c.id IS NULL THEN RAISE EXCEPTION 'contract not found' USING ERRCODE = 'SB106'; END IF;
  PERFORM api.require_capability(c.workspace_id, 'schema.edit');
  IF jsonb_typeof(p_rule) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'a rule is an object' USING ERRCODE = '22023';
  END IF;
  RETURN internal.contract_upsert(c.workspace_id, c.dataset_schema_id, c.record_model_key,
    c.rules || jsonb_build_array(p_rule), NULL, NULL, NULL, NULL, NULL);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.add_contract_rule(uuid, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.add_contract_rule(uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.add_contract_rule(uuid, jsonb) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.remove_contract_rule(p_contract_id uuid, p_rule_id text)
RETURNS api.data_contracts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c api.data_contracts;
BEGIN
  SELECT * INTO c FROM api.data_contracts
   WHERE id = p_contract_id AND workspace_id = api.current_workspace_id();
  IF c.id IS NULL THEN RAISE EXCEPTION 'contract not found' USING ERRCODE = 'SB106'; END IF;
  PERFORM api.require_capability(c.workspace_id, 'schema.edit');
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.rules) r WHERE r->>'id' = p_rule_id) THEN
    RAISE EXCEPTION 'rule not found' USING ERRCODE = 'SB106';
  END IF;
  RETURN internal.contract_upsert(c.workspace_id, c.dataset_schema_id, c.record_model_key,
    (SELECT coalesce(jsonb_agg(r ORDER BY n), '[]'::jsonb)
       FROM jsonb_array_elements(c.rules) WITH ORDINALITY e(r, n) WHERE r->>'id' <> p_rule_id),
    NULL, NULL, NULL, NULL, NULL);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.remove_contract_rule(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.remove_contract_rule(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.remove_contract_rule(uuid, text) TO authenticated;
--> statement-breakpoint

-- Take a contract away, with its run history.
CREATE FUNCTION api.delete_data_contract(p_contract_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c api.data_contracts;
BEGIN
  SELECT * INTO c FROM api.data_contracts
   WHERE id = p_contract_id AND workspace_id = api.current_workspace_id();
  IF c.id IS NULL THEN RAISE EXCEPTION 'contract not found' USING ERRCODE = 'SB106'; END IF;
  PERFORM api.require_capability(c.workspace_id, 'schema.edit');
  DELETE FROM api.data_contracts WHERE id = c.id;
  PERFORM internal.emit_change_event(c.workspace_id, 'data_contract', c.id, 'delete', NULL, NULL,
    jsonb_build_object('effect', 'deleted', 'contractId', c.id, 'name', c.name));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.delete_data_contract(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_data_contract(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.delete_data_contract(uuid) TO authenticated;
--> statement-breakpoint

-- Checks ----------------------------------------------------------------------

-- Run a contract's checks now. For a dataset schema contract that is every
-- active dataset under it (or the one named); for a record model, its records.
CREATE FUNCTION api.run_contract_check(p_contract_id uuid, p_dataset_id uuid DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c api.data_contracts;
  v_runs jsonb;
BEGIN
  SELECT * INTO c FROM api.data_contracts
   WHERE id = p_contract_id AND workspace_id = api.current_workspace_id();
  IF c.id IS NULL THEN RAISE EXCEPTION 'contract not found' USING ERRCODE = 'SB106'; END IF;
  IF NOT api.is_workspace_writer(c.workspace_id) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'contract check denied' USING ERRCODE = '42501';
  END IF;
  IF c.lifecycle = 'retired' THEN
    RAISE EXCEPTION 'a retired contract is not checked' USING ERRCODE = '22023';
  END IF;
  IF p_dataset_id IS NOT NULL THEN
    PERFORM internal.assert_object_access('dataset', p_dataset_id, 'view');
    IF c.dataset_schema_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM api.datasets ds JOIN api.dataset_schema_versions sv ON sv.id = ds.schema_version_id
          WHERE ds.id = p_dataset_id AND sv.schema_id = c.dataset_schema_id) THEN
      RAISE EXCEPTION 'that dataset is not under this contract' USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at), '[]'::jsonb) INTO v_runs
    FROM internal.contract_run_stored(c, p_dataset_id, 'manual') r;
  SELECT * INTO c FROM api.data_contracts WHERE id = c.id;
  RETURN jsonb_build_object('contractId', c.id, 'status', c.last_status, 'runs', v_runs);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.run_contract_check(uuid, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.run_contract_check(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.run_contract_check(uuid, uuid) TO authenticated;
--> statement-breakpoint

-- What a change of rules would find in the data as it stands now, without
-- saving anything or recording a run. Pass the rules you are thinking of.
CREATE FUNCTION api.preview_contract_rules(p_contract_id uuid, p_rules jsonb, p_dataset_id uuid DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c api.data_contracts;
  v_rules jsonb := internal.contract_normalise_rules(p_rules);
  v_error text := internal.contract_rules_error(internal.contract_normalise_rules(p_rules));
  d record;
  v_out jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO c FROM api.data_contracts
   WHERE id = p_contract_id AND workspace_id = api.current_workspace_id();
  IF c.id IS NULL THEN RAISE EXCEPTION 'contract not found' USING ERRCODE = 'SB106'; END IF;
  IF NOT api.has_capability(c.workspace_id, 'schema.edit') THEN
    RAISE EXCEPTION 'capability required: schema.edit' USING ERRCODE = '42501';
  END IF;
  IF v_error IS NOT NULL THEN RAISE EXCEPTION '%', v_error USING ERRCODE = '22023'; END IF;
  c.rules := v_rules;
  IF c.dataset_schema_id IS NULL THEN
    RETURN jsonb_build_array(jsonb_build_object('datasetId', NULL) || internal.contract_evaluate(c, NULL, NULL));
  END IF;
  FOR d IN
    SELECT ds.id, ds.name, ds.display_id FROM api.datasets ds
      JOIN api.dataset_schema_versions sv ON sv.id = ds.schema_version_id
     WHERE ds.workspace_id = c.workspace_id AND sv.schema_id = c.dataset_schema_id
       AND ds.lifecycle = 'active' AND (p_dataset_id IS NULL OR ds.id = p_dataset_id)
       AND internal.can_access_object('dataset', ds.id, 'view')
     ORDER BY ds.updated_at DESC LIMIT 50
  LOOP
    v_out := v_out || (jsonb_build_object('datasetId', d.id, 'datasetName', d.name, 'datasetDisplayId', d.display_id)
                       || internal.contract_evaluate(c, d.id, NULL));
  END LOOP;
  RETURN v_out;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.preview_contract_rules(uuid, jsonb, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.preview_contract_rules(uuid, jsonb, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.preview_contract_rules(uuid, jsonb, uuid) TO authenticated;
--> statement-breakpoint

-- The check an import or a pipeline makes just before it commits rows. It
-- records a run. A block-mode rule that finds a problem makes blocked true and
-- the caller must not commit.
CREATE FUNCTION internal.contract_gate(p_dataset_id uuid, p_rows jsonb, p_trigger text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  d api.datasets;
  c api.data_contracts;
  v_eval jsonb;
  v_run api.data_contract_runs;
BEGIN
  SELECT * INTO d FROM api.datasets WHERE id = p_dataset_id;
  IF d.id IS NULL THEN RETURN jsonb_build_object('ok', true, 'checked', false); END IF;
  SELECT c2.* INTO c
    FROM api.data_contracts c2
    JOIN api.dataset_schema_versions sv ON sv.schema_id = c2.dataset_schema_id
   WHERE sv.id = d.schema_version_id AND c2.workspace_id = d.workspace_id AND c2.lifecycle = 'active';
  IF c.id IS NULL OR jsonb_array_length(c.rules) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'checked', false);
  END IF;
  v_eval := internal.contract_evaluate(c, d.id, p_rows);
  v_run := internal.contract_record_run(c, d.id, p_trigger, v_eval);
  RETURN jsonb_build_object(
    'ok', NOT v_run.blocked, 'checked', true, 'blocked', v_run.blocked, 'status', v_run.status,
    'runId', v_run.id, 'contractId', c.id, 'contractName', c.name, 'rowsChecked', v_run.rows_checked,
    'results', (SELECT coalesce(jsonb_agg(r), '[]'::jsonb)
                  FROM jsonb_array_elements(v_run.results) r WHERE r->>'status' = 'fail'));
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.contract_gate(uuid, jsonb, text) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION api.check_dataset_contract(p_dataset_id uuid, p_rows jsonb, p_trigger text DEFAULT 'pipeline') RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.assert_object_access('dataset', p_dataset_id, 'edit');
  IF NOT EXISTS (SELECT 1 FROM api.datasets d WHERE d.id = p_dataset_id AND d.workspace_id = api.current_workspace_id()
                    AND api.is_workspace_writer(d.workspace_id)) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'dataset denied' USING ERRCODE = '42501';
  END IF;
  IF p_trigger NOT IN ('import', 'pipeline') THEN
    RAISE EXCEPTION 'a batch is checked for an import or a pipeline' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'rows must be a list' USING ERRCODE = '22023';
  END IF;
  RETURN internal.contract_gate(p_dataset_id, p_rows, p_trigger);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.check_dataset_contract(uuid, jsonb, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.check_dataset_contract(uuid, jsonb, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.check_dataset_contract(uuid, jsonb, text) TO authenticated;
--> statement-breakpoint

-- The same check for a batch of records about to be created: advisory, and
-- nothing is recorded. Rows are { values: { field_name: value } }.
CREATE FUNCTION api.check_record_batch_contract(p_record_model_key text, p_rows jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c api.data_contracts;
  v_eval jsonb;
BEGIN
  IF NOT api.is_workspace_member(api.current_workspace_id()) THEN
    RAISE EXCEPTION 'workspace denied' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'rows must be a list' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM api.data_contracts
   WHERE workspace_id = api.current_workspace_id() AND record_model_key = p_record_model_key AND lifecycle = 'active';
  IF c.id IS NULL OR jsonb_array_length(c.rules) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'checked', false);
  END IF;
  v_eval := internal.contract_evaluate(c, NULL, p_rows);
  RETURN jsonb_build_object(
    'ok', v_eval->>'status' <> 'fail', 'checked', true, 'blocked', v_eval->>'status' = 'fail',
    'status', v_eval->>'status', 'contractId', c.id, 'contractName', c.name,
    'rowsChecked', (v_eval->>'rowsChecked')::bigint,
    'results', (SELECT coalesce(jsonb_agg(r), '[]'::jsonb)
                  FROM jsonb_array_elements(v_eval->'results') r WHERE r->>'status' = 'fail'));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.check_record_batch_contract(text, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.check_record_batch_contract(text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.check_record_batch_contract(text, jsonb) TO authenticated;
--> statement-breakpoint

-- Does one record meet its model's contract? Advisory, nothing is recorded:
-- the record page uses it to show what is missing after a save.
CREATE FUNCTION api.check_record_contract(p_record_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  rec api.records;
  c api.data_contracts;
  v_eval jsonb;
BEGIN
  PERFORM internal.assert_object_access('record', p_record_id, 'view');
  SELECT * INTO rec FROM api.records WHERE id = p_record_id AND workspace_id = api.current_workspace_id();
  IF rec.id IS NULL THEN RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB106'; END IF;
  SELECT * INTO c FROM api.data_contracts
   WHERE workspace_id = rec.workspace_id AND record_model_key = rec.kind AND lifecycle = 'active';
  IF c.id IS NULL OR jsonb_array_length(c.rules) = 0 THEN
    RETURN jsonb_build_object('checked', false);
  END IF;
  v_eval := internal.contract_evaluate(
    c, NULL, jsonb_build_array(jsonb_build_object(
      'operation', 'update', 'rowId', rec.id, 'values', rec.custom_fields)));
  RETURN jsonb_build_object(
    'checked', true, 'status', v_eval->>'status', 'contractId', c.id, 'contractName', c.name,
    'results', (SELECT coalesce(jsonb_agg(r), '[]'::jsonb)
                  FROM jsonb_array_elements(v_eval->'results') r WHERE r->>'status' = 'fail'));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.check_record_contract(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.check_record_contract(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.check_record_contract(uuid) TO authenticated;
--> statement-breakpoint

-- Scheduled checks: run every contract whose time has come. Called by the
-- server's timer, never by a person.
CREATE FUNCTION internal.sweep_contract_checks(p_limit integer DEFAULT 20) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c api.data_contracts;
  v_count integer := 0;
BEGIN
  FOR c IN
    SELECT * FROM api.data_contracts
     WHERE lifecycle = 'active' AND schedule_minutes IS NOT NULL AND next_check_at <= now()
       AND jsonb_array_length(rules) > 0
     ORDER BY next_check_at LIMIT greatest(1, least(coalesce(p_limit, 20), 200))
       FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE api.data_contracts SET next_check_at = now() + make_interval(mins => c.schedule_minutes)
     WHERE id = c.id;
    PERFORM internal.contract_run_stored(c, NULL, 'schedule');
    v_count := v_count + 1;
  END LOOP;
  -- Scheduled runs are a log, not a record: keep three months of them.
  DELETE FROM api.data_contract_runs r
   WHERE r.trigger = 'schedule' AND r.created_at < now() - interval '90 days'
     AND r.id <> (SELECT r2.id FROM api.data_contract_runs r2
                   WHERE r2.contract_id = r.contract_id AND r2.dataset_id IS NOT DISTINCT FROM r.dataset_id
                     AND r2.scope = 'stored'
                   ORDER BY r2.created_at DESC LIMIT 1);
  RETURN jsonb_build_object('checked', v_count);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.sweep_contract_checks(integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.sweep_contract_checks(integer) FROM PUBLIC;
--> statement-breakpoint

-- ODCS v3.1 ----------------------------------------------------------------------
-- The Open Data Contract Standard, as JSON (YAML reads it as it is). Only what a
-- Sheetbase rule can say is written; the rest of a contract is ignored on import
-- and reported back. Rule modes travel as the ODCS severity (error blocks) and
-- in a `sheetbase.mode` custom property.

CREATE FUNCTION api.export_data_contract_odcs(p_contract_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c api.data_contracts;
  v_table text;
  v_types jsonb := '{}'::jsonb;
  v_props jsonb;
  v_schema_quality jsonb;
  v_sla jsonb;
  v_modes jsonb := '{}'::jsonb;
  v_owner text;
BEGIN
  SELECT * INTO c FROM api.data_contracts
   WHERE id = p_contract_id AND workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id);
  IF c.id IS NULL THEN RAISE EXCEPTION 'contract not found' USING ERRCODE = 'SB106'; END IF;
  IF c.dataset_schema_id IS NOT NULL THEN
    SELECT s.key INTO v_table FROM api.dataset_schema_definitions s WHERE s.id = c.dataset_schema_id;
    SELECT coalesce(jsonb_object_agg(vf.key, CASE vf.logical_type
             WHEN 'integer' THEN 'integer' WHEN 'decimal' THEN 'number' WHEN 'boolean' THEN 'boolean'
             WHEN 'date' THEN 'date' WHEN 'timestamp' THEN 'timestamp' ELSE 'string' END), '{}'::jsonb)
      INTO v_types
      FROM api.dataset_schema_versions sv
      JOIN api.dataset_schema_version_fields vf ON vf.schema_version_id = sv.id AND vf.lifecycle = 'active'
     WHERE sv.id = (SELECT x.id FROM api.dataset_schema_versions x WHERE x.schema_id = c.dataset_schema_id
                     ORDER BY x.version DESC LIMIT 1);
  ELSE
    v_table := c.record_model_key;
    SELECT coalesce(jsonb_object_agg(fd.field_name, CASE fd.logical_type
             WHEN 'integer' THEN 'integer' WHEN 'decimal' THEN 'number' WHEN 'boolean' THEN 'boolean'
             WHEN 'date' THEN 'date' WHEN 'timestamp' THEN 'timestamp' ELSE 'string' END), '{}'::jsonb)
      INTO v_types
      FROM api.record_field_definitions fd
     WHERE fd.workspace_id = c.workspace_id AND fd.kind = c.record_model_key AND fd.lifecycle = 'active';
  END IF;

  SELECT coalesce(jsonb_agg(p.prop ORDER BY p.field), '[]'::jsonb) INTO v_props
    FROM (
      SELECT f.field,
             jsonb_strip_nulls(jsonb_build_object(
               'name', f.field,
               'logicalType', v_types->>f.field,
               'required', CASE WHEN bool_or(f.kind = 'required') THEN true END,
               'unique', CASE WHEN bool_or(f.kind = 'unique') THEN true END,
               'logicalTypeOptions', (
                 SELECT jsonb_strip_nulls(jsonb_build_object('minimum', r->'min', 'maximum', r->'max'))
                   FROM jsonb_array_elements(c.rules) r WHERE r->>'kind' = 'range' AND r->>'field' = f.field LIMIT 1),
               'customProperties', (
                 SELECT jsonb_agg(cp) FROM (
                   SELECT jsonb_build_object('property', 'allowedUnits', 'value', r->'units') AS cp
                     FROM jsonb_array_elements(c.rules) r WHERE r->>'kind' = 'units' AND r->>'field' = f.field
                   UNION ALL
                   SELECT jsonb_build_object('property', 'sheetbase.mode',
                            'value', jsonb_object_agg(r->>'kind', r->>'mode'))
                     FROM jsonb_array_elements(c.rules) r
                    WHERE r->>'field' = f.field AND r->>'kind' IN ('required', 'unique', 'range', 'units')
                   HAVING count(*) > 0) q),
               'quality', (
                 SELECT jsonb_agg(jsonb_build_object(
                          'name', r->>'id', 'type', 'library', 'metric', 'missingValues',
                          'mustBeLessOrEqualTo', 100 - (r->>'threshold')::numeric, 'unit', 'percent',
                          'severity', CASE WHEN r->>'mode' = 'block' THEN 'error' ELSE 'warning' END))
                   FROM jsonb_array_elements(c.rules) r WHERE r->>'kind' = 'completeness' AND r->>'field' = f.field)
             )) AS prop
        FROM (SELECT r->>'field' AS field, r->>'kind' AS kind FROM jsonb_array_elements(c.rules) r
               WHERE r->>'field' IS NOT NULL) f
       GROUP BY f.field) p;

  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'name', r->>'id', 'type', 'library', 'metric', 'rowCount',
           'mustBeBetween', CASE WHEN r ? 'min' AND r ? 'max' THEN jsonb_build_array(r->'min', r->'max') END,
           'mustBeGreaterOrEqualTo', CASE WHEN r ? 'min' AND NOT r ? 'max' THEN r->'min' END,
           'mustBeLessOrEqualTo', CASE WHEN r ? 'max' AND NOT r ? 'min' THEN r->'max' END,
           'unit', 'rows',
           'severity', CASE WHEN r->>'mode' = 'block' THEN 'error' ELSE 'warning' END)))
    INTO v_schema_quality
    FROM jsonb_array_elements(c.rules) r WHERE r->>'kind' = 'row_count';

  SELECT jsonb_agg(jsonb_build_object(
           'property', 'freshness', 'value', (r->>'maxAgeMinutes')::numeric, 'unit', 'm'))
    INTO v_sla
    FROM jsonb_array_elements(c.rules) r WHERE r->>'kind' = 'freshness';

  SELECT coalesce(jsonb_object_agg(r->>'kind', r->>'mode'), '{}'::jsonb) INTO v_modes
    FROM jsonb_array_elements(c.rules) r WHERE r->>'kind' IN ('row_count', 'freshness');

  SELECT m.username INTO v_owner FROM api.workspace_memberships m
   WHERE m.workspace_id = c.workspace_id AND m.user_id = c.owner_user_id;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'apiVersion', 'v3.1.0',
    'kind', 'DataContract',
    'id', c.id,
    'name', c.name,
    'version', c.version || '.0.0',
    'status', CASE c.lifecycle WHEN 'retired' THEN 'deprecated' ELSE c.lifecycle END,
    'description', CASE WHEN c.description IS NOT NULL THEN jsonb_build_object('purpose', c.description) END,
    'team', CASE WHEN v_owner IS NOT NULL THEN jsonb_build_object(
              'members', jsonb_build_array(jsonb_build_object('username', v_owner, 'role', 'owner'))) END,
    'schema', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'name', v_table, 'physicalType', 'table', 'properties', v_props, 'quality', v_schema_quality,
      'customProperties', CASE WHEN v_modes <> '{}'::jsonb
        THEN jsonb_build_array(jsonb_build_object('property', 'sheetbase.mode', 'value', v_modes)) END))),
    'slaProperties', v_sla));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.export_data_contract_odcs(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.export_data_contract_odcs(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.export_data_contract_odcs(uuid) TO authenticated;
--> statement-breakpoint

-- Make or replace a contract's rules from an ODCS document. Returns the
-- contract and a list of the parts of the document that were left out.
CREATE FUNCTION api.import_data_contract_odcs(
    p_odcs jsonb, p_dataset_schema_id uuid DEFAULT NULL, p_record_model_key text DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
  v_schema_id uuid := p_dataset_schema_id;
  v_model text := p_record_model_key;
  v_obj jsonb;
  v_prop jsonb;
  v_q jsonb;
  v_cp jsonb;
  v_rules jsonb := '[]'::jsonb;
  v_ignored jsonb := '[]'::jsonb;
  v_field text;
  v_mode jsonb;
  v_sev text;
  v_val numeric;
  v_lo numeric;
  v_hi numeric;
  v_status text;
  v_owner text;
  c api.data_contracts;
BEGIN
  PERFORM api.require_capability(v_ws, 'schema.edit');
  IF jsonb_typeof(p_odcs) IS DISTINCT FROM 'object' OR p_odcs->>'kind' IS DISTINCT FROM 'DataContract' THEN
    RAISE EXCEPTION 'this is not an ODCS data contract (kind must be DataContract)' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_odcs->'schema') IS DISTINCT FROM 'array' OR jsonb_array_length(p_odcs->'schema') = 0 THEN
    RAISE EXCEPTION 'the contract has no schema to read rules from' USING ERRCODE = '22023';
  END IF;
  v_obj := p_odcs->'schema'->0;
  IF jsonb_array_length(p_odcs->'schema') > 1 THEN
    v_ignored := v_ignored || to_jsonb('only the first schema object is read'::text);
  END IF;

  IF v_schema_id IS NULL AND v_model IS NULL THEN
    SELECT s.id INTO v_schema_id FROM api.dataset_schema_definitions s
     WHERE s.workspace_id = v_ws AND s.key = v_obj->>'name';
    IF v_schema_id IS NULL THEN
      SELECT m.key INTO v_model FROM api.record_models m WHERE m.workspace_id = v_ws AND m.key = v_obj->>'name';
    END IF;
    IF v_schema_id IS NULL AND v_model IS NULL THEN
      RAISE EXCEPTION 'no dataset schema or record model is named %; pick where the contract goes', v_obj->>'name'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  FOR v_prop IN SELECT value FROM jsonb_array_elements(coalesce(v_obj->'properties', '[]'::jsonb)) LOOP
    v_field := v_prop->>'name';
    IF v_field IS NULL THEN CONTINUE; END IF;
    SELECT cp->'value' INTO v_mode FROM jsonb_array_elements(coalesce(v_prop->'customProperties', '[]'::jsonb)) cp
     WHERE cp->>'property' = 'sheetbase.mode' LIMIT 1;
    IF (v_prop->>'required')::boolean IS TRUE THEN
      v_rules := v_rules || jsonb_build_object('id', left('required_' || v_field, 40), 'kind', 'required',
        'field', v_field, 'mode', coalesce(v_mode->>'required', 'warn'));
    END IF;
    IF (v_prop->>'unique')::boolean IS TRUE THEN
      v_rules := v_rules || jsonb_build_object('id', left('unique_' || v_field, 40), 'kind', 'unique',
        'field', v_field, 'mode', coalesce(v_mode->>'unique', 'warn'));
    END IF;
    v_lo := CASE WHEN jsonb_typeof(v_prop#>'{logicalTypeOptions,minimum}') = 'number' THEN (v_prop#>>'{logicalTypeOptions,minimum}')::numeric END;
    v_hi := CASE WHEN jsonb_typeof(v_prop#>'{logicalTypeOptions,maximum}') = 'number' THEN (v_prop#>>'{logicalTypeOptions,maximum}')::numeric END;
    IF v_lo IS NOT NULL OR v_hi IS NOT NULL THEN
      v_rules := v_rules || jsonb_strip_nulls(jsonb_build_object('id', left('range_' || v_field, 40), 'kind', 'range',
        'field', v_field, 'mode', coalesce(v_mode->>'range', 'warn'), 'min', v_lo, 'max', v_hi));
    END IF;
    FOR v_cp IN SELECT value FROM jsonb_array_elements(coalesce(v_prop->'customProperties', '[]'::jsonb)) LOOP
      IF v_cp->>'property' = 'allowedUnits' AND jsonb_typeof(v_cp->'value') = 'array' THEN
        v_rules := v_rules || jsonb_build_object('id', left('units_' || v_field, 40), 'kind', 'units',
          'field', v_field, 'mode', coalesce(v_mode->>'units', 'warn'), 'units', v_cp->'value');
      END IF;
    END LOOP;
    FOR v_q IN SELECT value FROM jsonb_array_elements(coalesce(v_prop->'quality', '[]'::jsonb)) LOOP
      v_sev := CASE WHEN v_q->>'severity' = 'error' THEN 'block' ELSE 'warn' END;
      IF v_q->>'metric' IN ('missingValues', 'nullValues') AND v_q->>'unit' = 'percent'
         AND (v_q ? 'mustBeLessOrEqualTo' OR v_q ? 'mustBeLessThan' OR v_q ? 'mustBe') THEN
        v_val := coalesce((v_q->>'mustBeLessOrEqualTo')::numeric, (v_q->>'mustBeLessThan')::numeric, (v_q->>'mustBe')::numeric);
        IF v_val IS NOT NULL AND v_val >= 0 AND v_val < 100 THEN
          v_rules := v_rules || jsonb_build_object('id', left('completeness_' || v_field, 40), 'kind', 'completeness',
            'field', v_field, 'mode', v_sev, 'threshold', 100 - v_val);
          CONTINUE;
        END IF;
      END IF;
      v_ignored := v_ignored || to_jsonb(('quality check on ' || v_field || ' (' || coalesce(v_q->>'metric', v_q->>'type', 'unnamed') || ')')::text);
    END LOOP;
  END LOOP;

  SELECT cp->'value' INTO v_mode FROM jsonb_array_elements(coalesce(v_obj->'customProperties', '[]'::jsonb)) cp
   WHERE cp->>'property' = 'sheetbase.mode' LIMIT 1;
  FOR v_q IN SELECT value FROM jsonb_array_elements(coalesce(v_obj->'quality', '[]'::jsonb)) LOOP
    IF v_q->>'metric' = 'rowCount' THEN
      v_lo := NULL; v_hi := NULL;
      IF jsonb_typeof(v_q->'mustBeBetween') = 'array' AND jsonb_array_length(v_q->'mustBeBetween') = 2 THEN
        v_lo := (v_q#>>'{mustBeBetween,0}')::numeric; v_hi := (v_q#>>'{mustBeBetween,1}')::numeric;
      END IF;
      v_lo := coalesce(v_lo, (v_q->>'mustBeGreaterOrEqualTo')::numeric, (v_q->>'mustBeGreaterThan')::numeric + 1, (v_q->>'mustBe')::numeric);
      v_hi := coalesce(v_hi, (v_q->>'mustBeLessOrEqualTo')::numeric, (v_q->>'mustBeLessThan')::numeric - 1, (v_q->>'mustBe')::numeric);
      IF v_lo IS NOT NULL OR v_hi IS NOT NULL THEN
        v_rules := v_rules || jsonb_strip_nulls(jsonb_build_object('id', 'row_count', 'kind', 'row_count',
          'mode', CASE WHEN v_q->>'severity' = 'error' THEN 'block' ELSE coalesce(v_mode->>'row_count', 'warn') END,
          'min', greatest(v_lo, 0), 'max', v_hi));
        CONTINUE;
      END IF;
    END IF;
    v_ignored := v_ignored || to_jsonb(('table quality check (' || coalesce(v_q->>'metric', v_q->>'type', 'unnamed') || ')')::text);
  END LOOP;

  FOR v_q IN SELECT value FROM jsonb_array_elements(coalesce(p_odcs->'slaProperties', '[]'::jsonb)) LOOP
    IF v_q->>'property' IN ('freshness', 'latency') AND jsonb_typeof(v_q->'value') = 'number' THEN
      v_val := (v_q->>'value')::numeric * CASE lower(coalesce(v_q->>'unit', 'm'))
        WHEN 'd' THEN 1440 WHEN 'day' THEN 1440 WHEN 'days' THEN 1440
        WHEN 'h' THEN 60 WHEN 'hr' THEN 60 WHEN 'hour' THEN 60 WHEN 'hours' THEN 60
        WHEN 'm' THEN 1 WHEN 'min' THEN 1 WHEN 'minute' THEN 1 WHEN 'minutes' THEN 1
        WHEN 'y' THEN 525600 WHEN 'year' THEN 525600 WHEN 'years' THEN 525600 ELSE NULL END;
      IF v_val IS NOT NULL AND v_val >= 1 THEN
        v_rules := v_rules || jsonb_build_object('id', 'freshness', 'kind', 'freshness',
          'mode', coalesce(v_mode->>'freshness', 'warn'), 'maxAgeMinutes', round(v_val));
        CONTINUE;
      END IF;
    END IF;
    v_ignored := v_ignored || to_jsonb(('service level ' || coalesce(v_q->>'property', 'unnamed'))::text);
  END LOOP;

  v_status := CASE p_odcs->>'status' WHEN 'deprecated' THEN 'retired' WHEN 'retired' THEN 'retired'
                WHEN 'draft' THEN 'draft' WHEN 'proposed' THEN 'draft' ELSE 'active' END;
  SELECT m.user_id INTO v_owner FROM api.workspace_memberships m
   WHERE m.workspace_id = v_ws AND m.suspended_at IS NULL
     AND m.username = (SELECT x->>'username' FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_odcs#>'{team,members}') = 'array' THEN p_odcs#>'{team,members}'
                WHEN jsonb_typeof(p_odcs->'team') = 'array' THEN p_odcs->'team' ELSE '[]'::jsonb END) x
         WHERE x->>'role' = 'owner' LIMIT 1);

  c := internal.contract_upsert(v_ws, v_schema_id, v_model, v_rules, p_odcs->>'name',
                                p_odcs#>>'{description,purpose}', v_owner, v_status, NULL);
  RETURN jsonb_build_object('contract', to_jsonb(c), 'rulesImported', jsonb_array_length(v_rules), 'ignored', v_ignored);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.import_data_contract_odcs(jsonb, uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.import_data_contract_odcs(jsonb, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.import_data_contract_odcs(jsonb, uuid, text) TO authenticated;
--> statement-breakpoint

-- Gate imports and pipeline commits -----------------------------------------------

-- An import that breaks a block-mode rule is refused before anything is written.
DO $$
DECLARE
  v_def text;
  v_marker constant text := '  committed := api.commit_dataset_row_batch_atomic(';
  v_gate constant text := $gate$
  contract_gate := internal.contract_gate(d.id, p_rows, 'import');
  IF coalesce((contract_gate->>'blocked')::boolean, false) THEN
    RETURN jsonb_build_object(
      'ok', false, 'contract', contract_gate,
      'errors', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'code', 'contract_failed', 'rowIndex', nullif(gs->>'row', '')::integer,
                 'ruleId', gr->>'ruleId', 'field', gr->>'field'))
          FROM jsonb_array_elements(contract_gate->'results') gr
          LEFT JOIN LATERAL jsonb_array_elements(coalesce(gr->'samples', '[]'::jsonb)) gs ON true
         WHERE gr->>'mode' = 'block'), '[]'::jsonb));
  END IF;
$gate$;
BEGIN
  SELECT pg_get_functiondef(
    'api.commit_dataset_import(uuid, bigint, jsonb, text, uuid, jsonb, jsonb, uuid, uuid, uuid, uuid, uuid, jsonb)'::regprocedure)
    INTO v_def;
  IF position(v_marker IN v_def) = 0 OR position('contract_gate' IN v_def) > 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.commit_dataset_import';
  END IF;
  v_def := replace(v_def, v_marker, v_gate || v_marker);
  v_def := replace(v_def, E'provenance jsonb; source jsonb; row_ids jsonb;', E'provenance jsonb; source jsonb; row_ids jsonb; contract_gate jsonb;');
  IF position('contract_gate jsonb;' IN v_def) = 0 THEN
    RAISE EXCEPTION 'could not declare the contract gate variable';
  END IF;
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- Pipeline action: check a contract.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"run_contract_check","rpc":"run_contract_check","label":"Check a data contract","description":"Check a data contract against its data now and keep the result.","arguments":[{"name":"p_contract_id","type":"uuid","required":true,"nullable":false},{"name":"p_dataset_id","type":"uuid","required":false,"nullable":true}]}$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || ']$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
