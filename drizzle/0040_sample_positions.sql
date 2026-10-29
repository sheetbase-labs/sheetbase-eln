-- Samples sit in real storage positions.
--
-- Settings → Storage builds site → room → freezer → shelf → rack → box →
-- position, but a sample's place was a line of typed text, so occupancy never
-- counted and archiving a full freezer always went through. This makes the
-- position the one place a sample is:
--
--   * a path reads "Site / Room / Freezer / …" in every place it is shown;
--   * putting a sample in a position says where it was before, even when that
--     was typed text, and typing a new place frees the position it held;
--   * a sample that is used up, disposed of or archived gives its position
--     back;
--   * `match_sample_locations` files samples whose typed place names exactly
--     one free position, so existing text is not lost;
--   * a quality-control result that names its sample counts for that sample
--     only, so one run can cover many tubes.

CREATE OR REPLACE FUNCTION api.storage_path(p_position_id uuid) RETURNS text
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_pos "api"."storage_positions";
  v_box "api"."storage_boxes";
  v_rack "api"."storage_racks";
  v_shelf "api"."storage_shelves";
  v_unit "api"."storage_units";
  v_room "api"."storage_rooms";
  v_site "api"."storage_sites";
BEGIN
  SELECT * INTO v_pos FROM "api"."storage_positions" WHERE id = p_position_id;
  IF v_pos IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_box FROM "api"."storage_boxes" WHERE id = v_pos.box_id;
  SELECT * INTO v_rack FROM "api"."storage_racks" WHERE id = v_box.rack_id;
  SELECT * INTO v_shelf FROM "api"."storage_shelves" WHERE id = v_rack.shelf_id;
  SELECT * INTO v_unit FROM "api"."storage_units" WHERE id = v_shelf.unit_id;
  SELECT * INTO v_room FROM "api"."storage_rooms" WHERE id = v_unit.room_id;
  SELECT * INTO v_site FROM "api"."storage_sites" WHERE id = v_room.site_id;
  RETURN concat_ws(' / ',
    v_site.name, v_room.name, v_unit.name, v_shelf.name,
    v_rack.name, v_box.name, v_pos.label);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.move_sample_to_position(p_record_id uuid, p_to_position_id uuid, p_expected_metadata_version integer, p_notes text DEFAULT NULL::text) RETURNS api.records
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row "api"."records";
  v_target "api"."storage_positions";
  v_prev "api"."storage_positions";
  v_to_path text;
  v_from_path text;
  v_from_text text;
  v_props jsonb;
  v_op text;
