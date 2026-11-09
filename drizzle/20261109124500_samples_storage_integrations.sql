-- Samples and storage reach the API, MCP, assistant, webhooks, pipelines and SQL.
--
--   * api.create_storage_location / update_storage_location /
--     set_storage_location_archived: author the freezer tree (site, room, unit,
--     shelf, rack, box) through functions instead of table writes, so tokens,
--     MCP, the assistant and pipelines can do what the Storage settings page
--     does. Row security still decides who may: it needs Storage and labels.
--   * Sample reservations write to the change feed, so a reservation made or
--     cancelled is a webhook event and can start a pipeline.
--   * The new webhook event names, and the sample and storage events pipelines
--     may be started by.
--   * Steward SQL: data.sample_history, data.sample_reservations,
--     data.storage_positions and data.storage_movements, read-only, one login's
--     own workspace.

-- ---------------------------------------------------------------------------
-- Storage locations
-- ---------------------------------------------------------------------------
CREATE FUNCTION api.create_storage_location(
  p_workspace_id uuid,
  p_level text,
  p_parent_id uuid,
  p_name text,
  p_code text DEFAULT NULL,
  p_unit_type text DEFAULT NULL,
  p_temperature_min_c numeric DEFAULT NULL,
  p_temperature_max_c numeric DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
  v_id uuid;
  v_position integer;
BEGIN
  IF p_level NOT IN ('site', 'room', 'unit', 'shelf', 'rack') THEN
    RAISE EXCEPTION 'a location is a site, room, unit, shelf or rack (boxes are made with create_storage_box)'
      USING ERRCODE = '22023';
  END IF;
  IF p_level <> 'site' AND p_parent_id IS NULL THEN
    RAISE EXCEPTION 'a % goes inside another location', p_level USING ERRCODE = '22023';
  END IF;
  IF p_level IN ('site', 'room', 'unit') AND v_code IS NULL THEN
    RAISE EXCEPTION 'a % needs a short code', p_level USING ERRCODE = '22023';
  END IF;

  IF p_level = 'site' THEN
    INSERT INTO api.storage_sites (workspace_id, name, code, temperature_min_c, temperature_max_c)
      VALUES (p_workspace_id, v_name, v_code, p_temperature_min_c, p_temperature_max_c)
      RETURNING id INTO v_id;
  ELSIF p_level = 'room' THEN
    INSERT INTO api.storage_rooms (workspace_id, site_id, name, code, temperature_min_c, temperature_max_c)
      VALUES (p_workspace_id, p_parent_id, v_name, v_code, p_temperature_min_c, p_temperature_max_c)
      RETURNING id INTO v_id;
  ELSIF p_level = 'unit' THEN
    INSERT INTO api.storage_units (workspace_id, room_id, name, code, unit_type, temperature_min_c, temperature_max_c)
      VALUES (p_workspace_id, p_parent_id, v_name, v_code, coalesce(p_unit_type, 'freezer'),
              p_temperature_min_c, p_temperature_max_c)
      RETURNING id INTO v_id;
  ELSIF p_level = 'shelf' THEN
    SELECT coalesce(max(position), 0) + 1 INTO v_position FROM api.storage_shelves WHERE unit_id = p_parent_id;
    INSERT INTO api.storage_shelves (workspace_id, unit_id, name, position)
      VALUES (p_workspace_id, p_parent_id, v_name, v_position)
      RETURNING id INTO v_id;
  ELSE
    SELECT coalesce(max(position), 0) + 1 INTO v_position FROM api.storage_racks WHERE shelf_id = p_parent_id;
    INSERT INTO api.storage_racks (workspace_id, shelf_id, name, position)
      VALUES (p_workspace_id, p_parent_id, v_name, v_position)
      RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('id', v_id, 'level', p_level, 'name', v_name, 'code', v_code);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.create_storage_location(uuid, text, uuid, text, text, text, numeric, numeric) OWNER TO migrator;
--> statement-breakpoint

-- Changes the name, code, type or temperature limits of a location. Anything
-- left out stays as it was.
CREATE FUNCTION api.update_storage_location(
  p_level text,
  p_id uuid,
  p_name text DEFAULT NULL,
  p_code text DEFAULT NULL,
  p_unit_type text DEFAULT NULL,
  p_temperature_min_c numeric DEFAULT NULL,
  p_temperature_max_c numeric DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
  v_count integer;
BEGIN
  IF p_level = 'site' THEN
    UPDATE api.storage_sites SET name = coalesce(v_name, name), code = coalesce(v_code, code),
           temperature_min_c = coalesce(p_temperature_min_c, temperature_min_c),
           temperature_max_c = coalesce(p_temperature_max_c, temperature_max_c), updated_at = now()
     WHERE id = p_id;
  ELSIF p_level = 'room' THEN
    UPDATE api.storage_rooms SET name = coalesce(v_name, name), code = coalesce(v_code, code),
           temperature_min_c = coalesce(p_temperature_min_c, temperature_min_c),
           temperature_max_c = coalesce(p_temperature_max_c, temperature_max_c), updated_at = now()
     WHERE id = p_id;
  ELSIF p_level = 'unit' THEN
    UPDATE api.storage_units SET name = coalesce(v_name, name), code = coalesce(v_code, code),
           unit_type = coalesce(p_unit_type, unit_type),
           temperature_min_c = coalesce(p_temperature_min_c, temperature_min_c),
           temperature_max_c = coalesce(p_temperature_max_c, temperature_max_c), updated_at = now()
     WHERE id = p_id;
  ELSIF p_level = 'shelf' THEN
    UPDATE api.storage_shelves SET name = coalesce(v_name, name), updated_at = now() WHERE id = p_id;
  ELSIF p_level = 'rack' THEN
    UPDATE api.storage_racks SET name = coalesce(v_name, name), updated_at = now() WHERE id = p_id;
  ELSIF p_level = 'box' THEN
    UPDATE api.storage_boxes SET name = coalesce(v_name, name), code = coalesce(v_code, code), updated_at = now()
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'a location is a site, room, unit, shelf, rack or box' USING ERRCODE = '22023';
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'location not found, or you cannot change it' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('id', p_id, 'level', p_level);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.update_storage_location(text, uuid, text, text, text, numeric, numeric) OWNER TO migrator;
--> statement-breakpoint

-- Takes a location out of use, or brings it back. A location that holds a
-- sample cannot be archived (the existing storage guard says so).
CREATE FUNCTION api.set_storage_location_archived(p_level text, p_id uuid, p_archived boolean) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_at timestamptz := CASE WHEN p_archived THEN now() ELSE NULL END;
  v_count integer;
BEGIN
  IF p_level = 'site' THEN UPDATE api.storage_sites SET archived_at = v_at WHERE id = p_id;
  ELSIF p_level = 'room' THEN UPDATE api.storage_rooms SET archived_at = v_at WHERE id = p_id;
  ELSIF p_level = 'unit' THEN UPDATE api.storage_units SET archived_at = v_at WHERE id = p_id;
  ELSIF p_level = 'shelf' THEN UPDATE api.storage_shelves SET archived_at = v_at WHERE id = p_id;
  ELSIF p_level = 'rack' THEN UPDATE api.storage_racks SET archived_at = v_at WHERE id = p_id;
  ELSIF p_level = 'box' THEN UPDATE api.storage_boxes SET archived_at = v_at WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'a location is a site, room, unit, shelf, rack or box' USING ERRCODE = '22023';
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'location not found, or you cannot change it' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('id', p_id, 'level', p_level, 'archived', p_archived);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.set_storage_location_archived(text, uuid, boolean) OWNER TO migrator;
--> statement-breakpoint

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'api.create_storage_location(uuid, text, uuid, text, text, text, numeric, numeric)',
    'api.update_storage_location(text, uuid, text, text, text, numeric, numeric)',
    'api.set_storage_location_archived(text, uuid, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Sample reservations join the change feed
-- ---------------------------------------------------------------------------
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
  IF position('''sample_reservation''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''sample_reservation''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

CREATE FUNCTION internal.trg_change_event_sample_reservations() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.emit_change_event(
    NEW.workspace_id,
    'sample_reservation',
    NEW.id,
    CASE TG_OP WHEN 'INSERT' THEN 'create' ELSE 'update' END,
    NEW.sample_record_id,
    NULL,
    jsonb_build_object(
      'reservationId', NEW.id,
      'sampleRecordId', NEW.sample_record_id,
      'experimentRecordId', NEW.experiment_record_id,
      'quantity', NEW.quantity,
      'unit', NEW.unit,
      'planned', NEW.planned,
      'state', NEW.state
    )
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_sample_reservations() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_sample_reservations
  AFTER INSERT OR UPDATE ON api.sample_reservations
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_sample_reservations();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Webhook event names, and the events a pipeline may be started by
-- ---------------------------------------------------------------------------
INSERT INTO internal.webhook_event_names (name) VALUES
  ('sample.edited'), ('sample.archived'), ('sample.restored'), ('sample.label_printed'),
  ('storage.position.quarantined'), ('storage.position.missing'),
  ('sample.reserved'), ('sample.reservation_cancelled'),
  ('storage.site.created'), ('storage.room.created'), ('storage.unit.created'),
  ('storage.shelf.created'), ('storage.rack.created'), ('storage.box.created')
ON CONFLICT DO NOTHING;
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
    '''sample.received'', ''sample.moved'', ''sample.consumed'', ''sample.quarantined'', ''sample.released'', ''sample.disposed'', ''sample.hold_exceeded'', ''sample.edited'', ''sample.archived'', ''sample.restored'', ''sample.label_printed'', ''sample.reserved'', ''sample.reservation_cancelled'', ''storage.placed'', ''storage.moved'', ''storage.removed'', ''storage.position.quarantined'', ''storage.position.missing'', ''storage.site.created'', ''storage.room.created'', ''storage.unit.created'', ''storage.shelf.created'', ''storage.rack.created'', ''storage.box.created'', ''watcher.finding.created''');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- Steward SQL: sample history, reservations and the storage tree, through the
-- shared reporting view registry.
SELECT internal.register_reporting_view('sample_history', 'sample_history', 'Sample history',
  'Every receive, use, move, release, quarantine and disposal of a sample.',
  'sample_events',
  ARRAY['id','record_id','operation','quantity_delta','quantity_before','quantity_after','quantity_unit','from_location','to_location','purpose_record_id','actor_user_id','notes','created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('sample_reservations', 'sample_reservations', 'Sample reservations',
  'Volume of a sample held for an experiment, and whether it is still active.',
  'sample_reservations',
  ARRAY['id','sample_record_id','experiment_record_id','quantity','unit','planned','state','notes','created_by_user_id','cancelled_by_user_id','cancelled_at','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('storage_movements', 'storage_movements', 'Storage movements',
  'Every time a sample was placed in, moved between or taken out of a storage position.',
  'storage_movements',
  ARRAY['id','record_id','operation','from_position_id','to_position_id','from_path','to_path','actor_user_id','notes','created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('storage_positions', 'storage_positions', 'Storage positions',
  'Every position in every box, with its status and the sample in it.',
  'storage_positions',
  ARRAY['id','box_id','row_index','col_index','label','status','occupied_record_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('storage_boxes', 'storage_boxes', 'Storage boxes',
  'Boxes in the storage tree.',
  'storage_boxes',
  ARRAY['id','rack_id','name','code','rows','cols','capacity','created_at','updated_at','archived_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('storage_racks', 'storage_racks', 'Storage racks',
  'Racks on each shelf.',
  'storage_racks',
  ARRAY['id','shelf_id','name','position','capacity','created_at','updated_at','archived_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('storage_shelves', 'storage_shelves', 'Storage shelves',
  'Shelves in each freezer or unit.',
  'storage_shelves',
  ARRAY['id','unit_id','name','position','capacity','created_at','updated_at','archived_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('storage_units', 'storage_units', 'Storage units',
  'Freezers, fridges and cabinets.',
  'storage_units',
  ARRAY['id','room_id','name','code','unit_type','temperature_min_c','temperature_max_c','capacity','created_at','updated_at','archived_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('storage_rooms', 'storage_rooms', 'Storage rooms',
  'Rooms in each site.',
  'storage_rooms',
  ARRAY['id','site_id','name','code','temperature_min_c','temperature_max_c','capacity','created_at','updated_at','archived_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('storage_sites', 'storage_sites', 'Storage sites',
  'Sites that hold storage.',
  'storage_sites',
  ARRAY['id','name','code','description','temperature_min_c','temperature_max_c','capacity','created_at','updated_at','archived_at']);
--> statement-breakpoint
--> statement-breakpoint
-- The pipeline action check knows the sample and storage actions too.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"quarantine_sample","rpc":"quarantine_sample","label":"Quarantine a sample","description":"Holds a sample back from use while its quality is looked into.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_reason","type":"text","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"dispose_sample","rpc":"dispose_sample","label":"Dispose of a sample","description":"Records that a sample was thrown away, and why.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_reason","type":"text","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"withdraw_sample","rpc":"withdraw_sample","label":"Take a portion of a sample for an experiment","description":"Takes a quantity out of a sample for an experiment, and can make a new sample for the portion.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_quantity","type":"numeric","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_purpose_experiment_id","type":"uuid","required":true,"nullable":false},{"name":"p_unit","type":"text","required":false,"nullable":true},{"name":"p_notes","type":"text","required":false,"nullable":true},{"name":"p_new_container","type":"jsonb","required":false,"nullable":true}]},{"operation":"aliquot_sample","rpc":"aliquot_sample","label":"Split a sample into portions","description":"Makes several smaller samples from one and takes the total out of the source.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_count","type":"integer","required":true,"nullable":false},{"name":"p_quantity_each","type":"numeric","required":true,"nullable":false},{"name":"p_purpose_experiment_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_unit","type":"text","required":false,"nullable":true},{"name":"p_notes","type":"text","required":false,"nullable":true},{"name":"p_new_container","type":"jsonb","required":false,"nullable":true}]},{"operation":"pool_samples","rpc":"pool_samples","label":"Pool samples","description":"Combines samples into a new pooled sample for an experiment and records where each part came from.","arguments":[{"name":"p_sources","type":"jsonb","required":true,"nullable":false},{"name":"p_purpose_experiment_id","type":"uuid","required":true,"nullable":false},{"name":"p_unit","type":"text","required":false,"nullable":true},{"name":"p_notes","type":"text","required":false,"nullable":true},{"name":"p_new_container","type":"jsonb","required":false,"nullable":true}]},{"operation":"create_sample_reservation","rpc":"create_sample_reservation","label":"Hold part of a sample for an experiment","description":"Sets aside a quantity so nobody else uses it.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_experiment_id","type":"uuid","required":true,"nullable":false},{"name":"p_quantity","type":"numeric","required":true,"nullable":false},{"name":"p_unit","type":"text","required":false,"nullable":true},{"name":"p_planned","type":"boolean","required":false,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"cancel_sample_reservation","rpc":"cancel_sample_reservation","label":"Cancel a sample reservation","description":"Gives the held quantity back to the sample.","arguments":[{"name":"p_reservation_id","type":"uuid","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"record_sample_measurement","rpc":"record_sample_measurement","label":"Record a measurement on a sample","description":"Adds a measured value, such as a concentration, to a sample.","arguments":[{"name":"p_sample_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_value","type":"numeric","required":true,"nullable":false},{"name":"p_unit","type":"text","required":false,"nullable":true},{"name":"p_method","type":"text","required":false,"nullable":true},{"name":"p_measured_at","type":"text","required":false,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"move_sample_to_position","rpc":"move_sample_to_position","label":"Put a sample in a box position","description":"Places a sample in an empty box position, taking it out of the one it was in.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_to_position_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"remove_sample_from_position","rpc":"remove_sample_from_position","label":"Take a sample out of its box position","description":"Frees the box position the sample is in.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"set_position_status","rpc":"set_position_status","label":"Mark a box position available, quarantined or missing","description":"Changes the status of a box position that holds no sample.","arguments":[{"name":"p_position_id","type":"uuid","required":true,"nullable":false},{"name":"p_status","type":"text","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"create_storage_location","rpc":"create_storage_location","label":"Add a storage location","description":"Adds a site, room, freezer, shelf or rack to the storage tree.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_level","type":"text","required":true,"nullable":false},{"name":"p_parent_location_id","type":"uuid","required":false,"nullable":true},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_code","type":"text","required":false,"nullable":true},{"name":"p_unit_type","type":"text","required":false,"nullable":true},{"name":"p_temperature_min_c","type":"numeric","required":false,"nullable":true},{"name":"p_temperature_max_c","type":"numeric","required":false,"nullable":true}]}$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || ']$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
