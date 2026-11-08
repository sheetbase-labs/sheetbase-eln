-- A plugin field type's rules are enforced by the database, on every way a
-- record is written (forms, API, import, assistant, pipelines).
--
-- When a field has a plugin's type and that plugin is installed and on with its
-- field types point switched on, a value is checked against the type's own
-- lengths, anchored pattern and range, on top of the field's checks.
CREATE FUNCTION internal.check_plugin_field_type(
    p_workspace uuid, p_model text, p_field text, p_label text, p_logical text, p_value jsonb) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_type jsonb;
  v_text text := p_value #>> '{}';
  v_num numeric;
  v_title text;
BEGIN
  SELECT t INTO v_type
    FROM api.field_plugin_types l
    JOIN api.extensions e ON e.workspace_id = l.workspace_id AND e.key = l.plugin_key
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(e.manifest->'contributions'->'field-types', '[]'::jsonb)) t
   WHERE l.workspace_id = p_workspace AND l.kind = p_model AND l.field_name = p_field
     AND e.status = 'enabled' AND NOT ('field-types' = ANY (e.disabled_points))
     AND t->>'id' = l.type_id
   LIMIT 1;
  IF v_type IS NULL OR v_text IS NULL OR v_text = '' THEN RETURN; END IF;
  v_title := coalesce(v_type->>'title', 'this type');
  IF p_logical = 'text' THEN
    IF v_type ? 'minLength' AND length(v_text) < (v_type->>'minLength')::integer THEN
      RAISE EXCEPTION '%: use at least % characters.', p_label, v_type->>'minLength' USING ERRCODE = 'SB071';
    END IF;
    IF v_type ? 'maxLength' AND length(v_text) > (v_type->>'maxLength')::integer THEN
      RAISE EXCEPTION '%: use at most % characters.', p_label, v_type->>'maxLength' USING ERRCODE = 'SB071';
    END IF;
    IF v_type ? 'pattern' THEN
      BEGIN
        IF NOT (v_text ~ (v_type->>'pattern')) THEN
          RAISE EXCEPTION '%: %', p_label,
            coalesce(v_type->>'patternMessage', 'that does not look like ' || v_title || '.')
            USING ERRCODE = 'SB071';
        END IF;
      EXCEPTION WHEN invalid_regular_expression THEN
        NULL; -- a pattern the database cannot read is not applied here; the form still checks it
      END;
    END IF;
  ELSIF p_logical IN ('integer', 'decimal') THEN
    v_num := v_text::numeric;
    IF v_type ? 'min' AND v_num < (v_type->>'min')::numeric THEN
      RAISE EXCEPTION '%: use % or more.', p_label, v_type->>'min' USING ERRCODE = 'SB071';
    END IF;
    IF v_type ? 'max' AND v_num > (v_type->>'max')::numeric THEN
      RAISE EXCEPTION '%: use % or less.', p_label, v_type->>'max' USING ERRCODE = 'SB071';
    END IF;
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.check_plugin_field_type(uuid, text, text, text, text, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.check_plugin_field_type(uuid, text, text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint

-- The record validator, with the check above after the field's own range check.
CREATE OR REPLACE FUNCTION internal.validate_model_fields(p_workspace uuid, p_model text, p_new jsonb, p_old jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
      (d.logical_type='decimal' AND jsonb_typeof(v)<>'number') OR
      (d.logical_type='boolean' AND jsonb_typeof(v)<>'boolean') OR
      (d.logical_type IN ('date','timestamp','category','reference') AND jsonb_typeof(v)<>'string') THEN
      RAISE EXCEPTION 'invalid % value for %',d.logical_type,k USING ERRCODE='SB071'; END IF;
   IF d.logical_type='date' THEN BEGIN PERFORM (v#>>'{}')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid date' USING ERRCODE='SB071'; END; END IF;
   IF d.logical_type='timestamp' THEN BEGIN PERFORM (v#>>'{}')::timestamptz; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid timestamp' USING ERRCODE='SB071'; END; END IF;
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
END $_$;
--> statement-breakpoint
ALTER FUNCTION internal.validate_model_fields(p_workspace uuid, p_model text, p_new jsonb, p_old jsonb) OWNER TO migrator;
