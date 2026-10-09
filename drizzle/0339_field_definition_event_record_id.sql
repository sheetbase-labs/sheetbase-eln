-- SCI-001 / GOV-03 — a field-definition event is not a record event.
--
-- `internal.trg_change_event_record_field_definitions` passed the definition's
-- own id as the event's `record_id`. `internal.can_read_change_event` treats a
-- non-null `record_id` as a Record ownership hint and hides the event when that
-- Record is not readable — and a field-definition id is never a Record id, so
-- every definition create/update event was invisible to every reader. The
-- event now carries no record id; the definition id remains the entity id.
DO $$ DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('internal.trg_change_event_record_field_definitions()'::regprocedure);

  IF strpos(definition, '    COALESCE(NEW.id, OLD.id),
    v_op,
    COALESCE(NEW.id, OLD.id),
    NULL,') = 0 THEN
    RAISE EXCEPTION 'field-definition event anchor missing';
  END IF;

  definition := replace(
    definition,
    '    COALESCE(NEW.id, OLD.id),
    v_op,
    COALESCE(NEW.id, OLD.id),
    NULL,',
    '    COALESCE(NEW.id, OLD.id),
    v_op,
    NULL,
    NULL,'
  );

  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
