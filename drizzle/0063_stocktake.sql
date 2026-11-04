-- Stocktake. Walk a freezer, shelf, rack or box with the scanner and confirm what is
-- really there against what the records say.
--
-- Starting a count takes a snapshot of what should be in that place: the samples
-- filed in its positions, and the lots whose storage reads as that place. Scanning
-- an item while standing at a box marks it:
--
--   confirmed   it is where the record says
--   misplaced   it is on the list but was found in a different box
--   unexpected  it was found here but the records put it elsewhere (or nowhere)
--   missing     it was never found by the time the count was finished
--
-- Finishing the count turns everything not yet seen into missing and freezes the
-- result. The summary then offers the fix for each difference: file a misplaced or
-- unexpected item where it was found, note that it was put back, mark a missing
-- sample lost, clear a missing lot's place, or accept the difference as known.
-- Every fix goes through the same steps the rest of the app uses (move, dispose),
-- so histories and audit records read the same as if someone had done it by hand.

CREATE TABLE api.stocktakes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    number integer NOT NULL,
    -- The part of the storage tree being counted, and how it read at the start.
    scope_level text NOT NULL,
    scope_id uuid NOT NULL,
    scope_name text NOT NULL,
    scope_path text NOT NULL,
    status text DEFAULT 'open' NOT NULL,
    note text,
    started_by text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_by text,
    completed_at timestamp with time zone,
    cancelled_by text,
    cancelled_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stocktakes_pkey PRIMARY KEY (id),
    CONSTRAINT uq_stocktakes_number UNIQUE (workspace_id, number),
    CONSTRAINT stocktakes_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_stocktakes_level CHECK (scope_level IN ('unit', 'shelf', 'rack', 'box')),
    CONSTRAINT chk_stocktakes_status CHECK (status IN ('open', 'completed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE api.stocktakes OWNER TO migrator;
--> statement-breakpoint
-- One count at a time for the same place.
CREATE UNIQUE INDEX uq_stocktakes_open_scope ON api.stocktakes (workspace_id, scope_id) WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX idx_stocktakes_workspace ON api.stocktakes (workspace_id, started_at DESC);
--> statement-breakpoint

CREATE TABLE api.stocktake_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    stocktake_id uuid NOT NULL,
    record_id uuid NOT NULL,
    -- What the item was called when counted, so the summary still reads if it is
    -- renamed or archived afterwards.
    identifier text NOT NULL,
    title text,
    record_kind text NOT NULL,
    -- On the list when the count started (or filed into the place while it ran).
    expected boolean NOT NULL,
    state text DEFAULT 'expected' NOT NULL,
    expected_box_id uuid,
    expected_path text,
    found_box_id uuid,
    found_path text,
    scanned_by text,
    scanned_at timestamp with time zone,
    resolution text,
    resolution_note text,
    resolved_by text,
    resolved_at timestamp with time zone,
    CONSTRAINT stocktake_items_pkey PRIMARY KEY (id),
    CONSTRAINT uq_stocktake_items_record UNIQUE (stocktake_id, record_id),
    CONSTRAINT stocktake_items_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT stocktake_items_stocktake_fk FOREIGN KEY (stocktake_id) REFERENCES api.stocktakes(id) ON DELETE CASCADE,
    CONSTRAINT stocktake_items_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT chk_stocktake_items_kind CHECK (record_kind IN ('sample', 'material')),
    CONSTRAINT chk_stocktake_items_state CHECK (state IN ('expected', 'confirmed', 'misplaced', 'unexpected', 'missing')),
    CONSTRAINT chk_stocktake_items_resolution CHECK (resolution IS NULL OR resolution IN ('accept', 'returned', 'refile', 'mark_lost', 'clear_location'))
);
--> statement-breakpoint
ALTER TABLE api.stocktake_items OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_stocktake_items_stocktake ON api.stocktake_items (stocktake_id, state);
--> statement-breakpoint
CREATE INDEX idx_stocktake_items_record ON api.stocktake_items (record_id);
--> statement-breakpoint
ALTER TABLE api.stocktakes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.stocktake_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY stocktakes_select ON api.stocktakes FOR SELECT TO authenticated
    USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY stocktake_items_select ON api.stocktake_items FOR SELECT TO authenticated
    USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.stocktakes TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.stocktake_items TO authenticated;
--> statement-breakpoint

-- The boxes inside one part of the storage tree, each with the way its place reads.
-- scope_path reads the same as api.storage_path, up to the level that was counted.
CREATE FUNCTION internal.stocktake_scope(p_workspace_id uuid, p_level text, p_scope_id uuid)
RETURNS TABLE (box_id uuid, box_path text, scope_name text, scope_path text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT b.id,
         concat_ws(' / ', s.name, r.name, u.name, sh.name, rk.name, b.name),
         CASE p_level WHEN 'box' THEN b.name WHEN 'rack' THEN rk.name
                      WHEN 'shelf' THEN sh.name ELSE u.name END,
         CASE p_level
           WHEN 'box' THEN concat_ws(' / ', s.name, r.name, u.name, sh.name, rk.name, b.name)
           WHEN 'rack' THEN concat_ws(' / ', s.name, r.name, u.name, sh.name, rk.name)
           WHEN 'shelf' THEN concat_ws(' / ', s.name, r.name, u.name, sh.name)
           ELSE concat_ws(' / ', s.name, r.name, u.name)
         END
    FROM api.storage_boxes b
    JOIN api.storage_racks rk ON rk.id = b.rack_id
    JOIN api.storage_shelves sh ON sh.id = rk.shelf_id
    JOIN api.storage_units u ON u.id = sh.unit_id
    JOIN api.storage_rooms r ON r.id = u.room_id
    JOIN api.storage_sites s ON s.id = r.site_id
   WHERE b.workspace_id = p_workspace_id
     AND CASE p_level
           WHEN 'box' THEN b.id = p_scope_id
           WHEN 'rack' THEN rk.id = p_scope_id
           WHEN 'shelf' THEN sh.id = p_scope_id
           WHEN 'unit' THEN u.id = p_scope_id
           ELSE false
         END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.stocktake_scope(p_workspace_id uuid, p_level text, p_scope_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.stocktake_scope(p_workspace_id uuid, p_level text, p_scope_id uuid) FROM PUBLIC;
--> statement-breakpoint

-- Start a count of a unit, shelf, rack or box.
CREATE FUNCTION api.start_stocktake(p_scope_level text, p_scope_id uuid, p_note text DEFAULT NULL) RETURNS api.stocktakes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_stocktake api.stocktakes;
  v_name text;
  v_path text;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  IF p_scope_level IS NULL OR p_scope_level NOT IN ('unit', 'shelf', 'rack', 'box') THEN
    RAISE EXCEPTION 'a count covers a freezer or unit, a shelf, a rack or a box' USING ERRCODE = '22023';
  END IF;

  SELECT min(sc.scope_name), min(sc.scope_path) INTO v_name, v_path
    FROM internal.stocktake_scope(v_workspace_id, p_scope_level, p_scope_id) sc;
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'nothing to count here: that place has no boxes' USING ERRCODE = 'SB011';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stocktakes:' || v_workspace_id::text, 0));
  IF EXISTS (SELECT 1 FROM api.stocktakes
              WHERE workspace_id = v_workspace_id AND scope_id = p_scope_id AND status = 'open') THEN
    RAISE EXCEPTION 'a count of this place is already open' USING ERRCODE = '23505';
  END IF;

  INSERT INTO api.stocktakes
    (workspace_id, number, scope_level, scope_id, scope_name, scope_path, note, started_by)
  VALUES
    (v_workspace_id,
     (SELECT coalesce(max(number), 0) + 1 FROM api.stocktakes WHERE workspace_id = v_workspace_id),
     p_scope_level, p_scope_id, v_name, v_path,
     nullif(btrim(coalesce(p_note, '')), ''), api.current_user_id())
  RETURNING * INTO v_stocktake;

  -- Samples filed in a position of the counted place.
  INSERT INTO api.stocktake_items
    (workspace_id, stocktake_id, record_id, identifier, title, record_kind, expected,
     expected_box_id, expected_path)
  SELECT v_workspace_id, v_stocktake.id, rec.id, rec.identifier, rec.title, 'sample', true,
         pos.box_id, api.storage_path(pos.id)
    FROM api.storage_positions pos
    JOIN internal.stocktake_scope(v_workspace_id, p_scope_level, p_scope_id) sc ON sc.box_id = pos.box_id
    JOIN api.records rec ON rec.id = pos.occupied_record_id
   WHERE rec.deleted_at IS NULL AND rec.archived_at IS NULL;

  -- Lots whose storage reads as the counted place.
  INSERT INTO api.stocktake_items
    (workspace_id, stocktake_id, record_id, identifier, title, record_kind, expected,
     expected_path)
  SELECT v_workspace_id, v_stocktake.id, rec.id, rec.identifier, rec.title, 'material', true,
         btrim(rec.properties->>'storage')
    FROM api.records rec
   WHERE rec.workspace_id = v_workspace_id
     AND rec.kind = 'material'
     AND rec.deleted_at IS NULL AND rec.archived_at IS NULL
     AND rec.status NOT IN ('consumed', 'disposed')
     AND (lower(btrim(coalesce(rec.properties->>'storage', ''))) = lower(v_path)
          OR lower(btrim(coalesce(rec.properties->>'storage', ''))) LIKE lower(v_path) || ' / %');

  RETURN v_stocktake;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.start_stocktake(p_scope_level text, p_scope_id uuid, p_note text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.start_stocktake(p_scope_level text, p_scope_id uuid, p_note text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.start_stocktake(p_scope_level text, p_scope_id uuid, p_note text) TO authenticated;
--> statement-breakpoint

-- Count one item. The box says where the person is standing; counting a box
-- needs no box because the count itself is that box.
CREATE FUNCTION api.record_stocktake_scan(p_stocktake_id uuid, p_record_id uuid, p_box_id uuid DEFAULT NULL) RETURNS api.stocktake_items
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_stocktake api.stocktakes;
  v_record api.records;
  v_item api.stocktake_items;
  v_box_id uuid := p_box_id;
  v_found_path text;
  v_scope_path text;
  v_pos api.storage_positions;
  v_state text;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_stocktake FROM api.stocktakes
   WHERE id = p_stocktake_id AND workspace_id = v_workspace_id FOR UPDATE;
  IF v_stocktake.id IS NULL THEN
    RAISE EXCEPTION 'count not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_stocktake.status <> 'open' THEN
    RAISE EXCEPTION 'this count is already %', v_stocktake.status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_record FROM api.records
   WHERE id = p_record_id AND workspace_id = v_workspace_id AND deleted_at IS NULL;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_record.kind NOT IN ('sample', 'material') THEN
    RAISE EXCEPTION 'only samples and lots can be counted' USING ERRCODE = '22023';
  END IF;

  IF v_box_id IS NULL AND v_stocktake.scope_level = 'box' THEN
    v_box_id := v_stocktake.scope_id;
  END IF;
  SELECT min(sc.box_path), min(sc.scope_path) INTO v_found_path, v_scope_path
    FROM internal.stocktake_scope(v_workspace_id, v_stocktake.scope_level, v_stocktake.scope_id) sc
   WHERE v_box_id IS NULL OR sc.box_id = v_box_id;
  IF v_box_id IS NOT NULL AND v_found_path IS NULL THEN
    RAISE EXCEPTION 'that box is not part of this count' USING ERRCODE = '22023';
  END IF;
  IF v_record.kind = 'sample' AND v_box_id IS NULL THEN
    RAISE EXCEPTION 'say which box the sample is in' USING ERRCODE = '22023';
  END IF;
  IF v_box_id IS NULL THEN
    v_found_path := v_stocktake.scope_path;
  END IF;

  SELECT * INTO v_item FROM api.stocktake_items
   WHERE stocktake_id = p_stocktake_id AND record_id = p_record_id FOR UPDATE;

  IF v_item.id IS NULL THEN
    -- Not on the list when the count started. A sample filed into this place since
    -- then still belongs here; anything else is simply somewhere it does not belong.
    SELECT * INTO v_pos FROM api.storage_positions WHERE occupied_record_id = p_record_id;
    INSERT INTO api.stocktake_items
      (workspace_id, stocktake_id, record_id, identifier, title, record_kind, expected,
       expected_box_id, expected_path)
    VALUES
      (v_workspace_id, p_stocktake_id, v_record.id, v_record.identifier, v_record.title,
       v_record.kind,
       v_pos.id IS NOT NULL AND EXISTS (
         SELECT 1 FROM internal.stocktake_scope(v_workspace_id, v_stocktake.scope_level, v_stocktake.scope_id) sc
          WHERE sc.box_id = v_pos.box_id),
       v_pos.box_id,
       CASE WHEN v_pos.id IS NOT NULL THEN api.storage_path(v_pos.id)
            ELSE nullif(btrim(coalesce(v_record.properties->>'storageLocation',
                                       v_record.properties->>'storage', '')), '') END)
    RETURNING * INTO v_item;
  END IF;

  IF v_item.resolved_at IS NOT NULL THEN
    RETURN v_item;
  END IF;

  IF NOT v_item.expected THEN
    v_state := 'unexpected';
  ELSIF v_item.record_kind = 'material' OR v_item.expected_box_id IS NOT DISTINCT FROM v_box_id THEN
    v_state := 'confirmed';
  ELSE
    v_state := 'misplaced';
  END IF;

  UPDATE api.stocktake_items
     SET state = v_state,
         found_box_id = v_box_id,
         found_path = v_found_path,
         scanned_by = api.current_user_id(),
         scanned_at = now()
   WHERE id = v_item.id
   RETURNING * INTO v_item;
  RETURN v_item;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.record_stocktake_scan(p_stocktake_id uuid, p_record_id uuid, p_box_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_stocktake_scan(p_stocktake_id uuid, p_record_id uuid, p_box_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_stocktake_scan(p_stocktake_id uuid, p_record_id uuid, p_box_id uuid) TO authenticated;
--> statement-breakpoint

-- Finish the count: whatever was never seen is missing.
CREATE FUNCTION api.complete_stocktake(p_stocktake_id uuid) RETURNS api.stocktakes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_stocktake api.stocktakes;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_stocktake FROM api.stocktakes
   WHERE id = p_stocktake_id AND workspace_id = v_workspace_id FOR UPDATE;
  IF v_stocktake.id IS NULL THEN
    RAISE EXCEPTION 'count not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_stocktake.status <> 'open' THEN
    RAISE EXCEPTION 'this count is already %', v_stocktake.status USING ERRCODE = '22023';
  END IF;
  UPDATE api.stocktake_items SET state = 'missing'
   WHERE stocktake_id = p_stocktake_id AND state = 'expected';
  UPDATE api.stocktakes
     SET status = 'completed', completed_by = api.current_user_id(), completed_at = now(), updated_at = now()
   WHERE id = p_stocktake_id
   RETURNING * INTO v_stocktake;
  RETURN v_stocktake;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.complete_stocktake(p_stocktake_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.complete_stocktake(p_stocktake_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.complete_stocktake(p_stocktake_id uuid) TO authenticated;
--> statement-breakpoint

-- Walk away from a count that is not going to be finished.
CREATE FUNCTION api.cancel_stocktake(p_stocktake_id uuid) RETURNS api.stocktakes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_stocktake api.stocktakes;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_stocktake FROM api.stocktakes
   WHERE id = p_stocktake_id AND workspace_id = v_workspace_id FOR UPDATE;
  IF v_stocktake.id IS NULL THEN
    RAISE EXCEPTION 'count not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_stocktake.status <> 'open' THEN
    RAISE EXCEPTION 'this count is already %', v_stocktake.status USING ERRCODE = '22023';
  END IF;
  UPDATE api.stocktakes
     SET status = 'cancelled', cancelled_by = api.current_user_id(), cancelled_at = now(), updated_at = now()
   WHERE id = p_stocktake_id
   RETURNING * INTO v_stocktake;
  RETURN v_stocktake;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.cancel_stocktake(p_stocktake_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.cancel_stocktake(p_stocktake_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.cancel_stocktake(p_stocktake_id uuid) TO authenticated;
--> statement-breakpoint

-- Fix one difference found by a finished count.
--   accept          the difference is known; leave the records as they are
--   returned        a misplaced or unexpected item was carried back to its place
--   refile          update the records to where the item was found (a sample takes
--                   the first free position of that box; a lot takes its path)
--   mark_lost       a missing sample is disposed of as lost
--   clear_location  a missing lot no longer has a place
CREATE FUNCTION api.resolve_stocktake_item(p_item_id uuid, p_action text, p_notes text DEFAULT NULL) RETURNS api.stocktake_items
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_item api.stocktake_items;
  v_stocktake api.stocktakes;
  v_record api.records;
  v_pos api.storage_positions;
  v_label text;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_item FROM api.stocktake_items
   WHERE id = p_item_id AND workspace_id = v_workspace_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'item not found' USING ERRCODE = 'SB036';
  END IF;
  SELECT * INTO v_stocktake FROM api.stocktakes WHERE id = v_item.stocktake_id;
  IF v_stocktake.status <> 'completed' THEN
    RAISE EXCEPTION 'finish the count before fixing what it found' USING ERRCODE = '22023';
  END IF;
  IF v_item.state NOT IN ('misplaced', 'unexpected', 'missing') THEN
    RAISE EXCEPTION 'nothing to fix: this item was found where it belongs' USING ERRCODE = '22023';
  END IF;
  IF v_item.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'this has already been dealt with' USING ERRCODE = '22023';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('accept', 'returned', 'refile', 'mark_lost', 'clear_location') THEN
    RAISE EXCEPTION 'unknown action' USING ERRCODE = '22023';
  END IF;
  IF (p_action IN ('returned', 'refile') AND v_item.state NOT IN ('misplaced', 'unexpected'))
     OR (p_action = 'mark_lost' AND NOT (v_item.state = 'missing' AND v_item.record_kind = 'sample'))
     OR (p_action = 'clear_location' AND NOT (v_item.state = 'missing' AND v_item.record_kind = 'material')) THEN
    RAISE EXCEPTION 'that does not apply to a % item', v_item.state USING ERRCODE = '22023';
  END IF;

  v_label := 'Stocktake ST-' || lpad(v_stocktake.number::text, 4, '0');
  SELECT * INTO v_record FROM api.records WHERE id = v_item.record_id FOR UPDATE;
  IF v_record.id IS NULL OR v_record.workspace_id <> v_workspace_id THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_action <> 'accept' AND p_action <> 'returned' THEN
    PERFORM internal.assert_object_access('record', v_item.record_id, 'edit');
  END IF;

  IF p_action = 'refile' THEN
    IF v_item.record_kind = 'sample' THEN
      SELECT * INTO v_pos FROM api.storage_positions
       WHERE box_id = v_item.found_box_id AND status = 'available' AND occupied_record_id IS NULL
       ORDER BY row_index, col_index
       LIMIT 1 FOR UPDATE SKIP LOCKED;
      IF v_pos.id IS NULL THEN
        RAISE EXCEPTION 'there is no free position in that box' USING ERRCODE = 'SB010';
      END IF;
      PERFORM api.move_sample_to_position(v_item.record_id, v_pos.id, v_record.metadata_version, v_label);
    ELSE
      UPDATE api.records
         SET properties = properties || jsonb_build_object('storage', v_item.found_path),
             metadata_version = metadata_version + 1,
             updated_by_user_id = api.current_user_id()
       WHERE id = v_item.record_id;
    END IF;
  ELSIF p_action = 'mark_lost' THEN
    PERFORM api.dispose_sample(v_item.record_id, v_record.metadata_version,
                               'Lost: not found in ' || v_label, p_notes);
  ELSIF p_action = 'clear_location' THEN
    UPDATE api.records
       SET properties = properties - 'storage',
           metadata_version = metadata_version + 1,
           updated_by_user_id = api.current_user_id()
     WHERE id = v_item.record_id;
  END IF;

  UPDATE api.stocktake_items
     SET resolution = p_action,
         resolution_note = nullif(btrim(coalesce(p_notes, '')), ''),
         resolved_by = api.current_user_id(),
         resolved_at = now()
   WHERE id = p_item_id
   RETURNING * INTO v_item;
  RETURN v_item;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.resolve_stocktake_item(p_item_id uuid, p_action text, p_notes text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.resolve_stocktake_item(p_item_id uuid, p_action text, p_notes text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.resolve_stocktake_item(p_item_id uuid, p_action text, p_notes text) TO authenticated;
