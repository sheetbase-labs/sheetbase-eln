-- Models, sheets and templates reach webhooks, the live feed, pipeline triggers
-- and steward SQL.
--
-- Field choices, sheet definition versions and template versions already write
-- to the change feed; what was missing is a name for them on webhooks. Rules on
-- a record type and rules for how two types link did not write to the feed at
-- all; triggers on their tables now do, so the change is seen however it was
-- made: from settings, the API, MCP, the assistant or a pipeline.

-- New kinds of thing on the change feed.
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
  FOREACH v_name IN ARRAY ARRAY['model_rule', 'model_relationship_rule'] LOOP
    IF position(('''' || v_name || '''::text') IN v_def) = 0 THEN
      v_def := replace(v_def, '::text]', '::text, ''' || v_name || '''::text]');
    END IF;
  END LOOP;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('model.field.option.created'), ('model.field.option.updated'),
  ('model.rule.created'), ('model.rule.updated'), ('model.rule.removed'),
  ('model.link_rule.set'), ('model.link_rule.removed'),
  ('model.version.discarded'),
  ('sheet.definition.version.published'), ('sheet.definition.version.retired'),
  ('notebook.template.version.published'), ('notebook.template.version.retired')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- A rule on a record type is added, changed or removed.
CREATE FUNCTION internal.trg_change_event_model_rules() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.model_rules := CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  v_payload jsonb := jsonb_build_object('modelKey', v_row.model_key, 'name', v_row.name,
    'effect', v_row.effect, 'fieldKeys', to_jsonb(v_row.field_keys));
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_payload := v_payload || jsonb_build_object('changes',
      internal.changed_columns(to_jsonb(OLD), to_jsonb(NEW)));
  END IF;
  PERFORM internal.emit_change_event(v_row.workspace_id, 'model_rule', v_row.id,
    CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'DELETE' THEN 'delete' ELSE 'update' END,
    NULL, NULL, v_payload);
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_model_rules() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.trg_change_event_model_rules() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER change_event_model_rules
  AFTER INSERT OR UPDATE OR DELETE ON api.model_rules
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_model_rules();
--> statement-breakpoint

-- A rule for how two record types link is set (added or changed) or removed.
-- Setting one is an upsert, so adding and changing are the same event.
CREATE FUNCTION internal.trg_change_event_model_relationship_rules() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.model_relationship_rules := CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  PERFORM internal.emit_change_event(v_row.workspace_id, 'model_relationship_rule', v_row.id,
    CASE TG_OP WHEN 'DELETE' THEN 'delete' ELSE 'update' END,
    NULL, NULL,
    jsonb_build_object('sourceModelKey', v_row.source_model_key, 'linkType', v_row.link_type,
      'targetModelKey', v_row.target_model_key, 'minLinks', v_row.min_links,
      'maxLinks', v_row.max_links, 'label', v_row.label));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_model_relationship_rules() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.trg_change_event_model_relationship_rules() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER change_event_model_relationship_rules
  AFTER INSERT OR UPDATE OR DELETE ON api.model_relationship_rules
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_model_relationship_rules();
--> statement-breakpoint

-- Steward SQL: the workspace's record types, sheet definitions, sheets and
-- templates, beside the one view per record type that already exists.
SELECT internal.register_reporting_view('record_types', 'record_types', 'Record types',
  'Each record type (model): its key, name, identifier prefix, parent type and whether it is a registry.',
  'record_models',
  ARRAY['id','key','name','description','identifier_prefix','lifecycle','current_version','parent_key','is_registry','registry_key_fields','registry_sequence_field','registry_lot_kind','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('record_type_fields', 'record_type_fields', 'Record type fields',
  'Each field of each record type: its type, unit, checks and whether it is a draft, in use or retired.',
  'record_field_definitions',
  ARRAY['id','kind','field_name','label','description','section','display_order','logical_type','nullable','default_value','unit','validation','quantity','cardinality','category_source','relationship','show_in_list','ask_on_create','lifecycle','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('record_type_rules', 'record_type_rules', 'Record type rules',
  'The checks on records of each type, and whether each warns or blocks.',
  'model_rules',
  ARRAY['id','model_key','name','field_keys','condition','effect','message','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('record_type_links', 'record_type_links', 'Record type links',
  'How many links of a kind records of one type must or may have to another.',
  'model_relationship_rules',
  ARRAY['id','source_model_key','link_type','target_model_key','min_links','max_links','label','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('record_type_versions', 'record_type_versions', 'Record type versions',
  'Each version of each record type, draft or published, with what it holds.',
  'record_model_versions',
  ARRAY['id','model_id','version','lifecycle','definition','reason','published_at','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('sheet_definitions', 'sheet_definitions', 'Sheet definitions',
  'Reusable sheet layouts and whether each is offered or retired.',
  'sheet_definitions',
  ARRAY['id','key','name','description','lifecycle','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('sheets', 'sheets', 'Sheets',
  'Each sheet: its project and notebook, the definition version it was made from, and whether it is archived.',
  'sheet_instances',
  ARRAY['id','display_id','name','description','project_id','notebook_record_id','source_definition_version_id','lifecycle','duplicated_from_instance_id','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('notebook_templates', 'notebook_templates', 'Notebook templates',
  'Notebook templates and whether each is offered.',
  'notebook_templates',
  ARRAY['id','display_id','key','name','description','lifecycle','created_by_user_id','created_at','updated_at']);
