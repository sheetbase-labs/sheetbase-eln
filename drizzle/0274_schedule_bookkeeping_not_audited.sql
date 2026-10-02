-- AUDIT noise: a pipeline schedule's next_run_at / last_run_at /
-- last_evaluated_at / last_evaluated_sequence are the sweep's bookkeeping, not
-- a user change. Emitting a change event for every tick floods the audit log
-- (and hides real operations). Skip the event when only those columns moved.

CREATE OR REPLACE FUNCTION internal.trg_change_event_connector()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entity text;
  v_op text;
  v_payload jsonb;
  v_before jsonb;
  v_after jsonb;
BEGIN
  v_entity := TG_ARGV[0];
  CASE TG_OP
    WHEN 'INSERT' THEN v_op := 'create'; v_payload := to_jsonb(NEW) - 'metadata';
    WHEN 'UPDATE' THEN v_op := 'update'; v_payload := to_jsonb(NEW) - 'metadata';
    WHEN 'DELETE' THEN v_op := 'delete'; v_payload := to_jsonb(OLD) - 'metadata';
  END CASE;
  IF v_entity = 'pipeline_schedule' AND TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD) - 'metadata' - 'next_run_at' - 'last_run_at'
      - 'last_evaluated_at' - 'last_evaluated_sequence' - 'updated_at';
    v_after := to_jsonb(NEW) - 'metadata' - 'next_run_at' - 'last_run_at'
      - 'last_evaluated_at' - 'last_evaluated_sequence' - 'updated_at';
    IF v_before = v_after THEN
      RETURN NULL;
    END IF;
  END IF;
  PERFORM internal.emit_change_event(
    COALESCE(NEW.workspace_id, OLD.workspace_id),
    v_entity,
    COALESCE(NEW.id, OLD.id),
    v_op,
    NULL,
    NULL,
    v_payload
  );
  RETURN NULL;
END $$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
