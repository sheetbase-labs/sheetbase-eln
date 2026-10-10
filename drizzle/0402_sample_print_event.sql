-- LAB-05.2 — printing a label is its own event.
--
-- The print was recorded through `edit_sample` with a note, because
-- `sample_events.operation` had no value for it. That records *something*, but the
-- sample's History showed it as "Edited", which is not what happened: printing a label
-- changes nothing about the sample.
--
-- Adding the operation lets the print be recorded as itself, with the history reading
-- "Printed label". No quantity moves, so the event carries no quantity delta (the
-- existing check already allows that for transfer/edit/archive).

ALTER TABLE api.sample_events DROP CONSTRAINT chk_sample_events_operation;
--> statement-breakpoint
ALTER TABLE api.sample_events
  ADD CONSTRAINT chk_sample_events_operation CHECK (
    operation IN (
      'create', 'receive', 'consume', 'transfer', 'edit', 'archive', 'restore',
      'hold_exceeded', 'quarantine', 'release', 'dispose', 'print'
    )
  );
--> statement-breakpoint

-- Records the print on the sample. A dedicated RPC rather than a general one so the
-- event cannot be written with a quantity or an operation the caller chose.
CREATE OR REPLACE FUNCTION api.record_sample_label_print(
  p_record_id uuid,
  p_expected_metadata_version bigint,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_record api.records;
  v_event api.sample_events;
BEGIN
  SELECT * INTO v_record FROM api.records WHERE id = p_record_id FOR UPDATE;
  IF v_record.id IS NULL OR v_record.kind <> 'sample' THEN
    RAISE EXCEPTION 'Unknown sample' USING ERRCODE = '22023';
  END IF;
  IF NOT api.is_workspace_writer(v_record.workspace_id) THEN
    RAISE EXCEPTION 'workspace writer required' USING ERRCODE = '42501';
  END IF;
  IF p_expected_metadata_version IS NOT NULL
     AND v_record.metadata_version IS DISTINCT FROM p_expected_metadata_version THEN
    RAISE EXCEPTION 'the sample changed since you loaded it' USING ERRCODE = '40001';
  END IF;

  INSERT INTO api.sample_events(
    workspace_id, record_id, operation, actor_user_id, notes
  ) VALUES (
    v_record.workspace_id, p_record_id, 'print', api.current_user_id(),
    nullif(btrim(coalesce(p_note, '')), '')
  ) RETURNING * INTO v_event;

  PERFORM internal.emit_change_event(
    v_record.workspace_id, 'sample_event', v_event.id, 'create',
    v_record.id, v_record.project_id,
    jsonb_build_object('operation', 'print', 'note', v_event.notes)
  );

  RETURN to_jsonb(v_event);
END $function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.record_sample_label_print(uuid, bigint, text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.record_sample_label_print(uuid, bigint, text) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
