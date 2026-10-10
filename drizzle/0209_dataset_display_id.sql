-- DSET display id — a stable per-workspace DS-nnnn for every dataset.
--
-- Assigned on insert when not provided; the workspace row is locked to
-- serialise allocation, and the id is immutable thereafter (never reused).

CREATE OR REPLACE FUNCTION internal.assign_dataset_display_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_next integer;
BEGIN
  IF NEW.display_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM api.workspaces WHERE id = NEW.workspace_id FOR UPDATE;
  SELECT coalesce(max(substring(display_id FROM '^DS-([0-9]+)$')::int), 0) + 1
    INTO v_next
    FROM api.datasets
    WHERE workspace_id = NEW.workspace_id AND display_id IS NOT NULL;
  NEW.display_id := 'DS-' || lpad(v_next::text, 4, '0');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assign_dataset_display_id
BEFORE INSERT ON api.datasets
FOR EACH ROW EXECUTE FUNCTION internal.assign_dataset_display_id();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.prevent_dataset_display_id_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Immutable once set; a null display_id may be assigned once (backfill).
  IF OLD.display_id IS NOT NULL
     AND NEW.display_id IS DISTINCT FROM OLD.display_id THEN
    RAISE EXCEPTION 'dataset display id is immutable' USING ERRCODE = 'SB072';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER prevent_dataset_display_id_change
BEFORE UPDATE ON api.datasets
FOR EACH ROW EXECUTE FUNCTION internal.prevent_dataset_display_id_change();
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
