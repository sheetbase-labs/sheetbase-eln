-- Record aliases and label templates reach webhooks, the live feed and
-- pipeline triggers. Neither wrote to the change feed; triggers on their
-- tables now do, so the change is seen however it was made.

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
  FOREACH v_name IN ARRAY ARRAY['record_alias', 'label_template'] LOOP
    IF position(('''' || v_name || '''::text') IN v_def) = 0 THEN
      v_def := replace(v_def, '::text]', '::text, ''' || v_name || '''::text]');
    END IF;
  END LOOP;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('record.alias.added'), ('record.alias.removed'),
  ('label.template.created'), ('label.template.updated')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- A record is given another name, or one is taken off.
CREATE FUNCTION internal.trg_change_event_record_aliases() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.record_aliases := CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  v_project uuid;
BEGIN
  SELECT r.project_id INTO v_project FROM api.records r WHERE r.id = v_row.record_id;
  PERFORM internal.emit_change_event(v_row.workspace_id, 'record_alias', v_row.id,
    CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'DELETE' THEN 'delete' ELSE 'update' END,
    v_row.record_id, v_project,
    jsonb_build_object('recordId', v_row.record_id, 'alias', v_row.alias));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_record_aliases() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.trg_change_event_record_aliases() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER change_event_record_aliases
  AFTER INSERT OR DELETE ON api.record_aliases
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_record_aliases();
--> statement-breakpoint

-- A label template is added, changed, archived or restored.
CREATE FUNCTION internal.trg_change_event_label_templates() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_payload jsonb := jsonb_build_object('name', NEW.name, 'recordKind', NEW.record_kind,
    'isDefault', NEW.is_default, 'archived', NEW.archived_at IS NOT NULL);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_payload := v_payload || jsonb_build_object('changes',
      internal.changed_columns(to_jsonb(OLD), to_jsonb(NEW)));
  END IF;
  PERFORM internal.emit_change_event(NEW.workspace_id, 'label_template', NEW.id,
    CASE TG_OP WHEN 'INSERT' THEN 'create' ELSE 'update' END,
    NULL, NULL, v_payload);
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_label_templates() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.trg_change_event_label_templates() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER change_event_label_templates
  AFTER INSERT OR UPDATE ON api.label_templates
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_label_templates();
