-- Changes to record types (models) and their fields now reach webhooks, the
-- live feed and pipeline triggers: a type added or changed, a field added,
-- changed or retired, and a version of a type started or published.
--
-- The version events were already written to the change feed; the type and
-- field ones come from triggers on the tables, so every way of changing a type
-- (the settings page, the API, the assistant, a plugin) is covered.

DO $$
DECLARE
  v_def text;
  v_name text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  FOREACH v_name IN ARRAY ARRAY['record_model', 'record_field_definition', 'record_model_version'] LOOP
    IF position(('''' || v_name || '''::text') IN v_def) = 0 THEN
      v_def := replace(v_def, '::text]', '::text, ''' || v_name || '''::text]');
    END IF;
  END LOOP;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

-- What changed on a row, as { column: { from, to } }, leaving out the columns
-- that change on every save.
CREATE FUNCTION internal.changed_columns(p_old jsonb, p_new jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', p_old->n.key, 'to', n.value)), '{}'::jsonb)
    FROM jsonb_each(p_new) n
   WHERE n.key NOT IN ('updated_at', 'updated_by_user_id')
     AND p_old->n.key IS DISTINCT FROM n.value
$$;
--> statement-breakpoint
ALTER FUNCTION internal.changed_columns(jsonb, jsonb) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.emit_record_model_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_changes jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM internal.emit_change_event(NEW.workspace_id, 'record_model', NEW.id, 'create', NULL, NULL,
      jsonb_build_object('key', NEW.key, 'name', NEW.name,
                         'identifierPrefix', NEW.identifier_prefix, 'lifecycle', NEW.lifecycle));
  ELSE
    v_changes := internal.changed_columns(to_jsonb(OLD), to_jsonb(NEW));
    IF v_changes <> '{}'::jsonb THEN
      PERFORM internal.emit_change_event(NEW.workspace_id, 'record_model', NEW.id, 'update', NULL, NULL,
        jsonb_build_object('key', NEW.key, 'name', NEW.name, 'lifecycle', NEW.lifecycle, 'changes', v_changes));
    END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.emit_record_model_change() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.emit_record_model_change() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER z_emit_record_model_change AFTER INSERT OR UPDATE ON api.record_models
  FOR EACH ROW EXECUTE FUNCTION internal.emit_record_model_change();
--> statement-breakpoint

CREATE FUNCTION internal.emit_record_field_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_changes jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM internal.emit_change_event(NEW.workspace_id, 'record_field_definition', NEW.id, 'create', NULL, NULL,
      jsonb_build_object('change', 'definition', 'kind', NEW.kind, 'fieldName', NEW.field_name,
                         'label', NEW.label, 'logicalType', NEW.logical_type, 'lifecycle', NEW.lifecycle));
  ELSE
    v_changes := internal.changed_columns(to_jsonb(OLD), to_jsonb(NEW));
    IF v_changes <> '{}'::jsonb THEN
      PERFORM internal.emit_change_event(NEW.workspace_id, 'record_field_definition', NEW.id, 'update', NULL, NULL,
        jsonb_build_object('change', 'definition', 'kind', NEW.kind, 'fieldName', NEW.field_name,
                           'label', NEW.label, 'logicalType', NEW.logical_type, 'lifecycle', NEW.lifecycle,
                           'changes', v_changes));
    END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.emit_record_field_change() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.emit_record_field_change() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER z_emit_record_field_change AFTER INSERT OR UPDATE ON api.record_field_definitions
  FOR EACH ROW EXECUTE FUNCTION internal.emit_record_field_change();
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('model.created'), ('model.updated'), ('model.field.created'),
  ('model.field.updated'), ('model.version.created'), ('model.version.published');
--> statement-breakpoint

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  IF position('''watcher.finding.created''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_def := replace(v_def, '''watcher.finding.created''',
    '''watcher.finding.created'', ''model.created'', ''model.updated'', ''model.field.created'', ''model.field.updated'', ''model.version.created'', ''model.version.published''');
  EXECUTE v_def;
END $$;
