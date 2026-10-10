-- PROJ-01.3 — project change events carry archivedAt so archive and unarchive
-- stay distinguishable now that status is preserved.

CREATE OR REPLACE FUNCTION internal.trg_change_event_projects()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_op text;
  v_payload jsonb;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    v_op := 'create';
    v_payload := jsonb_build_object('key', NEW.key, 'title', NEW.title, 'status', NEW.status, 'archivedAt', NEW.archived_at);
  ELSIF (TG_OP = 'UPDATE') THEN
    v_op := 'update';
    v_payload := jsonb_build_object('key', NEW.key, 'title', NEW.title, 'status', NEW.status, 'archivedAt', NEW.archived_at);
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM internal.emit_change_event(
      OLD.workspace_id, 'project', OLD.id, 'delete', NULL, OLD.id,
      jsonb_build_object('key', OLD.key, 'title', OLD.title)
    );
    RETURN NULL;
  END IF;
  PERFORM internal.emit_change_event(
    NEW.workspace_id, 'project', NEW.id, v_op, NULL, NEW.id, v_payload
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