BEGIN
  IF api.has_capability(api.current_workspace_id(), 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF p_record_id IS NOT NULL THEN PERFORM internal.assert_object_access('record',p_record_id,'edit'); END IF;
  IF NOT api.is_workspace_writer("api"."current_workspace_id"()) THEN
    RAISE EXCEPTION 'no active workspace membership' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target FROM "api"."storage_positions"
    WHERE id = p_to_position_id FOR UPDATE;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'position not found in active workspace' USING ERRCODE = 'SB011';
  END IF;

  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot move an archived sample' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.workspace_id <> "api"."current_workspace_id"() THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  IF v_target.workspace_id <> v_row.workspace_id THEN
    RAISE EXCEPTION 'position is in a different workspace' USING ERRCODE = 'SB011';
  END IF;
  IF v_target.occupied_record_id = p_record_id THEN
    RAISE EXCEPTION 'sample is already at that position' USING ERRCODE = 'SB012';
  END IF;
  IF v_target.status IN ('quarantined','missing') THEN
    RAISE EXCEPTION 'position is not available (status: %)', v_target.status
      USING ERRCODE = 'SB013';
  END IF;
  IF v_target.occupied_record_id IS NOT NULL THEN
    RAISE EXCEPTION 'position is already occupied' USING ERRCODE = 'SB010';
  END IF;

  -- Find and clear the sample's previous position (if any). The partial
  -- unique index on occupied_record_id guarantees at most one.
  SELECT * INTO v_prev FROM "api"."storage_positions"
    WHERE occupied_record_id = p_record_id FOR UPDATE;
  IF v_prev.id IS NOT NULL THEN
    v_from_path := "api"."storage_path"(v_prev.id);
    UPDATE "api"."storage_positions"
      SET occupied_record_id = NULL, status = 'available', updated_at = now()
      WHERE id = v_prev.id;
  END IF;
  v_from_text := nullif(btrim(coalesce(v_row.properties ->> 'storageLocation', '')), '');

  v_to_path := "api"."storage_path"(v_target.id);
  v_op := CASE WHEN v_prev.id IS NULL THEN 'place' ELSE 'move' END;

  UPDATE "api"."storage_positions"
    SET occupied_record_id = p_record_id, status = 'occupied', updated_at = now()
    WHERE id = v_target.id;

  v_props := v_row.properties || jsonb_build_object('storageLocation', v_to_path);
  UPDATE "api"."records"
    SET properties = v_props,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  INSERT INTO "api"."storage_movements"
    (workspace_id, record_id, operation, from_position_id, to_position_id,
     from_path, to_path, actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, v_op, v_prev.id, v_target.id,
     v_from_path, v_to_path, "api"."current_user_id"(), p_notes);

  -- The sample's own history reads the same way, whether it came from a
  -- position, from typed text, or from nowhere.
  IF coalesce(v_from_path, v_from_text, 'unfiled') IS DISTINCT FROM v_to_path THEN
    INSERT INTO "api"."sample_events"
      (workspace_id, record_id, operation, from_location, to_location,
       actor_user_id, notes)
    VALUES
      (v_row.workspace_id, v_row.id, 'transfer',
       coalesce(v_from_path, v_from_text, 'unfiled'),
       v_to_path, "api"."current_user_id"(), p_notes);
  END IF;

  RETURN v_row;
END;
$$;
--> statement-breakpoint
-- Typing a new place frees the position the sample held, so a position never
-- stays marked occupied by a tube that has left. Runs with the caller's
-- authority checks (as for a move to a position), because it updates storage.
CREATE OR REPLACE FUNCTION api.transfer_sample(p_record_id uuid, p_to_location text, p_expected_metadata_version integer, p_notes text DEFAULT NULL::text) RETURNS api.records
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row "api"."records";
  v_prev "api"."storage_positions";
  v_prev_path text;
  v_from text;
  v_to text;
  v_props jsonb;
BEGIN
  IF p_record_id IS NOT NULL THEN PERFORM internal.assert_object_access('record',p_record_id,'edit'); END IF;
  IF NOT api.is_workspace_writer("api"."current_workspace_id"()) THEN
    RAISE EXCEPTION 'no active workspace membership' USING ERRCODE = '42501';
  END IF;

  v_to := btrim(COALESCE(p_to_location, ''));
  IF v_to = '' THEN
    RAISE EXCEPTION 'a destination location is required for transfer'
      USING ERRCODE = 'SB008';
  END IF;

  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL OR v_row.workspace_id <> "api"."current_workspace_id"() THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot transfer an archived sample' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  v_from := v_row.properties ->> 'storageLocation';
  IF v_from IS NOT NULL AND v_from = v_to THEN
    RAISE EXCEPTION 'sample is already at %', v_to USING ERRCODE = 'SB007';
  END IF;
  -- An untraceable move (no current location) is allowed only the first time:
  -- receiving establishes the location. A transfer must move FROM a known
  -- location TO a different one, so the chain of custody stays traceable.
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'sample has no current location to transfer from; receive it first'
      USING ERRCODE = 'SB008';
  END IF;

  SELECT * INTO v_prev FROM "api"."storage_positions"
    WHERE occupied_record_id = p_record_id FOR UPDATE;
  IF v_prev.id IS NOT NULL THEN
    v_prev_path := "api"."storage_path"(v_prev.id);
    UPDATE "api"."storage_positions"
      SET occupied_record_id = NULL, status = 'available', updated_at = now()
      WHERE id = v_prev.id;
    INSERT INTO "api"."storage_movements"
      (workspace_id, record_id, operation, from_position_id, from_path,
       actor_user_id, notes)
    VALUES
      (v_row.workspace_id, v_row.id, 'remove', v_prev.id, v_prev_path,
       "api"."current_user_id"(), p_notes);
  END IF;

  v_props := v_row.properties || jsonb_build_object('storageLocation', v_to);

  UPDATE "api"."records"
    SET properties = v_props,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  INSERT INTO "api"."sample_events"
    (workspace_id, record_id, operation, from_location, to_location,
     actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'transfer', v_from, v_to,
     "api"."current_user_id"(), p_notes);

  RETURN v_row;
END;
$$;
--> statement-breakpoint
-- A tube that is used up, disposed of or archived no longer holds its place.
CREATE FUNCTION internal.free_sample_position() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_pos "api"."storage_positions";
  v_path text;
BEGIN
  IF NEW.kind <> 'sample' THEN RETURN NEW; END IF;
  IF NOT (
    (NEW.status IN ('consumed', 'disposed') AND OLD.status IS DISTINCT FROM NEW.status)
    OR (NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL)
  ) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_pos FROM "api"."storage_positions"
    WHERE occupied_record_id = NEW.id FOR UPDATE;
  IF v_pos.id IS NULL THEN RETURN NEW; END IF;
  v_path := "api"."storage_path"(v_pos.id);
  UPDATE "api"."storage_positions"
    SET occupied_record_id = NULL, status = 'available', updated_at = now()
    WHERE id = v_pos.id;
  INSERT INTO "api"."storage_movements"
    (workspace_id, record_id, operation, from_position_id, from_path,
     actor_user_id, notes)
  VALUES
    (NEW.workspace_id, NEW.id, 'remove', v_pos.id, v_path,
     "api"."current_user_id"(),
     CASE WHEN NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL
          THEN 'Sample archived' ELSE 'Sample ' || NEW.status END);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.free_sample_position() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER free_sample_position
  AFTER UPDATE OF status, archived_at ON api.records
  FOR EACH ROW EXECUTE FUNCTION internal.free_sample_position();
--> statement-breakpoint
-- How a typed place can name a position: the whole path, or the freezer, box
-- and position the way people write them ("F-2, box 14, A1"). Case, commas,
-- slashes and arrows do not matter.
CREATE FUNCTION internal.storage_place_key(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT regexp_replace(
           lower(btrim(regexp_replace(coalesce(p_text, ''), '\s*[>/,]\s*', '|', 'g'))),
           '\s+', ' ', 'g')
$$;
--> statement-breakpoint
ALTER FUNCTION internal.storage_place_key(p_text text) OWNER TO migrator;
--> statement-breakpoint
CREATE FUNCTION internal.storage_position_keys(p_workspace_id uuid) RETURNS TABLE(position_id uuid, place_key text)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH free AS (
    SELECT p.id, p.label, b.name AS box_name, b.code AS box_code,
           r.name AS rack_name, s.name AS shelf_name,
           u.name AS unit_name, u.code AS unit_code,
           m.name AS room_name, t.name AS site_name
      FROM api.storage_positions p
      JOIN api.storage_boxes b ON b.id = p.box_id
      JOIN api.storage_racks r ON r.id = b.rack_id
      JOIN api.storage_shelves s ON s.id = r.shelf_id
      JOIN api.storage_units u ON u.id = s.unit_id
      JOIN api.storage_rooms m ON m.id = u.room_id
      JOIN api.storage_sites t ON t.id = m.site_id
     WHERE p.workspace_id = p_workspace_id
       AND p.status = 'available' AND p.occupied_record_id IS NULL
       AND b.archived_at IS NULL AND r.archived_at IS NULL
       AND s.archived_at IS NULL AND u.archived_at IS NULL
       AND m.archived_at IS NULL AND t.archived_at IS NULL
  )
  SELECT id, internal.storage_place_key(concat_ws('|',
           site_name, room_name, unit_name, shelf_name, rack_name, box_name, label))
    FROM free
  UNION
  SELECT id, internal.storage_place_key(concat_ws('|', unit_name, box_name, label)) FROM free
  UNION
  SELECT id, internal.storage_place_key(concat_ws('|', unit_code, box_name, label)) FROM free
  UNION
  SELECT id, internal.storage_place_key(concat_ws('|', unit_code, box_code, label)) FROM free
$$;
--> statement-breakpoint
ALTER FUNCTION internal.storage_position_keys(p_workspace_id uuid) OWNER TO migrator;
--> statement-breakpoint
-- Files every sample whose typed place names exactly one free position in it.
-- Anything that matches nothing, or more than one, keeps its text.
CREATE FUNCTION internal.match_sample_locations(p_workspace_id uuid, p_actor text DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r record;
  v_ids uuid[];
  v_pos uuid;
  v_path text;
  v_matched integer := 0;
  v_unmatched integer := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.metadata_version, s.properties,
           s.properties ->> 'storageLocation' AS loc
      FROM api.records s
     WHERE s.workspace_id = p_workspace_id AND s.kind = 'sample'
       AND s.archived_at IS NULL AND s.status NOT IN ('consumed', 'disposed')
       AND nullif(btrim(coalesce(s.properties ->> 'storageLocation', '')), '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM api.storage_positions p WHERE p.occupied_record_id = s.id)
     ORDER BY s.created_at, s.id
     FOR UPDATE OF s
  LOOP
    SELECT array_agg(DISTINCT k.position_id) INTO v_ids
      FROM internal.storage_position_keys(p_workspace_id) k
     WHERE k.place_key = internal.storage_place_key(r.loc);
    IF v_ids IS NULL OR array_length(v_ids, 1) <> 1 THEN
      v_unmatched := v_unmatched + 1;
      CONTINUE;
    END IF;
    v_pos := v_ids[1];
    v_path := api.storage_path(v_pos);
    UPDATE api.storage_positions
       SET occupied_record_id = r.id, status = 'occupied', updated_at = now()
     WHERE id = v_pos;
    UPDATE api.records
       SET properties = r.properties || jsonb_build_object('storageLocation', v_path),
           metadata_version = r.metadata_version + 1,
           updated_by_user_id = p_actor
     WHERE id = r.id;
    INSERT INTO api.storage_movements
      (workspace_id, record_id, operation, to_position_id, to_path, actor_user_id, notes)
    VALUES
      (p_workspace_id, r.id, 'place', v_pos, v_path, p_actor,
       'Matched from “' || r.loc || '”');
    IF r.loc IS DISTINCT FROM v_path THEN
      INSERT INTO api.sample_events
        (workspace_id, record_id, operation, from_location, to_location, actor_user_id, notes)
      VALUES
        (p_workspace_id, r.id, 'transfer', r.loc, v_path, p_actor,
         'Filed in its storage position');
    END IF;
    v_matched := v_matched + 1;
  END LOOP;
  RETURN jsonb_build_object('matched', v_matched, 'unmatched', v_unmatched);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.match_sample_locations(p_workspace_id uuid, p_actor text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.match_sample_locations(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.storage_position_keys(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION api.match_sample_locations(p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'settings.storage.manage');
  RETURN internal.match_sample_locations(p_workspace_id, api.current_user_id());
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.match_sample_locations(p_workspace_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.match_sample_locations(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.match_sample_locations(uuid) TO authenticated;
--> statement-breakpoint
-- Existing workspaces: file the samples whose typed place already names a
-- box position.
SELECT internal.match_sample_locations(w.id) FROM api.workspaces w;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.sample_measurement_provenance(p_sample_record_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_sample api.records;
  v_workspace uuid;
  v_result jsonb;
BEGIN
 IF p_sample_record_id IS NOT NULL THEN PERFORM internal.assert_object_access('record',p_sample_record_id,'view'); END IF;
  v_workspace := api.current_workspace_id();
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'sample denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sample FROM api.records
    WHERE id = p_sample_record_id
      AND workspace_id = v_workspace
      AND api.is_workspace_member(workspace_id)
      AND kind = 'sample'
      AND deleted_at IS NULL;
  IF v_sample.id IS NULL THEN
    RAISE EXCEPTION 'sample denied' USING ERRCODE = '42501';
  END IF;

  WITH linked_rows AS (
    -- Direct reference: a reference-typed field whose Model target is sample
    -- and whose value is this sample record id.
    SELECT DISTINCT r.id AS row_id
      FROM api.dataset_rows r
      JOIN api.datasets d
        ON d.id = r.dataset_id
       AND d.workspace_id = v_sample.workspace_id
       AND d.lifecycle = 'active'
      JOIN api.dataset_schema_version_fields lf
        ON lf.schema_version_id = d.schema_version_id
       AND lf.lifecycle = 'active'
       AND lf.logical_type = 'reference'
       AND coalesce(
             lf.relationship->'target'->>'modelKey',
             lf.validation->>'targetModelKey'
           ) = 'sample'
      JOIN api.dataset_row_values lv
        ON lv.row_id = r.id
       AND lv.field_id = lf.field_id
       AND lv.reference_id = v_sample.id
    UNION
    -- Sample-keyed value: a text field named/labelled "sample" holding the
    -- sample's stable identifier.
    SELECT DISTINCT r.id
      FROM api.dataset_rows r
      JOIN api.datasets d
        ON d.id = r.dataset_id
       AND d.workspace_id = v_sample.workspace_id
       AND d.lifecycle = 'active'
      JOIN api.dataset_schema_version_fields lf
        ON lf.schema_version_id = d.schema_version_id
       AND lf.lifecycle = 'active'
       AND lf.logical_type = 'text'
       AND (lf.key ~* 'sample' OR lf.label ~* 'sample')
      JOIN api.dataset_row_values lv
        ON lv.row_id = r.id
       AND lv.field_id = lf.field_id
       AND btrim(lv.text_value) = btrim(v_sample.identifier)
  ),
  dataset_measures AS (
    SELECT
      'dataset:' || m.row_id::text || ':' || m.field_id::text || ':' ||
        m.ordinal::text AS id,
      m.label AS measurement,
      m.value_num AS value,
      m.value_num::text AS value_text,
      coalesce(m.quantity->>'symbol', m.quantity->>'storageUnit') AS unit,
      (SELECT mv.text_value
         FROM api.dataset_schema_version_fields mf
         JOIN api.dataset_row_values mv
           ON mv.row_id = m.row_id AND mv.field_id = mf.field_id
        WHERE mf.schema_version_id = m.schema_version_id
          AND mf.lifecycle = 'active'
          AND mf.logical_type = 'text'
          AND (mf.key ~* 'method' OR mf.label ~* 'method')
        ORDER BY mf.display_order
        LIMIT 1) AS method,
      coalesce(m.display_id, m.dataset_name) AS source,
      NULL::text AS result,
      coalesce(
        (SELECT tv.timestamp_value
           FROM api.dataset_schema_version_fields tf
           JOIN api.dataset_row_values tv
             ON tv.row_id = m.row_id AND tv.field_id = tf.field_id
          WHERE tf.schema_version_id = m.schema_version_id
            AND tf.lifecycle = 'active'
            AND tf.logical_type = 'timestamp'
            AND (
              tf.key ~* 'measur|time|date' OR tf.label ~* 'measur|time|date'
            )
          ORDER BY tf.display_order
          LIMIT 1),
        m.row_updated_at
      ) AS measured_at,
      jsonb_build_object(
        'kind', 'dataset',
        'datasetId', m.dataset_id,
        'datasetDisplayId', m.display_id,
        'datasetName', m.dataset_name,
        'rowId', m.row_id,
        'fieldId', m.field_id,
        'fieldKey', m.field_key,
        'sourceId', NULL,
        'runId', NULL,
        'runIdentifier', NULL,
        'instrumentId', NULL,
        'instrumentName', NULL
      ) AS provenance
    FROM (
      SELECT
        lr.row_id,
        r.updated_at AS row_updated_at,
        d.id AS dataset_id,
        d.display_id,
        d.name AS dataset_name,
        d.schema_version_id,
        f.field_id,
        f.key AS field_key,
        f.label,
        f.quantity,
        v.ordinal,
        coalesce(v.numeric_value, v.integer_value) AS value_num
      FROM linked_rows lr
      JOIN api.dataset_rows r ON r.id = lr.row_id
      JOIN api.datasets d
        ON d.id = r.dataset_id
       AND d.workspace_id = v_sample.workspace_id
      JOIN api.dataset_schema_version_fields f
        ON f.schema_version_id = d.schema_version_id
       AND f.lifecycle = 'active'
       AND f.logical_type IN ('integer', 'decimal')
      JOIN api.dataset_row_values v
        ON v.row_id = r.id
       AND v.field_id = f.field_id
       AND (v.numeric_value IS NOT NULL OR v.integer_value IS NOT NULL)
    ) m
  ),
  integration_measures AS (
    SELECT
      'integration:' || qc.id::text AS id,
      qc.check_name AS measurement,
      CASE
        WHEN jsonb_typeof(qc.detail->'value') = 'number'
          THEN (qc.detail->>'value')::numeric
        WHEN qc.detail->>'value'
          ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
          THEN (qc.detail->>'value')::numeric
        ELSE NULL
      END AS value,
      qc.detail->>'value' AS value_text,
      qc.detail->>'unit' AS unit,
      coalesce(ins.name, qc.detail->>'method') AS method,
      'QC · ' || ir.run_identifier AS source,
      qc.check_type AS result,
      qc.checked_at AS measured_at,
      jsonb_build_object(
        'kind', 'integration',
        'datasetId', NULL,
        'datasetDisplayId', NULL,
        'datasetName', NULL,
        'rowId', NULL,
        'fieldId', NULL,
        'fieldKey', NULL,
        'sourceId', qc.id,
        'runId', ir.id,
        'runIdentifier', ir.run_identifier,
        'instrumentId', ir.instrument_id,
        'instrumentName', ins.name
      ) AS provenance
    FROM api.instrument_run_links irl
    JOIN api.instrument_runs ir
      ON ir.id = irl.run_id
     AND ir.workspace_id = v_sample.workspace_id
    JOIN api.instrument_qc_checks qc
      ON qc.run_id = irl.run_id
     AND qc.workspace_id = v_sample.workspace_id
     -- A run can cover many samples; a result that names its sample counts
     -- for that sample only.
     AND (qc.detail->>'sampleId' IS NULL
          OR qc.detail->>'sampleId' = v_sample.id::text)
    LEFT JOIN api.instruments ins
      ON ins.id = ir.instrument_id
     AND ins.workspace_id = v_sample.workspace_id
    WHERE irl.linked_record_id = v_sample.id
      AND irl.link_type = 'sample'
      AND irl.workspace_id = v_sample.workspace_id
  ),
  all_measures AS (
    -- A reading the instrument run recorded for this sample is the same
    -- reading as its dataset row; show it once, with the run as its source.
    SELECT dm.* FROM dataset_measures dm
     WHERE NOT EXISTS (
       SELECT 1 FROM integration_measures im
        WHERE lower(im.measurement) = lower(dm.measurement)
          AND im.value IS NOT DISTINCT FROM dm.value)
    UNION ALL
    SELECT * FROM integration_measures
  )
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', am.id,
               'measurement', am.measurement,
               'value', am.value,
               'valueText', am.value_text,
               'unit', am.unit,
               'method', am.method,
               'source', am.source,
               'result', am.result,
               'measuredAt', am.measured_at,
               'provenance', am.provenance
             )
             ORDER BY am.measured_at DESC NULLS LAST, am.id
           ),
           '[]'::jsonb
         )
    INTO v_result
    FROM all_measures am;

  RETURN v_result;
END;
$_$;
--> statement-breakpoint
-- What an instrument run found for each sample it measured: links the run to
-- the samples it names (by their identifier) and records one quality-control
-- result per reading or verdict. The release gate reads these.
--   p_results = [{"sample": "SMP-2250", "checks": [
--     {"name": "Turbidity", "type": "info", "value": 12.4, "unit": "NTU"},
--     {"name": "QC", "type": "fail", "message": "Out of range"}]}]
CREATE FUNCTION api.record_run_sample_results(p_workspace_id uuid, p_run_id uuid, p_results jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_entry jsonb;
  v_check jsonb;
  v_sample api.records;
  v_ident text;
  v_type text;
  v_name text;
  v_linked integer := 0;
  v_checks integer := 0;
  v_unknown jsonb := '[]'::jsonb;
BEGIN
  IF p_run_id IS NOT NULL THEN PERFORM internal.assert_object_access('run', p_run_id, 'edit'); END IF;
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.instrument_runs WHERE id = p_run_id AND workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB039';
  END IF;
  IF jsonb_typeof(coalesce(p_results, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_results) > 2000 THEN
    RAISE EXCEPTION 'invalid sample results' USING ERRCODE = 'SB043';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_results) LOOP
    v_ident := nullif(btrim(coalesce(v_entry ->> 'sample', '')), '');
    IF v_ident IS NULL THEN CONTINUE; END IF;
    SELECT * INTO v_sample FROM api.records
     WHERE workspace_id = p_workspace_id AND kind = 'sample'
       AND lower(identifier) = lower(v_ident) AND deleted_at IS NULL
     LIMIT 1;
    IF v_sample.id IS NULL OR NOT internal.can_access_object('record', v_sample.id, 'view') THEN
      v_unknown := v_unknown || to_jsonb(v_ident);
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM api.instrument_run_links
       WHERE run_id = p_run_id AND linked_record_id = v_sample.id AND link_type = 'sample') THEN
      INSERT INTO api.instrument_run_links
        (workspace_id, run_id, linked_record_id, linked_record_identifier,
         linked_record_title, link_type)
      VALUES
        (p_workspace_id, p_run_id, v_sample.id, v_sample.identifier, v_sample.title, 'sample');
      v_linked := v_linked + 1;
    END IF;
    FOR v_check IN SELECT value FROM jsonb_array_elements(coalesce(v_entry -> 'checks', '[]'::jsonb)) LOOP
      v_name := nullif(btrim(coalesce(v_check ->> 'name', '')), '');
      v_type := coalesce(nullif(v_check ->> 'type', ''), 'info');
      IF v_name IS NULL OR length(v_name) > 200 OR v_type NOT IN ('pass', 'warning', 'fail', 'info') THEN
        CONTINUE;
      END IF;
      INSERT INTO api.instrument_qc_checks (workspace_id, run_id, check_name, check_type, message, detail)
      VALUES (
        p_workspace_id, p_run_id, v_name, v_type, nullif(v_check ->> 'message', ''),
        jsonb_strip_nulls(jsonb_build_object(
          'sampleId', v_sample.id,
          'sampleIdentifier', v_sample.identifier,
          'value', v_check -> 'value',
          'unit', v_check ->> 'unit')));
      v_checks := v_checks + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('linked', v_linked, 'checks', v_checks, 'unknown', v_unknown);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.record_run_sample_results(p_workspace_id uuid, p_run_id uuid, p_results jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_run_sample_results(uuid, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_run_sample_results(uuid, uuid, jsonb) TO authenticated;
--> statement-breakpoint
