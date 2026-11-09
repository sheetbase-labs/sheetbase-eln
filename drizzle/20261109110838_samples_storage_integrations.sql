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
  ('sample.edited'), ('sample.archived'), ('sample.restored'),
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
    '''sample.received'', ''sample.moved'', ''sample.consumed'', ''sample.quarantined'', ''sample.released'', ''sample.disposed'', ''sample.hold_exceeded'', ''sample.edited'', ''sample.archived'', ''sample.restored'', ''sample.reserved'', ''sample.reservation_cancelled'', ''storage.placed'', ''storage.moved'', ''storage.removed'', ''storage.site.created'', ''storage.room.created'', ''storage.unit.created'', ''storage.shelf.created'', ''storage.rack.created'', ''storage.box.created'', ''watcher.finding.created''');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Steward SQL: sample history, reservations, storage positions and movements
-- ---------------------------------------------------------------------------
-- Read through definer functions owned by reporting_owner, like the model
-- views, so a SQL login needs nothing but SELECT on data. Row security still
-- applies: a login sees only what its member may see in its own workspace.
CREATE FUNCTION internal.ensure_operational_views() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
BEGIN
  IF NOT internal.reporting_ready() THEN RETURN; END IF;

  IF to_regprocedure('data._sample_history()') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION data._sample_history()
      RETURNS TABLE(event_id uuid, sample_id uuid, sample_identifier text, sample_title text,
                    operation text, quantity_delta numeric, quantity_before numeric,
                    quantity_after numeric, quantity_unit text, from_location text,
                    to_location text, purpose_id uuid, purpose_identifier text,
                    actor_user_id text, notes text, occurred_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
      AS $b$
        SELECT e.id, e.record_id, r.identifier, r.title, e.operation, e.quantity_delta,
               e.quantity_before, e.quantity_after, e.quantity_unit, e.from_location,
               e.to_location, e.purpose_record_id, p.identifier, e.actor_user_id, e.notes,
               e.created_at
          FROM api.sample_events e
          JOIN api.records r ON r.id = e.record_id
          LEFT JOIN api.records p ON p.id = e.purpose_record_id
         WHERE e.workspace_id = (api.claim_probe()->>'workspace_id')::uuid
      $b$ $f$;
    EXECUTE 'REVOKE ALL ON FUNCTION data._sample_history() FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION data._sample_history() TO reporting_reader';
    EXECUTE 'ALTER FUNCTION data._sample_history() OWNER TO reporting_owner';
  END IF;

  IF to_regprocedure('data._sample_reservations()') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION data._sample_reservations()
      RETURNS TABLE(reservation_id uuid, sample_id uuid, sample_identifier text,
                    experiment_id uuid, experiment_identifier text, quantity numeric,
                    unit text, planned boolean, state text, notes text,
                    created_by_user_id text, created_at timestamptz, cancelled_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
      AS $b$
        SELECT v.id, v.sample_record_id, s.identifier, v.experiment_record_id, x.identifier,
               v.quantity, v.unit, v.planned, v.state, v.notes, v.created_by_user_id,
               v.created_at, v.cancelled_at
          FROM api.sample_reservations v
          JOIN api.records s ON s.id = v.sample_record_id
          JOIN api.records x ON x.id = v.experiment_record_id
         WHERE v.workspace_id = (api.claim_probe()->>'workspace_id')::uuid
      $b$ $f$;
    EXECUTE 'REVOKE ALL ON FUNCTION data._sample_reservations() FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION data._sample_reservations() TO reporting_reader';
    EXECUTE 'ALTER FUNCTION data._sample_reservations() OWNER TO reporting_owner';
  END IF;

  IF to_regprocedure('data._storage_positions()') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION data._storage_positions()
      RETURNS TABLE(position_id uuid, path text, site text, room text, unit text, unit_type text,
                    shelf text, rack text, box text, box_code text, label text, status text,
                    sample_id uuid, sample_identifier text, sample_title text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
      AS $b$
        SELECT p.id,
               concat_ws(' / ', si.name, ro.name, un.name, sh.name, ra.name, bx.name, p.label),
               si.name, ro.name, un.name, un.unit_type, sh.name, ra.name, bx.name, bx.code,
               p.label, p.status, p.occupied_record_id, r.identifier, r.title
          FROM api.storage_positions p
          JOIN api.storage_boxes bx ON bx.id = p.box_id
          JOIN api.storage_racks ra ON ra.id = bx.rack_id
          JOIN api.storage_shelves sh ON sh.id = ra.shelf_id
          JOIN api.storage_units un ON un.id = sh.unit_id
          JOIN api.storage_rooms ro ON ro.id = un.room_id
          JOIN api.storage_sites si ON si.id = ro.site_id
          LEFT JOIN api.records r ON r.id = p.occupied_record_id
         WHERE p.workspace_id = (api.claim_probe()->>'workspace_id')::uuid
      $b$ $f$;
    EXECUTE 'REVOKE ALL ON FUNCTION data._storage_positions() FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION data._storage_positions() TO reporting_reader';
    EXECUTE 'ALTER FUNCTION data._storage_positions() OWNER TO reporting_owner';
  END IF;

  IF to_regprocedure('data._storage_movements()') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION data._storage_movements()
      RETURNS TABLE(movement_id uuid, sample_id uuid, sample_identifier text, operation text,
                    from_path text, to_path text, actor_user_id text, notes text,
                    occurred_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
      AS $b$
        SELECT m.id, m.record_id, r.identifier, m.operation, m.from_path, m.to_path,
               m.actor_user_id, m.notes, m.created_at
          FROM api.storage_movements m
          JOIN api.records r ON r.id = m.record_id
         WHERE m.workspace_id = (api.claim_probe()->>'workspace_id')::uuid
      $b$ $f$;
    EXECUTE 'REVOKE ALL ON FUNCTION data._storage_movements() FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION data._storage_movements() TO reporting_reader';
    EXECUTE 'ALTER FUNCTION data._storage_movements() OWNER TO reporting_owner';
  END IF;

  IF to_regclass('data.sample_history') IS NULL THEN
    EXECUTE 'CREATE VIEW data.sample_history AS SELECT * FROM data._sample_history()';
    EXECUTE 'GRANT SELECT ON data.sample_history TO reporting_reader';
    EXECUTE $c$COMMENT ON VIEW data.sample_history IS 'Every receive, use, move, release, quarantine and disposal of a sample'$c$;
    EXECUTE 'ALTER VIEW data.sample_history OWNER TO reporting_owner';
  END IF;
  IF to_regclass('data.sample_reservations') IS NULL THEN
    EXECUTE 'CREATE VIEW data.sample_reservations AS SELECT * FROM data._sample_reservations()';
    EXECUTE 'GRANT SELECT ON data.sample_reservations TO reporting_reader';
    EXECUTE $c$COMMENT ON VIEW data.sample_reservations IS 'Volume of a sample held for an experiment, and whether it is still active'$c$;
    EXECUTE 'ALTER VIEW data.sample_reservations OWNER TO reporting_owner';
  END IF;
  IF to_regclass('data.storage_positions') IS NULL THEN
    EXECUTE 'CREATE VIEW data.storage_positions AS SELECT * FROM data._storage_positions()';
    EXECUTE 'GRANT SELECT ON data.storage_positions TO reporting_reader';
    EXECUTE $c$COMMENT ON VIEW data.storage_positions IS 'Every position in every box, with where it is and which sample is in it'$c$;
    EXECUTE 'ALTER VIEW data.storage_positions OWNER TO reporting_owner';
  END IF;
  IF to_regclass('data.storage_movements') IS NULL THEN
    EXECUTE 'CREATE VIEW data.storage_movements AS SELECT * FROM data._storage_movements()';
    EXECUTE 'GRANT SELECT ON data.storage_movements TO reporting_reader';
    EXECUTE $c$COMMENT ON VIEW data.storage_movements IS 'Every time a sample was placed in, moved between or taken out of a storage position'$c$;
    EXECUTE 'ALTER VIEW data.storage_movements OWNER TO reporting_owner';
  END IF;
END
$_$;
--> statement-breakpoint
ALTER FUNCTION internal.ensure_operational_views() OWNER TO migrator;
--> statement-breakpoint

-- Built wherever model views are built, so an install that gets SQL access
-- later gets these too. (Patched in place so any later change is kept.)
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('internal.regenerate_reporting_views(uuid)'::regprocedure) INTO v_def;
  IF position('PERFORM internal.ensure_reporting_functions();' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.regenerate_reporting_views';
  END IF;
  IF position('internal.ensure_operational_views' IN v_def) = 0 THEN
    v_def := replace(v_def, 'PERFORM internal.ensure_reporting_functions();',
      'PERFORM internal.ensure_reporting_functions(); PERFORM internal.ensure_operational_views();');
    EXECUTE v_def;
  END IF;
END $$;
--> statement-breakpoint

SELECT internal.ensure_operational_views();
