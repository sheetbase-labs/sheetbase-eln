-- LAB-06 — a stable per-workspace INS-nnnn display id for instruments.

CREATE OR REPLACE FUNCTION internal.assign_instrument_display_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_next integer;
BEGIN
  IF NEW.display_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM api.workspaces WHERE id = NEW.workspace_id FOR UPDATE;
  SELECT coalesce(max(substring(display_id FROM '^INS-([0-9]+)$')::int), 0) + 1
    INTO v_next
    FROM api.instruments
    WHERE workspace_id = NEW.workspace_id AND display_id IS NOT NULL;
  NEW.display_id := 'INS-' || lpad(v_next::text, 4, '0');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assign_instrument_display_id
BEFORE INSERT ON api.instruments
FOR EACH ROW EXECUTE FUNCTION internal.assign_instrument_display_id();
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
