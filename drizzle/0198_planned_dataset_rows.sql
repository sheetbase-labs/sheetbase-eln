-- DSET-01.3 — planned rows.
--
-- A planned row (a requested repeat) is created with a scheduled time and no
-- values; it is shown as pending until its values are recorded. The row's
-- status is `planned`; until it is recorded it cannot hold values.

CREATE OR REPLACE FUNCTION api.plan_dataset_row(
  p_dataset_id uuid,
  p_scheduled_at timestamptz DEFAULT NULL
)
RETURNS api.dataset_rows
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  d api.datasets;
  v api.dataset_rows;
BEGIN
  SELECT * INTO d FROM api.datasets
    WHERE id = p_dataset_id AND workspace_id = api.current_workspace_id()
      AND api.is_workspace_writer(workspace_id) AND api.has_write_actor()
    FOR UPDATE;
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'Dataset denied' USING ERRCODE = '42501';
  END IF;
  IF d.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'cannot plan rows in an archived Dataset' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.dataset_rows (dataset_id, workspace_id, status, scheduled_at)
  VALUES (d.id, d.workspace_id, 'planned', p_scheduled_at)
  RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.plan_dataset_row(uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.plan_dataset_row(uuid, timestamptz) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.assert_dataset_row_recorded()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM api.dataset_rows WHERE id = NEW.row_id;
  IF v_status = 'planned' THEN
    RAISE EXCEPTION 'planned rows cannot hold values' USING ERRCODE = 'SB072';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assert_dataset_row_recorded
BEFORE INSERT OR UPDATE ON api.dataset_row_values
FOR EACH ROW EXECUTE FUNCTION internal.assert_dataset_row_recorded();
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
