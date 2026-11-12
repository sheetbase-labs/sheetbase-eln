-- The change-event type the Inbox item trigger writes.
DO $$
DECLARE
  v_def text;
  v_type text := 'pipeline_inbox_item';
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  IF position('''' || v_type || '''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''' || v_type || '''::text]');
  END IF;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

-- A pipeline can start when an Inbox item is left: the database's list of
-- trigger events learns the new one.
INSERT INTO internal.pipeline_trigger_events (name) VALUES
  ('pipeline.inbox_item.created')
ON CONFLICT DO NOTHING;
