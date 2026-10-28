-- Storage locations and label templates become workspace settings.
--
-- A site, room, freezer, shelf, rack or box can be archived instead of
-- deleted, and nothing that holds a sample can be archived or deleted at all.
-- A label template gains the size, barcode type and fields an admin chooses,
-- can be archived, and one template per kind of record can be the default.
--
-- Who may change these is the workspace's Storage and labels access
-- (`settings.storage.manage`), so the Settings page, the row policies and the
-- RPCs below all agree.

ALTER TABLE api.storage_sites ADD COLUMN archived_at timestamptz;
--> statement-breakpoint
ALTER TABLE api.storage_rooms ADD COLUMN archived_at timestamptz;
--> statement-breakpoint
ALTER TABLE api.storage_units ADD COLUMN archived_at timestamptz;
--> statement-breakpoint
ALTER TABLE api.storage_shelves ADD COLUMN archived_at timestamptz;
--> statement-breakpoint
ALTER TABLE api.storage_racks ADD COLUMN archived_at timestamptz;
--> statement-breakpoint
ALTER TABLE api.storage_boxes ADD COLUMN archived_at timestamptz;
--> statement-breakpoint
ALTER TABLE api.label_templates
  ADD COLUMN width_mm integer NOT NULL DEFAULT 50,
  ADD COLUMN height_mm integer NOT NULL DEFAULT 25,
  ADD COLUMN barcode_type text NOT NULL DEFAULT 'qr',
  ADD COLUMN show_lot boolean NOT NULL DEFAULT true,
  ADD COLUMN show_sample_type boolean NOT NULL DEFAULT false,
  ADD COLUMN is_default boolean NOT NULL DEFAULT false,
  ADD COLUMN archived_at timestamptz,
  ADD CONSTRAINT chk_label_templates_width CHECK (width_mm BETWEEN 10 AND 200),
  ADD CONSTRAINT chk_label_templates_height CHECK (height_mm BETWEEN 10 AND 200),
  ADD CONSTRAINT chk_label_templates_barcode CHECK (barcode_type IN ('qr', 'code128'));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_label_templates_default_kind
  ON api.label_templates (workspace_id, record_kind)
  WHERE is_default AND archived_at IS NULL;
