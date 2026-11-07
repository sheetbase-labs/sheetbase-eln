-- A gate that waits on the cells of a sheet that reads a dataset opens (and
-- closes again) the moment the dataset's cells or rows change, not only when
-- the sheet itself is saved.

CREATE FUNCTION internal.refresh_gates_for_dataset(p_dataset_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record uuid;
BEGIN
  FOR v_record IN
    SELECT DISTINCT b.record_id
      FROM api.blocks g
      JOIN api.blocks b ON b.record_id = g.record_id AND b.type = 'sheet'
      JOIN api.sheet_instances i ON i.id = internal.gate_uuid(b.payload->>'instanceId')
     WHERE g.type = 'gate'
       AND i.state->'bindings' @> jsonb_build_array(jsonb_build_object('kind', 'dataset', 'datasetId', p_dataset_id::text))
  LOOP
    PERFORM internal.refresh_record_gates(v_record);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.refresh_gates_for_dataset(p_dataset_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.refresh_gates_for_dataset(p_dataset_id uuid) FROM PUBLIC;
--> statement-breakpoint

-- Cells: the changed rows say which datasets to look at.
CREATE FUNCTION internal.trg_refresh_gates_from_dataset_values() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_dataset uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM api.blocks WHERE type = 'gate') THEN
    RETURN NULL;
  END IF;
  FOR v_dataset IN SELECT DISTINCT r.dataset_id FROM changed c JOIN api.dataset_rows r ON r.id = c.row_id LOOP
    PERFORM internal.refresh_gates_for_dataset(v_dataset);
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_refresh_gates_from_dataset_values() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.trg_refresh_gates_from_dataset_values() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER refresh_gates_dataset_values_insert AFTER INSERT ON api.dataset_row_values
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION internal.trg_refresh_gates_from_dataset_values();
--> statement-breakpoint
CREATE TRIGGER refresh_gates_dataset_values_update AFTER UPDATE ON api.dataset_row_values
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION internal.trg_refresh_gates_from_dataset_values();
--> statement-breakpoint
CREATE TRIGGER refresh_gates_dataset_values_delete AFTER DELETE ON api.dataset_row_values
  REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION internal.trg_refresh_gates_from_dataset_values();
--> statement-breakpoint

-- Rows: adding or removing a row changes how many there are to fill.
CREATE FUNCTION internal.trg_refresh_gates_from_dataset_rows() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_dataset uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM api.blocks WHERE type = 'gate') THEN
    RETURN NULL;
  END IF;
  FOR v_dataset IN SELECT DISTINCT dataset_id FROM changed LOOP
    PERFORM internal.refresh_gates_for_dataset(v_dataset);
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_refresh_gates_from_dataset_rows() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.trg_refresh_gates_from_dataset_rows() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER refresh_gates_dataset_rows_insert AFTER INSERT ON api.dataset_rows
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION internal.trg_refresh_gates_from_dataset_rows();
--> statement-breakpoint
CREATE TRIGGER refresh_gates_dataset_rows_delete AFTER DELETE ON api.dataset_rows
  REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION internal.trg_refresh_gates_from_dataset_rows();
--> statement-breakpoint
