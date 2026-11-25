-- Unit conversion. A number typed with a unit ("2 g") into a column stored in
-- another unit of the same kind (mg) is stored in the column's unit (2000).
-- What the person typed is kept in api.quantity_entries, and in the change
-- event of a dataset row. A unit of another kind ("2 mL" into mg) is refused.
--
-- The unit table matches src/lib/lab-units.ts (tests/db/lab-units.test.ts
-- checks both). A unit converts to its dimension's base as
-- (value + pre_offset) * factor / divisor. A "×10⁶" in front of a unit scales
-- it, so "×10⁶ cells/mL" and "×10¹⁰ vg/mL" need no row of their own.
--
-- Values may be written as a number (already in the column's unit), as text
-- ("2 g", "1.5 ×10⁶ cells/mL") or as {"value": 2, "unit": "g"} in:
--   dataset rows        validate_dataset_row_batch, commit_dataset_row_batch
--   sheet cells         mutate_sheet_instance_local_state
--   record fields       any insert or update of api.records.custom_fields
-- api.convert_quantity converts a number for pipelines, agents and the API.

CREATE TABLE api.lab_units (
    symbol text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    dimension text NOT NULL,
    factor numeric NOT NULL,
    divisor numeric DEFAULT 1 NOT NULL,
    pre_offset numeric DEFAULT 0 NOT NULL,
    display_order integer NOT NULL,
    CONSTRAINT lab_units_pkey PRIMARY KEY (symbol),
    CONSTRAINT chk_lab_units_scale CHECK (factor > 0 AND divisor > 0)
);
--> statement-breakpoint
ALTER TABLE api.lab_units OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.lab_units ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lab_units_select ON api.lab_units FOR SELECT TO authenticated, api_client USING (true);
--> statement-breakpoint
GRANT SELECT ON TABLE api.lab_units TO authenticated, api_client;
--> statement-breakpoint
INSERT INTO api.lab_units (symbol, aliases, dimension, factor, divisor, pre_offset, display_order) VALUES
  ('kg', ARRAY[]::text[], 'mass', 1000, 1, 0, 1),
  ('g', ARRAY[]::text[], 'mass', 1, 1, 0, 2),
  ('mg', ARRAY[]::text[], 'mass', 0.001, 1, 0, 3),
  ('µg', ARRAY['ug', 'mcg']::text[], 'mass', 0.000001, 1, 0, 4),
  ('ng', ARRAY[]::text[], 'mass', 0.000000001, 1, 0, 5),
  ('pg', ARRAY[]::text[], 'mass', 0.000000000001, 1, 0, 6),
  ('L', ARRAY['l']::text[], 'volume', 1, 1, 0, 7),
  ('mL', ARRAY['ml']::text[], 'volume', 0.001, 1, 0, 8),
  ('µL', ARRAY['uL', 'ul', 'µl']::text[], 'volume', 0.000001, 1, 0, 9),
  ('nL', ARRAY['nl']::text[], 'volume', 0.000000001, 1, 0, 10),
  ('mol', ARRAY[]::text[], 'amount', 1, 1, 0, 11),
  ('mmol', ARRAY[]::text[], 'amount', 0.001, 1, 0, 12),
  ('µmol', ARRAY['umol']::text[], 'amount', 0.000001, 1, 0, 13),
  ('nmol', ARRAY[]::text[], 'amount', 0.000000001, 1, 0, 14),
  ('pmol', ARRAY[]::text[], 'amount', 0.000000000001, 1, 0, 15),
  ('M', ARRAY['mol/L']::text[], 'molar concentration', 1, 1, 0, 16),
  ('mM', ARRAY['mmol/L']::text[], 'molar concentration', 0.001, 1, 0, 17),
  ('µM', ARRAY['uM', 'µmol/L', 'umol/L']::text[], 'molar concentration', 0.000001, 1, 0, 18),
  ('nM', ARRAY['nmol/L']::text[], 'molar concentration', 0.000000001, 1, 0, 19),
  ('pM', ARRAY['pmol/L']::text[], 'molar concentration', 0.000000000001, 1, 0, 20),
  ('g/mL', ARRAY['g/ml']::text[], 'mass concentration', 1000, 1, 0, 21),
  ('g/L', ARRAY['g/l']::text[], 'mass concentration', 1, 1, 0, 22),
  ('mg/mL', ARRAY['mg/ml']::text[], 'mass concentration', 1, 1, 0, 23),
  ('ng/µL', ARRAY['ng/uL', 'ng/ul']::text[], 'mass concentration', 1, 1, 0, 24),
  ('mg/L', ARRAY['mg/l']::text[], 'mass concentration', 0.001, 1, 0, 25),
  ('µg/mL', ARRAY['ug/mL', 'ug/ml', 'µg/ml']::text[], 'mass concentration', 0.001, 1, 0, 26),
  ('µg/L', ARRAY['ug/L']::text[], 'mass concentration', 0.000001, 1, 0, 27),
  ('ng/mL', ARRAY['ng/ml']::text[], 'mass concentration', 0.000001, 1, 0, 28),
  ('pg/mL', ARRAY['pg/ml']::text[], 'mass concentration', 0.000000001, 1, 0, 29),
  ('ms', ARRAY[]::text[], 'time', 0.001, 1, 0, 30),
  ('s', ARRAY['sec']::text[], 'time', 1, 1, 0, 31),
  ('min', ARRAY['mins']::text[], 'time', 60, 1, 0, 32),
  ('h', ARRAY['hr', 'hrs']::text[], 'time', 3600, 1, 0, 33),
  ('day', ARRAY['days', 'd']::text[], 'time', 86400, 1, 0, 34),
  ('week', ARRAY['weeks', 'wk']::text[], 'time', 604800, 1, 0, 35),
  ('K', ARRAY[]::text[], 'temperature', 1, 1, 0, 36),
  ('°C', ARRAY['C', 'degC', 'ºC']::text[], 'temperature', 1, 1, 273.15, 37),
  ('°F', ARRAY['F', 'degF', 'ºF']::text[], 'temperature', 5, 9, 459.67, 38),
  ('m', ARRAY[]::text[], 'length', 1, 1, 0, 39),
  ('cm', ARRAY[]::text[], 'length', 0.01, 1, 0, 40),
  ('mm', ARRAY[]::text[], 'length', 0.001, 1, 0, 41),
  ('µm', ARRAY['um', 'micron']::text[], 'length', 0.000001, 1, 0, 42),
  ('nm', ARRAY[]::text[], 'length', 0.000000001, 1, 0, 43),
  ('Pa', ARRAY[]::text[], 'pressure', 1, 1, 0, 44),
  ('kPa', ARRAY[]::text[], 'pressure', 1000, 1, 0, 45),
  ('MPa', ARRAY[]::text[], 'pressure', 1000000, 1, 0, 46),
  ('bar', ARRAY[]::text[], 'pressure', 100000, 1, 0, 47),
  ('mbar', ARRAY[]::text[], 'pressure', 100, 1, 0, 48),
  ('psi', ARRAY[]::text[], 'pressure', 6894.757293168, 1, 0, 49),
  ('atm', ARRAY[]::text[], 'pressure', 101325, 1, 0, 50),
  ('mmHg', ARRAY[]::text[], 'pressure', 133.322387415, 1, 0, 51),
  ('Torr', ARRAY['torr']::text[], 'pressure', 101325, 760, 0, 52),
  ('L/min', ARRAY[]::text[], 'flow rate', 1, 1, 0, 53),
  ('mL/min', ARRAY['ml/min']::text[], 'flow rate', 0.001, 1, 0, 54),
  ('µL/min', ARRAY['uL/min']::text[], 'flow rate', 0.000001, 1, 0, 55),
  ('L/h', ARRAY[]::text[], 'flow rate', 1, 60, 0, 56),
  ('mL/h', ARRAY['ml/h']::text[], 'flow rate', 1, 60000, 0, 57),
  ('cells/mL', ARRAY['cells/ml']::text[], 'cell concentration', 1, 1, 0, 58),
  ('cells/µL', ARRAY['cells/uL', 'cells/ul']::text[], 'cell concentration', 1000, 1, 0, 59);
--> statement-breakpoint

CREATE TABLE api.quantity_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    -- 'record' (a record field), 'dataset' (a dataset row value) or
    -- 'instance' (a cell of a sheet's own columns).
    object_kind text NOT NULL,
    object_id uuid NOT NULL,
    -- The dataset row id or the sheet row key; null for a record.
    row_key text,
    -- The record field name, or the dataset or sheet field id.
    field_key text NOT NULL,
    entered_value numeric NOT NULL,
    entered_unit text NOT NULL,
    stored_value numeric NOT NULL,
    stored_unit text NOT NULL,
    actor_user_id text,
    actor_credential_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quantity_entries_pkey PRIMARY KEY (id),
    CONSTRAINT quantity_entries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_quantity_entries_kind CHECK (object_kind IN ('record', 'dataset', 'instance'))
);
--> statement-breakpoint
ALTER TABLE api.quantity_entries OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_quantity_entries_object ON api.quantity_entries (object_kind, object_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE api.quantity_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY quantity_entries_select ON api.quantity_entries FOR SELECT TO authenticated, api_client
    USING (workspace_id = api.current_workspace_id() AND internal.can_access_object(object_kind, object_id, 'view'));
--> statement-breakpoint
GRANT SELECT ON TABLE api.quantity_entries TO authenticated, api_client;
--> statement-breakpoint

-- Spelling: the Greek mu is the micro sign, and superscripts are powers
-- ("×10⁶" is "×10^6"). replace(), not translate(): translate counts bytes on a
-- SQL_ASCII database.
CREATE FUNCTION internal.lab_unit_text(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $$ SELECT btrim(regexp_replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(regexp_replace(coalesce(p_text, ''), '(?<!⁰|¹|²|³|⁴|⁵|⁶|⁷|⁸|⁹|⁻)(⁰|¹|²|³|⁴|⁵|⁶|⁷|⁸|⁹|⁻)', '^\1', 'g'), 'μ', 'µ'), '⁰', '0'), '¹', '1'), '²', '2'), '³', '3'), '⁴', '4'), '⁵', '5'), '⁶', '6'), '⁷', '7'), '⁸', '8'), '⁹', '9'), '⁻', '-'), '\s+', ' ', 'g')) $$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_unit_text(text) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.lab_unit_resolve(p_unit text, OUT dimension text, OUT factor numeric, OUT divisor numeric, OUT pre_offset numeric, OUT exponent integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE normal text := internal.lab_unit_text(p_unit); scale text[]; base text;
BEGIN
  scale := regexp_match(normal, '^(?:×|x|\*)?\s*10\^(-?[0-9]{1,3})\s+(.+)$');
  IF scale IS NULL THEN exponent := 0; base := normal;
  ELSE exponent := scale[1]::integer; base := scale[2]; END IF;
  SELECT u.dimension, u.factor, u.divisor, u.pre_offset INTO dimension, factor, divisor, pre_offset
    FROM api.lab_units u WHERE u.symbol = base OR base = ANY (u.aliases) LIMIT 1;
  IF dimension IS NULL THEN
    dimension := 'unit:' || base; factor := 1; divisor := 1; pre_offset := 0;
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_unit_resolve(text) OWNER TO migrator;
--> statement-breakpoint

-- 12 significant figures of the largest number in the sum, so -40 °C is
-- -40 °F, not -40.0000000000001.
CREATE FUNCTION internal.lab_unit_round(p_value numeric, p_magnitude numeric) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE SET search_path TO ''
AS $$
DECLARE scale numeric := greatest(abs(p_value), abs(p_magnitude));
BEGIN
  IF scale = 0 THEN RETURN 0; END IF;
  RETURN trim_scale(round(p_value, 11 - floor(log(scale))::integer));
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_unit_round(numeric, numeric) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.lab_same_unit(p_a text, p_b text) RETURNS boolean
    LANGUAGE sql STABLE SET search_path TO ''
AS $$ SELECT (a.dimension, a.factor, a.divisor, a.pre_offset, a.exponent) = (b.dimension, b.factor, b.divisor, b.pre_offset, b.exponent)
      FROM internal.lab_unit_resolve(p_a) a, internal.lab_unit_resolve(p_b) b $$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_same_unit(text, text) OWNER TO migrator;
--> statement-breakpoint

-- The value in another unit of the same dimension; null when they differ.
CREATE FUNCTION internal.lab_convert_quantity(p_value numeric, p_from text, p_to text) RETURNS numeric
    LANGUAGE plpgsql STABLE SET search_path TO ''
AS $$
DECLARE a record; b record; base numeric;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO a FROM internal.lab_unit_resolve(p_from);
  SELECT * INTO b FROM internal.lab_unit_resolve(p_to);
  IF a.dimension <> b.dimension THEN RETURN NULL; END IF;
  base := ((p_value * (10::numeric ^ a.exponent) + a.pre_offset) * a.factor) / a.divisor;
  RETURN internal.lab_unit_round(((base * b.divisor) / b.factor - b.pre_offset) / (10::numeric ^ b.exponent),
    greatest(a.pre_offset, b.pre_offset));
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_convert_quantity(numeric, text, text) OWNER TO migrator;
--> statement-breakpoint

-- "2 g" → (2, 'g'); "12" → (12, null); anything else → (null, null).
CREATE FUNCTION internal.lab_quantity_parse(p_text text, OUT value numeric, OUT unit text)
    LANGUAGE plpgsql IMMUTABLE SET search_path TO ''
AS $$
DECLARE parts text[];
BEGIN
  parts := regexp_match(coalesce(p_text, ''), '^\s*([-+]?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)?(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?)\s*(.*)$');
  IF parts IS NULL OR parts[1] !~ '[0-9]' THEN RETURN; END IF;
  BEGIN value := replace(parts[1], ',', '')::numeric;
  EXCEPTION WHEN others THEN value := NULL; RETURN; END;
  unit := nullif(btrim(regexp_replace(parts[2], '\s+', ' ', 'g')), '');
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_quantity_parse(text) OWNER TO migrator;
--> statement-breakpoint

-- What one value written to a number stored in p_unit means:
--   {"value": n}                                  a number in the stored unit
--   {"value": n, "entered": {"value", "unit"}}   converted from another unit
--   {"error": "wrong_unit", "entered": {...}}     a unit of another kind
--   {"error": "not_a_number"}                     text that is not a number
-- A JSON number, or any value when the field has no unit, returns null: the
-- field's usual checks apply to it unchanged.
CREATE FUNCTION internal.lab_quantity_entry(p_value jsonb, p_unit text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SET search_path TO ''
AS $$
DECLARE v numeric; u text; converted numeric; entered jsonb;
BEGIN
  IF nullif(btrim(coalesce(p_unit, '')), '') IS NULL OR p_value IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_value) = 'string' THEN
    SELECT q.value, q.unit INTO v, u FROM internal.lab_quantity_parse(p_value #>> '{}') q;
  ELSIF jsonb_typeof(p_value) = 'object' AND (p_value - ARRAY['value', 'unit']) = '{}'::jsonb
        AND jsonb_typeof(p_value -> 'value') = 'number' AND jsonb_typeof(p_value -> 'unit') = 'string' THEN
    v := (p_value ->> 'value')::numeric; u := nullif(btrim(regexp_replace(p_value ->> 'unit', '\s+', ' ', 'g')), '');
  ELSE RETURN NULL;
  END IF;
  IF v IS NULL THEN RETURN jsonb_build_object('error', 'not_a_number'); END IF;
  IF u IS NULL OR internal.lab_same_unit(u, p_unit) THEN RETURN jsonb_build_object('value', v); END IF;
  entered := jsonb_build_object('value', v, 'unit', u);
  converted := internal.lab_convert_quantity(v, u, p_unit);
  IF converted IS NULL THEN RETURN jsonb_build_object('error', 'wrong_unit', 'entered', entered); END IF;
  RETURN jsonb_build_object('value', converted, 'entered', entered);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_quantity_entry(jsonb, text) OWNER TO migrator;
--> statement-breakpoint

-- A field value (one value, or a list of them) in p_unit:
-- {"value": <value to store>, "entered": <entry, or a list with nulls>?,
--  "error": "wrong_unit"?}. Values that are not unit entries pass unchanged.
CREATE FUNCTION internal.lab_quantities_in_unit(p_value jsonb, p_unit text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SET search_path TO ''
AS $$
DECLARE item jsonb; entry jsonb; values_out jsonb := '[]'; entered jsonb := '[]'; any_entered boolean := false; error text;
BEGIN
  IF jsonb_typeof(p_value) = 'array' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      entry := internal.lab_quantity_entry(item, p_unit);
      values_out := values_out || jsonb_build_array(CASE WHEN entry ? 'value' THEN entry -> 'value' ELSE item END);
      entered := entered || jsonb_build_array(coalesce(entry -> 'entered', 'null'::jsonb));
      any_entered := any_entered OR (entry ? 'entered' AND entry ? 'value');
      IF entry ->> 'error' = 'wrong_unit' THEN error := 'wrong_unit'; END IF;
    END LOOP;
    RETURN jsonb_strip_nulls(jsonb_build_object('value', values_out, 'error', error))
      || CASE WHEN any_entered THEN jsonb_build_object('entered', entered) ELSE '{}'::jsonb END;
  END IF;
  entry := internal.lab_quantity_entry(p_value, p_unit);
  IF entry ? 'value' THEN RETURN entry; END IF;
  RETURN jsonb_build_object('value', p_value) || CASE WHEN entry ->> 'error' = 'wrong_unit' THEN jsonb_build_object('error', 'wrong_unit') ELSE '{}'::jsonb END;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_quantities_in_unit(jsonb, text) OWNER TO migrator;
--> statement-breakpoint

-- The unit a number field is stored in, from its quantity (or legacy unit).
CREATE FUNCTION internal.lab_storage_unit(p_logical_type text, p_quantity jsonb, p_unit jsonb DEFAULT NULL) RETURNS text
    LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $$ SELECT CASE WHEN p_logical_type IN ('integer', 'decimal')
  THEN coalesce(nullif(btrim(p_quantity ->> 'storageUnit'), ''), nullif(btrim(p_unit ->> 'symbol'), '')) END $$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_storage_unit(text, jsonb, jsonb) OWNER TO migrator;
--> statement-breakpoint

-- Keep what was typed: one row per converted value (a list logs each).
CREATE FUNCTION internal.log_quantity_entries(p_workspace uuid, p_kind text, p_object uuid, p_row_key text, p_field_key text, p_entered jsonb, p_stored jsonb, p_unit text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE i integer;
BEGIN
  IF p_entered IS NULL OR p_entered = 'null'::jsonb THEN RETURN; END IF;
  IF jsonb_typeof(p_entered) = 'array' THEN
    FOR i IN 0 .. jsonb_array_length(p_entered) - 1 LOOP
      PERFORM internal.log_quantity_entries(p_workspace, p_kind, p_object, p_row_key, p_field_key, p_entered -> i, p_stored -> i, p_unit);
    END LOOP;
    RETURN;
  END IF;
  IF jsonb_typeof(p_stored) <> 'number' THEN RETURN; END IF;
  INSERT INTO api.quantity_entries (workspace_id, object_kind, object_id, row_key, field_key, entered_value, entered_unit, stored_value, stored_unit, actor_user_id, actor_credential_id)
  VALUES (p_workspace, p_kind, p_object, p_row_key, p_field_key, (p_entered ->> 'value')::numeric, p_entered ->> 'unit', (p_stored #>> '{}')::numeric, p_unit, api.current_user_id(), api.current_credential_id());
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.log_quantity_entries(uuid, text, uuid, text, text, jsonb, jsonb, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.log_quantity_entries(uuid, text, uuid, text, text, jsonb, jsonb, text) FROM PUBLIC;
--> statement-breakpoint

-- For pipelines, agents and the API: a number in another unit of its kind.
CREATE FUNCTION api.convert_quantity(p_value numeric, p_from_unit text, p_to_unit text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SET search_path TO ''
AS $$
DECLARE converted numeric; a record; b record;
BEGIN
  IF p_value IS NULL OR nullif(btrim(coalesce(p_from_unit, '')), '') IS NULL OR nullif(btrim(coalesce(p_to_unit, '')), '') IS NULL THEN
    RAISE EXCEPTION 'a value, its unit and the unit to convert to are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM internal.lab_unit_resolve(p_from_unit);
  SELECT * INTO b FROM internal.lab_unit_resolve(p_to_unit);
  converted := internal.lab_convert_quantity(p_value, p_from_unit, p_to_unit);
  IF converted IS NULL THEN
    RAISE EXCEPTION '% and % measure different things', p_from_unit, p_to_unit USING ERRCODE = 'SB071';
  END IF;
  RETURN jsonb_build_object('value', converted, 'unit', internal.lab_unit_text(p_to_unit),
    'from', jsonb_build_object('value', p_value, 'unit', internal.lab_unit_text(p_from_unit)),
    'dimension', CASE WHEN a.dimension LIKE 'unit:%' THEN NULL ELSE a.dimension END);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.convert_quantity(numeric, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.convert_quantity(numeric, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.convert_quantity(numeric, text, text) TO authenticated, api_client;
--> statement-breakpoint

-- Dataset rows: unit entries become numbers in the column's unit, and the
-- row remembers what was typed under "entered" (a key the caller can't set).
CREATE FUNCTION internal.lab_dataset_rows_in_storage_units(p_schema_version_id uuid, p_rows jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE item jsonb; rows_out jsonb := '[]'; vals jsonb; entered jsonb; field record; result jsonb;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RETURN p_rows; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(item) <> 'object' THEN rows_out := rows_out || jsonb_build_array(item); CONTINUE; END IF;
    item := item - 'entered';
    IF jsonb_typeof(item -> 'values') IS DISTINCT FROM 'object' THEN rows_out := rows_out || jsonb_build_array(item); CONTINUE; END IF;
    vals := item -> 'values'; entered := '{}';
    FOR field IN
      SELECT f.field_id::text AS key, internal.lab_storage_unit(f.logical_type, f.quantity) AS unit
        FROM api.dataset_schema_version_fields f
       WHERE f.schema_version_id = p_schema_version_id AND f.lifecycle = 'active'
         AND internal.lab_storage_unit(f.logical_type, f.quantity) IS NOT NULL AND vals ? f.field_id::text
    LOOP
      result := internal.lab_quantities_in_unit(vals -> field.key, field.unit);
      IF result ? 'error' THEN CONTINUE; END IF;
      vals := jsonb_set(vals, ARRAY[field.key], result -> 'value');
      IF result ? 'entered' THEN entered := entered || jsonb_build_object(field.key, result -> 'entered'); END IF;
    END LOOP;
    item := jsonb_set(item, '{values}', vals);
    IF entered <> '{}'::jsonb THEN item := item || jsonb_build_object('entered', entered); END IF;
    rows_out := rows_out || jsonb_build_array(item);
  END LOOP;
  RETURN rows_out;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_dataset_rows_in_storage_units(uuid, jsonb) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.log_dataset_quantity_entries(p_dataset api.datasets, p_row_id uuid, p_values jsonb, p_entered jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE field_key text; entry jsonb; field record;
BEGIN
  FOR field_key, entry IN SELECT e.key, e.value FROM jsonb_each(coalesce(p_entered, '{}')) e LOOP
    SELECT f.logical_type, f.quantity INTO field FROM api.dataset_schema_version_fields f
     WHERE f.schema_version_id = p_dataset.schema_version_id AND f.field_id::text = field_key;
    PERFORM internal.log_quantity_entries(p_dataset.workspace_id, 'dataset', p_dataset.id, p_row_id::text, field_key, entry,
      p_values -> field_key, internal.lab_storage_unit(field.logical_type, field.quantity));
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.log_dataset_quantity_entries(api.datasets, uuid, jsonb, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.log_dataset_quantity_entries(api.datasets, uuid, jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint

-- Record fields: runs before the record type pin and the field checks
-- (a_record_model_pin, model_custom_fields_records), which then see numbers.
CREATE FUNCTION internal.convert_record_quantities() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE field_key text; v jsonb; typed text; version_id uuid; model api.record_models; field api.record_field_definitions; unit text; result jsonb; logged jsonb := '{}';
BEGIN
  IF NEW.custom_fields IS NULL OR jsonb_typeof(NEW.custom_fields) <> 'object' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_each(NEW.custom_fields) e WHERE jsonb_typeof(e.value) IN ('string', 'object', 'array')) THEN RETURN NEW; END IF;
  version_id := NEW.model_version_id;
  IF version_id IS NULL THEN
    SELECT * INTO model FROM api.record_models WHERE workspace_id = NEW.workspace_id AND key = NEW.kind;
    IF model.id IS NOT NULL THEN version_id := internal.latest_published_model_version(model.id); END IF;
  END IF;
  FOR field_key, v IN SELECT e.key, e.value FROM jsonb_each(NEW.custom_fields) e WHERE jsonb_typeof(e.value) IN ('string', 'object', 'array') LOOP
    IF TG_OP = 'UPDATE' AND OLD.custom_fields -> field_key IS NOT DISTINCT FROM v THEN CONTINUE; END IF;
    field := NULL;
    IF version_id IS NOT NULL THEN
      SELECT * INTO field FROM internal.record_model_fields(NEW.workspace_id, NEW.kind, version_id) d WHERE d.field_name = field_key LIMIT 1;
    ELSE
      SELECT * INTO field FROM api.record_field_definitions d
       WHERE d.workspace_id = NEW.workspace_id AND d.kind = internal.model_key_for('api.records', NEW.kind) AND d.field_name = field_key;
    END IF;
    unit := internal.lab_storage_unit(field.logical_type, field.quantity, field.unit);
    IF unit IS NULL THEN CONTINUE; END IF;
    result := internal.lab_quantities_in_unit(v, unit);
    IF result ->> 'error' = 'wrong_unit' THEN
      typed := CASE WHEN jsonb_typeof(v) = 'object' THEN concat_ws(' ', v ->> 'value', v ->> 'unit') ELSE v #>> '{}' END;
      RAISE EXCEPTION '%: % can''t be stored in %', field.label, typed, unit USING ERRCODE = 'SB071';
    END IF;
    IF result ? 'entered' THEN
      NEW.custom_fields := jsonb_set(NEW.custom_fields, ARRAY[field_key], result -> 'value');
      logged := logged || jsonb_build_object(field_key, jsonb_build_object('entered', result -> 'entered', 'unit', unit));
    ELSIF result -> 'value' IS DISTINCT FROM v THEN
      NEW.custom_fields := jsonb_set(NEW.custom_fields, ARRAY[field_key], result -> 'value');
    END IF;
  END LOOP;
  FOR field_key, v IN SELECT e.key, e.value FROM jsonb_each(logged) e LOOP
    PERFORM internal.log_quantity_entries(NEW.workspace_id, 'record', NEW.id, NULL, field_key, v -> 'entered', NEW.custom_fields -> field_key, v ->> 'unit');
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.convert_record_quantities() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER a_lab_record_quantities BEFORE INSERT OR UPDATE OF custom_fields ON api.records
    FOR EACH ROW EXECUTE FUNCTION internal.convert_record_quantities();
--> statement-breakpoint

-- The existing write paths, unchanged apart from the unit steps.

CREATE OR REPLACE FUNCTION api.validate_dataset_row_batch(p_dataset_id uuid, p_expected_dataset_revision bigint, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
DECLARE dataset api.datasets; item jsonb; cell jsonb; field api.dataset_schema_version_fields; v_field_id uuid; key text; row_id uuid; existing_row api.dataset_rows; row_index integer:=0; errors jsonb:='[]'::jsonb; error_code text; effective jsonb; seen uuid[] := '{}';
BEGIN
 IF p_dataset_id IS NOT NULL THEN PERFORM internal.assert_object_access('dataset',p_dataset_id,'view'); END IF;
 SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id);
 IF dataset.id IS NULL THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
 IF p_expected_dataset_revision IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'expected Dataset revision and 1 to 1000 batch rows are required' USING ERRCODE='22023'; END IF;
 IF dataset.lifecycle<>'active' THEN RETURN jsonb_build_object('ok',false,'errors',jsonb_build_array(jsonb_build_object('code','dataset_archived'))); END IF;
 IF dataset.revision<>p_expected_dataset_revision THEN RETURN jsonb_build_object('ok',false,'errors',jsonb_build_array(jsonb_build_object('code','stale_dataset_revision','expectedRevision',p_expected_dataset_revision,'actualRevision',dataset.revision))); END IF;
 p_rows:=internal.lab_dataset_rows_in_storage_units(dataset.schema_version_id,p_rows);
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  row_index:=row_index+1;
  IF jsonb_typeof(item)<>'object' OR (item-ARRAY['operation','rowId','expectedRevision','values','plannedKey','reason','entered'])<>'{}'::jsonb OR item->>'operation' NOT IN ('create','update') OR jsonb_typeof(item->'rowId')<>'string' OR jsonb_typeof(item->'values')<>'object' THEN RAISE EXCEPTION 'invalid Dataset batch row shape' USING ERRCODE='22023'; END IF;
  
    IF item ? 'reason' AND (jsonb_typeof(item->'reason')<>'string' OR length(btrim(item->>'reason')) NOT BETWEEN 1 AND 2000) THEN
      RAISE EXCEPTION 'Dataset change reason must contain 1 to 2000 characters' USING ERRCODE='22023';
    END IF;
    IF item ? 'plannedKey' AND (jsonb_typeof(item->'plannedKey')<>'string' OR length(item->>'plannedKey') NOT BETWEEN 1 AND 200) THEN RAISE EXCEPTION 'invalid Dataset row planned key' USING ERRCODE='22023'; END IF;
  
    IF item ? 'reason' AND (jsonb_typeof(item->'reason')<>'string' OR length(btrim(item->>'reason')) NOT BETWEEN 1 AND 2000) THEN
      RAISE EXCEPTION 'Dataset change reason must contain 1 to 2000 characters' USING ERRCODE='22023';
    END IF;
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
 p_rows:=internal.lab_dataset_rows_in_storage_units(dataset.schema_version_id,p_rows);
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
        'label',field.label,'fieldId',field.field_id,'from',audit_old,'to',effective)||CASE WHEN item->'entered' ? field.field_id::text THEN jsonb_build_object('entered',item->'entered'->field.field_id::text) ELSE '{}'::jsonb END);
    END IF;
    DELETE FROM api.dataset_row_values WHERE row_id=v_row_id AND field_id=field.field_id;
  
   IF effective<>'null'::jsonb THEN
    IF field.cardinality='many' THEN value_ordinal:=0; FOR value_item IN SELECT value FROM jsonb_array_elements(effective) LOOP INSERT INTO api.dataset_row_values(row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id) VALUES(v_row_id,field.field_id,value_ordinal,CASE WHEN field.logical_type='text' THEN value_item#>>'{}' WHEN field.logical_type='time' THEN internal.lab_time_text(value_item#>>'{}') WHEN field.logical_type='well' THEN internal.lab_well_text(value_item#>>'{}') WHEN field.logical_type='person' THEN value_item#>>'{}' END,CASE WHEN field.logical_type='integer' THEN (value_item#>>'{}')::bigint END,CASE WHEN field.logical_type IN ('decimal','duration') THEN (value_item#>>'{}')::numeric END,CASE WHEN field.logical_type='boolean' THEN (value_item#>>'{}')::boolean END,CASE WHEN field.logical_type='date' THEN (value_item#>>'{}')::date END,CASE WHEN field.logical_type='timestamp' THEN (value_item#>>'{}')::timestamptz END,CASE WHEN field.logical_type='category' THEN (value_item#>>'{}')::uuid END,CASE WHEN field.logical_type='reference' THEN (value_item#>>'{}')::uuid END); value_ordinal:=value_ordinal+1; END LOOP;
    ELSE INSERT INTO api.dataset_row_values(row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id) VALUES(v_row_id,field.field_id,0,CASE WHEN field.logical_type='text' THEN effective#>>'{}' WHEN field.logical_type='time' THEN internal.lab_time_text(effective#>>'{}') WHEN field.logical_type='well' THEN internal.lab_well_text(effective#>>'{}') WHEN field.logical_type='person' THEN effective#>>'{}' END,CASE WHEN field.logical_type='integer' THEN (effective#>>'{}')::bigint END,CASE WHEN field.logical_type IN ('decimal','duration') THEN (effective#>>'{}')::numeric END,CASE WHEN field.logical_type='boolean' THEN (effective#>>'{}')::boolean END,CASE WHEN field.logical_type='date' THEN (effective#>>'{}')::date END,CASE WHEN field.logical_type='timestamp' THEN (effective#>>'{}')::timestamptz END,CASE WHEN field.logical_type='category' THEN (effective#>>'{}')::uuid END,CASE WHEN field.logical_type='reference' THEN (effective#>>'{}')::uuid END); END IF;
   END IF;
  END LOOP;
  PERFORM internal.sync_dataset_value_system_flags(dataset.id,v_row_id,dataset.schema_version_id,item->'values');
  IF item ? 'entered' THEN PERFORM internal.log_dataset_quantity_entries(dataset,v_row_id,item->'values',item->'entered'); END IF;
    IF audit_changes<>'{}'::jsonb THEN audit_sources:=audit_sources||internal.emit_dataset_row_audit(dataset,v_row_id,audit_changes,nullif(btrim(item->>'reason'),'')); END IF;
  
 END LOOP;
 PERFORM internal.reconcile_dataset_high_cv(dataset.id,dataset.schema_version_id);
 UPDATE api.datasets SET revision=revision+1,updated_at=now() WHERE id=dataset.id RETURNING revision INTO dataset.revision; result:=jsonb_build_object('ok',true,'datasetId',dataset.id,'datasetRevision',dataset.revision,'rows',result_rows,'sourceEvents',audit_sources,'idempotent',false); PERFORM internal.emit_dataset_analysis_staleness(dataset,p_expected_dataset_revision,audit_sources); INSERT INTO api.dataset_bulk_commits(workspace_id,dataset_id,actor_user_id,actor_credential_id,idempotency_key,request_digest,result) VALUES(dataset.workspace_id,dataset.id,actor_user,actor_credential,p_idempotency_key,digest,result); RETURN result;
END $function$;
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
    IF internal.lab_quantity_entry(item,internal.lab_storage_unit(p_field.logical_type,p_field.quantity))->>'error'='wrong_unit' THEN RETURN 'wrong_unit'; END IF;
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

CREATE OR REPLACE FUNCTION api.mutate_sheet_instance_local_state(p_instance_id uuid, p_expected_revision bigint, p_retry_token uuid, p_field_changes jsonb, p_rows jsonb, p_cells jsonb)
 RETURNS api.sheet_instances
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
DECLARE instance api.sheet_instances; existing_mutation api.sheet_instance_local_mutations;
  actor_user text:=api.current_user_id(); actor_credential uuid:=api.current_credential_id(); digest text; change jsonb; row_item jsonb; cell jsonb;
  state jsonb; fields jsonb; old_field jsonb; new_field jsonb; field_id text; row_key text;
  value jsonb; quantity jsonb; effective jsonb; error_code text; seen_fields text[]:='{}'; seen_rows text[]:='{}';
  seen_cells text[]:='{}'; composition jsonb; result_row jsonb; affected jsonb;
  identity_kind text;
BEGIN
 IF p_instance_id IS NOT NULL THEN PERFORM internal.assert_object_access('instance',p_instance_id,'edit'); END IF;
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
  IF instance.id IS NULL OR NOT api.has_write_actor() OR NOT api.is_workspace_writer(instance.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  IF p_retry_token IS NULL THEN RAISE EXCEPTION 'retry token is required' USING ERRCODE='22023'; END IF;
  digest:=encode(sha256(convert_to(jsonb_build_object('instanceId',p_instance_id,'expectedRevision',p_expected_revision,'fieldChanges',p_field_changes,'rows',p_rows,'cells',p_cells)::text,'UTF8')),'hex');
  SELECT * INTO existing_mutation FROM api.sheet_instance_local_mutations WHERE instance_id=p_instance_id AND retry_token=p_retry_token;
  IF existing_mutation.id IS NOT NULL THEN
    IF existing_mutation.request_digest<>digest OR existing_mutation.actor_user_id IS DISTINCT FROM actor_user OR existing_mutation.actor_credential_id IS DISTINCT FROM actor_credential THEN RAISE EXCEPTION 'retry token was used for a different local mutation' USING ERRCODE='23505'; END IF;
    RETURN jsonb_populate_record(NULL::api.sheet_instances,existing_mutation.result);
  END IF;
  IF instance.lifecycle<>'active' OR instance.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
  IF jsonb_typeof(p_field_changes)<>'array' OR jsonb_array_length(p_field_changes)>32 OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>200 OR jsonb_typeof(p_cells)<>'array' OR jsonb_array_length(p_cells)>1000 OR jsonb_array_length(p_field_changes)+jsonb_array_length(p_cells)=0 THEN RAISE EXCEPTION 'local mutation requires a non-empty bounded batch' USING ERRCODE='22023'; END IF;
  state:=instance.state; fields:=state->'localFields';
  identity_kind:=instance.state->'resolvedRowIdentity'->>'kind';
  FOR change IN SELECT item FROM jsonb_array_elements(p_field_changes) item LOOP
    IF jsonb_typeof(change)<>'object' OR change->>'operation' NOT IN ('add','edit','retire') OR change-(CASE WHEN change->>'operation'='retire' THEN ARRAY['operation','fieldId'] ELSE ARRAY['operation','field'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid local field change' USING ERRCODE='22023'; END IF;
    new_field:=change->'field'; field_id:=coalesce(new_field->>'fieldId',change->>'fieldId'); PERFORM internal.sheet_definition_uuid(field_id,'local field change');
    IF field_id=ANY(seen_fields) THEN RAISE EXCEPTION 'duplicate local field change' USING ERRCODE='22023'; END IF; seen_fields:=array_append(seen_fields,field_id);
    SELECT item INTO old_field FROM jsonb_array_elements(fields) item WHERE item->>'fieldId'=field_id;
    IF change->>'operation'='add' THEN
      PERFORM internal.validate_sheet_field_definition(new_field,'local field add');
      IF new_field->'defaultValue'<>'null'::jsonb AND internal.sheet_local_cell_error(instance.workspace_id,new_field,new_field->'defaultValue') IS NOT NULL THEN RAISE EXCEPTION 'invalid local field default' USING ERRCODE='SB073'; END IF;
      IF old_field IS NOT NULL OR new_field->>'lifecycle'<>'active' OR new_field->'computation'->>'mode'<>'stored' THEN RAISE EXCEPTION 'local field add requires a new active stored field' USING ERRCODE='SB073'; END IF;
      fields:=fields||jsonb_build_array(new_field);
    ELSIF old_field IS NULL OR old_field->>'lifecycle'<>'active' THEN RAISE EXCEPTION 'unknown or retired local field' USING ERRCODE='SB073';
    ELSIF change->>'operation'='retire' THEN
      fields:=(SELECT jsonb_agg(CASE WHEN item->>'fieldId'=field_id THEN jsonb_set(item,'{lifecycle}','"retired"') ELSE item END ORDER BY ordinality) FROM jsonb_array_elements(fields) WITH ORDINALITY AS entries(item,ordinality));
    ELSE
      PERFORM internal.validate_sheet_field_definition(new_field,'local field edit');
      IF new_field->'defaultValue'<>'null'::jsonb AND internal.sheet_local_cell_error(instance.workspace_id,new_field,new_field->'defaultValue') IS NOT NULL THEN RAISE EXCEPTION 'invalid local field default' USING ERRCODE='SB073'; END IF;
      IF new_field->>'fieldId'<>field_id OR new_field->>'lifecycle'<>'active' OR new_field->'computation'->>'mode'<>'stored' THEN RAISE EXCEPTION 'local field edit must preserve active stored identity' USING ERRCODE='SB073'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_each(state->'localValues') r WHERE r.value ? field_id) AND
         (old_field->'key' IS DISTINCT FROM new_field->'key' OR old_field->'logicalType' IS DISTINCT FROM new_field->'logicalType' OR old_field->'cardinality' IS DISTINCT FROM new_field->'cardinality' OR old_field->'quantity' IS DISTINCT FROM new_field->'quantity' OR old_field->'category' IS DISTINCT FROM new_field->'category' OR old_field->'relationship' IS DISTINCT FROM new_field->'relationship' OR old_field->'computation' IS DISTINCT FROM new_field->'computation') THEN RAISE EXCEPTION 'populated local field semantic identity is immutable' USING ERRCODE='SB073'; END IF;
      FOR value IN SELECT r.value->field_id FROM jsonb_each(state->'localValues') r WHERE r.value ? field_id LOOP IF internal.sheet_local_cell_error(instance.workspace_id,new_field,value) IS NOT NULL THEN RAISE EXCEPTION 'field edit is incompatible with existing local values' USING ERRCODE='SB073'; END IF; END LOOP;
      fields:=(SELECT jsonb_agg(CASE WHEN item->>'fieldId'=field_id THEN new_field ELSE item END ORDER BY ordinality) FROM jsonb_array_elements(fields) WITH ORDINALITY AS entries(item,ordinality));
    END IF;
  END LOOP;
  state:=jsonb_set(state,'{localFields}',fields);
  FOR row_item IN SELECT item FROM jsonb_array_elements(p_rows) item LOOP
    IF jsonb_typeof(row_item)<>'object' OR row_item->>'kind' NOT IN ('composed','local') THEN RAISE EXCEPTION 'invalid local row address' USING ERRCODE='22023'; END IF;
    row_key:=row_item->>'rowKey'; IF row_key=ANY(seen_rows) THEN RAISE EXCEPTION 'duplicate local row address' USING ERRCODE='22023'; END IF; seen_rows:=array_append(seen_rows,row_key);
    IF row_item->>'kind'='local' THEN
      IF row_item-ARRAY['kind','rowKey']<>'{}'::jsonb
         OR (identity_kind IS NOT NULL AND identity_kind<>'local')
         OR row_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN RAISE EXCEPTION 'unknown local UUID row identity' USING ERRCODE='SB073'; END IF;
    ELSE
      IF row_item-ARRAY['kind','rowKey','identityValues','compositionOffset']<>'{}'::jsonb OR instance.state->'resolvedRowIdentity'->>'kind' NOT IN ('source','composite') OR jsonb_typeof(row_item->'identityValues')<>'array' OR jsonb_array_length(row_item->'identityValues')<>jsonb_array_length(instance.state->'resolvedRowIdentity'->'columnIds') OR jsonb_typeof(row_item->'compositionOffset')<>'number' OR (row_item->>'compositionOffset')::numeric<>trunc((row_item->>'compositionOffset')::numeric) OR (row_item->>'compositionOffset')::integer NOT BETWEEN 0 AND 10000 OR row_key<>internal.sheet_row_identity_key(instance.state->'resolvedRowIdentity',row_item->'identityValues') THEN RAISE EXCEPTION 'composed row identity mismatch' USING ERRCODE='SB073'; END IF;
      composition:=api.query_sheet_instance_rows_core036(instance.id,200,(row_item->>'compositionOffset')::integer);
      SELECT item INTO result_row FROM jsonb_array_elements(composition->'rows') item WHERE item->'identityValues'=row_item->'identityValues' LIMIT 1;
      IF (composition->>'revision')::bigint<>instance.revision OR result_row IS NULL THEN RAISE EXCEPTION 'composed row is absent from current controlled composition page' USING ERRCODE='SB073'; END IF;
    END IF;
  END LOOP;
  FOR cell IN SELECT item FROM jsonb_array_elements(p_cells) item LOOP
    IF jsonb_typeof(cell)<>'object' OR cell-ARRAY['rowKey','fieldId','value']<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid local cell mutation' USING ERRCODE='22023'; END IF;
    row_key:=cell->>'rowKey'; field_id:=cell->>'fieldId';
    IF NOT row_key=ANY(seen_rows) THEN RAISE EXCEPTION 'cell references an unverified row' USING ERRCODE='SB073'; END IF;
    IF row_key||':'||field_id=ANY(seen_cells) THEN RAISE EXCEPTION 'duplicate local cell address' USING ERRCODE='22023'; END IF; seen_cells:=array_append(seen_cells,row_key||':'||field_id);
    SELECT item INTO new_field FROM jsonb_array_elements(fields) item WHERE item->>'fieldId'=field_id AND item->>'lifecycle'='active';
    IF new_field IS NULL AND instance.source_definition_version_id IS NOT NULL THEN
      -- A declared column of the pinned Definition holds typed-in cells too.
      SELECT c.value->'field' INTO new_field
        FROM api.sheet_definition_versions v
        CROSS JOIN LATERAL jsonb_array_elements(v.configuration->'columns') c(value)
       WHERE v.id=instance.source_definition_version_id
         AND (c.value->>'id'=field_id OR c.value->'field'->>'fieldId'=field_id)
         AND c.value->'source'->>'kind'='declared'
         AND c.value->'field'->>'lifecycle'='active'
         AND c.value->'field'->'computation'->>'mode'='stored';
    END IF;
    IF new_field IS NULL THEN RAISE EXCEPTION 'unknown or retired local field' USING ERRCODE='SB073'; END IF;
    quantity:=internal.lab_quantities_in_unit(cell->'value',internal.lab_storage_unit(new_field->>'logicalType',new_field->'quantity'));
    IF quantity->>'error'='wrong_unit' THEN RAISE EXCEPTION 'invalid local cell: wrong_unit' USING ERRCODE='22023'; END IF;
    value:=quantity->'value';
    IF quantity ? 'entered' THEN PERFORM internal.log_quantity_entries(instance.workspace_id,'instance',instance.id,row_key,field_id,quantity->'entered',value,internal.lab_storage_unit(new_field->>'logicalType',new_field->'quantity')); END IF;
    error_code:=internal.sheet_local_cell_error(instance.workspace_id,new_field,value); IF error_code IS NOT NULL THEN RAISE EXCEPTION 'invalid local cell: %',error_code USING ERRCODE='22023'; END IF;
    effective:=CASE WHEN value='null'::jsonb AND NOT (new_field->>'nullable')::boolean THEN new_field->'defaultValue' ELSE value END;
    IF NOT state->'localValues' ? row_key THEN state:=jsonb_set(state,ARRAY['localValues',row_key],'{}'::jsonb,true); END IF;
    state:=jsonb_set(state,ARRAY['localValues',row_key,field_id],effective,true);
  END LOOP;
  IF state=instance.state THEN RAISE EXCEPTION 'local mutation must change Instance state' USING ERRCODE='22023'; END IF;
  PERFORM internal.validate_sheet_instance_state(state); PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
  UPDATE api.sheet_instances SET state=state,revision=revision+1,updated_at=now(),updated_by_user_id=actor_user,updated_by_credential_id=actor_credential WHERE id=instance.id RETURNING * INTO instance;
  affected:=jsonb_build_object(
    'rowKeys',(SELECT coalesce(jsonb_agg(row_key ORDER BY row_key),'[]'::jsonb) FROM (SELECT DISTINCT item->>'rowKey' row_key FROM jsonb_array_elements(p_cells) item) affected_rows),
    'fieldIds',(SELECT coalesce(jsonb_agg(field_id ORDER BY field_id),'[]'::jsonb) FROM (SELECT DISTINCT unnest(seen_fields||ARRAY(SELECT item->>'fieldId' FROM jsonb_array_elements(p_cells) item)) field_id) affected_fields),
    'cells',to_jsonb(seen_cells)
  );
  INSERT INTO api.sheet_instance_local_mutations(workspace_id,instance_id,retry_token,request_digest,result_revision,result,actor_user_id,actor_credential_id,operation,affected) VALUES(instance.workspace_id,instance.id,p_retry_token,digest,instance.revision,to_jsonb(instance),actor_user,actor_credential,'local_mutation',affected);
  RETURN instance;
END $function$;
--> statement-breakpoint

--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('convert_quantity', '{"operation":"convert_quantity","rpc":"convert_quantity","label":"Convert a value to another unit","description":"Returns `{ value, unit, from: { value, unit }, dimension }`: the value in `p_to_unit`, rounded to 12 significant figures, as the database stores a value typed in another unit. Converts only between units of the same kind (mass, volume, concentration, time, temperature, pressure …) from the built-in unit table (`lab_units`); a \"×10⁶\" in front of a unit scales it. Refuses units of different kinds. Changes nothing.","arguments":[{"name":"p_value","type":"numeric","required":true,"nullable":false},{"name":"p_from_unit","type":"text","required":true,"nullable":false},{"name":"p_to_unit","type":"text","required":true,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