--> statement-breakpoint
-- Writes to the hierarchy follow the same rule as the page.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'storage_sites', 'storage_rooms', 'storage_units',
    'storage_shelves', 'storage_racks', 'storage_boxes'
  ] LOOP
    EXECUTE format('DROP POLICY %I ON api.%I', t || '_insert_writer', t);
    EXECUTE format('DROP POLICY %I ON api.%I', t || '_update_writer', t);
    EXECUTE format('DROP POLICY %I ON api.%I', t || '_delete_writer', t);
    EXECUTE format(
      'CREATE POLICY %I ON api.%I FOR INSERT TO authenticated WITH CHECK (api.has_capability(workspace_id, ''settings.storage.manage''))',
      t || '_insert_manager', t);
    EXECUTE format(
      'CREATE POLICY %I ON api.%I FOR UPDATE TO authenticated USING (api.has_capability(workspace_id, ''settings.storage.manage'')) WITH CHECK (api.has_capability(workspace_id, ''settings.storage.manage''))',
      t || '_update_manager', t);
    EXECUTE format(
      'CREATE POLICY %I ON api.%I FOR DELETE TO authenticated USING (api.has_capability(workspace_id, ''settings.storage.manage''))',
      t || '_delete_manager', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Boxes come with their positions, so they are made through this function.
CREATE OR REPLACE FUNCTION api.create_storage_box(p_workspace_id uuid, p_rack_id uuid, p_name text, p_code text, p_rows integer, p_cols integer, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS api.storage_boxes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_box "api"."storage_boxes";
  v_rack "api"."storage_racks";
  r integer;
  c integer;
BEGIN
  IF p_rows IS NULL OR p_cols IS NULL OR p_rows < 1 OR p_cols < 1
     OR p_rows > 26 OR p_cols > 26 THEN
    RAISE EXCEPTION 'rows and cols must be between 1 and 26' USING ERRCODE = 'SB005';
  END IF;
  IF NOT api.has_capability(p_workspace_id, 'settings.storage.manage') THEN
    RAISE EXCEPTION 'managing storage needs access to Storage and labels' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rack FROM "api"."storage_racks" WHERE id = p_rack_id FOR UPDATE;
  IF v_rack IS NULL THEN
    RAISE EXCEPTION 'rack not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_rack.workspace_id <> p_workspace_id THEN
    RAISE EXCEPTION 'rack does not belong to this workspace' USING ERRCODE = '42501';
  END IF;

  INSERT INTO "api"."storage_boxes"
    (workspace_id, rack_id, name, code, rows, cols, capacity, metadata)
  VALUES
    (p_workspace_id, p_rack_id, p_name, p_code, p_rows, p_cols,
     p_rows * p_cols, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING * INTO v_box;

  r := 0;
  WHILE r < p_rows LOOP
    c := 0;
    WHILE c < p_cols LOOP
      INSERT INTO "api"."storage_positions"
        (workspace_id, box_id, row_index, col_index, label, status)
      VALUES
        (p_workspace_id, v_box.id, r, c, chr(65 + r) || (c + 1)::text, 'available');
      c := c + 1;
    END LOOP;
    r := r + 1;
  END LOOP;

  RETURN v_box;
END;
$$;
--> statement-breakpoint
-- A location that holds a sample is never archived or deleted.
CREATE FUNCTION internal.guard_storage_removal() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_held integer;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.archived_at IS NULL OR OLD.archived_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_held
    FROM api.storage_positions p
    JOIN api.storage_boxes b ON b.id = p.box_id
    JOIN api.storage_racks k ON k.id = b.rack_id
    JOIN api.storage_shelves s ON s.id = k.shelf_id
    JOIN api.storage_units u ON u.id = s.unit_id
    JOIN api.storage_rooms m ON m.id = u.room_id
   WHERE p.occupied_record_id IS NOT NULL
     AND CASE TG_TABLE_NAME
       WHEN 'storage_boxes' THEN b.id = OLD.id
       WHEN 'storage_racks' THEN k.id = OLD.id
       WHEN 'storage_shelves' THEN s.id = OLD.id
       WHEN 'storage_units' THEN u.id = OLD.id
       WHEN 'storage_rooms' THEN m.id = OLD.id
       WHEN 'storage_sites' THEN m.site_id = OLD.id
       ELSE false
     END;
  IF v_held > 0 THEN
    RAISE EXCEPTION 'this location holds % sample(s); move them first', v_held
      USING ERRCODE = 'SB015';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.guard_storage_removal() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER storage_sites_guard_removal BEFORE DELETE OR UPDATE OF archived_at ON api.storage_sites FOR EACH ROW EXECUTE FUNCTION internal.guard_storage_removal();
--> statement-breakpoint
CREATE TRIGGER storage_rooms_guard_removal BEFORE DELETE OR UPDATE OF archived_at ON api.storage_rooms FOR EACH ROW EXECUTE FUNCTION internal.guard_storage_removal();
--> statement-breakpoint
CREATE TRIGGER storage_units_guard_removal BEFORE DELETE OR UPDATE OF archived_at ON api.storage_units FOR EACH ROW EXECUTE FUNCTION internal.guard_storage_removal();
--> statement-breakpoint
CREATE TRIGGER storage_shelves_guard_removal BEFORE DELETE OR UPDATE OF archived_at ON api.storage_shelves FOR EACH ROW EXECUTE FUNCTION internal.guard_storage_removal();
--> statement-breakpoint
CREATE TRIGGER storage_racks_guard_removal BEFORE DELETE OR UPDATE OF archived_at ON api.storage_racks FOR EACH ROW EXECUTE FUNCTION internal.guard_storage_removal();
--> statement-breakpoint
CREATE TRIGGER storage_boxes_guard_removal BEFORE DELETE OR UPDATE OF archived_at ON api.storage_boxes FOR EACH ROW EXECUTE FUNCTION internal.guard_storage_removal();
--> statement-breakpoint
-- A sample cannot be put into an archived box, rack, shelf, freezer, room or site.
CREATE FUNCTION internal.guard_archived_position() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.occupied_record_id IS NULL
     OR NEW.occupied_record_id IS NOT DISTINCT FROM OLD.occupied_record_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM api.storage_boxes b
      JOIN api.storage_racks k ON k.id = b.rack_id
      JOIN api.storage_shelves s ON s.id = k.shelf_id
      JOIN api.storage_units u ON u.id = s.unit_id
      JOIN api.storage_rooms m ON m.id = u.room_id
      JOIN api.storage_sites t ON t.id = m.site_id
     WHERE b.id = NEW.box_id
       AND (b.archived_at IS NOT NULL OR k.archived_at IS NOT NULL
         OR s.archived_at IS NOT NULL OR u.archived_at IS NOT NULL
         OR m.archived_at IS NOT NULL OR t.archived_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'this location is archived' USING ERRCODE = 'SB013';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.guard_archived_position() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER storage_positions_guard_archived BEFORE UPDATE OF occupied_record_id ON api.storage_positions FOR EACH ROW EXECUTE FUNCTION internal.guard_archived_position();
--> statement-breakpoint
-- Label templates are saved through these, so the creator is stamped by the
-- server and the access rule is the page's.
CREATE FUNCTION api.save_label_template(
  p_workspace_id uuid,
  p_id uuid,
  p_name text,
  p_record_kind text,
  p_width_mm integer,
  p_height_mm integer,
  p_barcode_type text,
  p_show_lot boolean,
  p_show_sample_type boolean,
  p_show_condition boolean,
  p_show_use_by boolean,
  p_is_default boolean
) RETURNS api.label_templates
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.label_templates;
BEGIN
  IF NOT api.has_capability(p_workspace_id, 'settings.storage.manage') THEN
    RAISE EXCEPTION 'managing label templates needs access to Storage and labels' USING ERRCODE = '42501';
  END IF;
  IF p_is_default THEN
    UPDATE api.label_templates
       SET is_default = false, updated_at = now()
     WHERE workspace_id = p_workspace_id
       AND record_kind = p_record_kind
       AND is_default
       AND id IS DISTINCT FROM p_id;
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO api.label_templates (
      workspace_id, name, record_kind, width_mm, height_mm, barcode_type,
      show_lot, show_sample_type, show_condition, show_use_by, is_default,
      created_by_user_id
    ) VALUES (
      p_workspace_id, btrim(p_name), btrim(p_record_kind), p_width_mm, p_height_mm,
      p_barcode_type, p_show_lot, p_show_sample_type, p_show_condition,
      p_show_use_by, p_is_default, api.current_user_id()
    ) RETURNING * INTO v_row;
  ELSE
    UPDATE api.label_templates
       SET name = btrim(p_name), record_kind = btrim(p_record_kind),
           width_mm = p_width_mm, height_mm = p_height_mm,
           barcode_type = p_barcode_type, show_lot = p_show_lot,
           show_sample_type = p_show_sample_type,
           show_condition = p_show_condition, show_use_by = p_show_use_by,
           is_default = p_is_default, updated_at = now()
     WHERE id = p_id AND workspace_id = p_workspace_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'label template not found' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN v_row;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.save_label_template(uuid, uuid, text, text, integer, integer, text, boolean, boolean, boolean, boolean, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_label_template(uuid, uuid, text, text, integer, integer, text, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.save_label_template(uuid, uuid, text, text, integer, integer, text, boolean, boolean, boolean, boolean, boolean) TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.set_label_template_archived(p_template_id uuid, p_archived boolean) RETURNS api.label_templates
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.label_templates;
BEGIN
  SELECT * INTO v_row FROM api.label_templates WHERE id = p_template_id;
  IF v_row.id IS NULL OR NOT api.has_capability(v_row.workspace_id, 'settings.storage.manage') THEN
    RAISE EXCEPTION 'managing label templates needs access to Storage and labels' USING ERRCODE = '42501';
  END IF;
  UPDATE api.label_templates
     SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END,
         is_default = CASE WHEN p_archived THEN false ELSE is_default END,
         updated_at = now()
   WHERE id = p_template_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.set_label_template_archived(uuid, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_label_template_archived(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_label_template_archived(uuid, boolean) TO authenticated;
