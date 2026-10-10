-- LAB-06.1 — instrument rename and move history, with the signed-name rule.
--
-- The design's RecordInstrument board shows an instrument's name and location
-- history, and the signed-text rule says evidence keeps the name captured at
-- signing with the current name beside it. The generic instrument trigger
-- emitted the whole new row, so an old value was never recorded: this replaces it
-- for instruments with a field-level event (name, location, qualified-for) and
-- exposes the history the page and the evidence views read.
DROP TRIGGER IF EXISTS change_event_instruments ON api.instruments;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.instrument_change_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_changes jsonb := '{}'::jsonb;
  v_from text;
  v_to text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM internal.emit_change_event(NEW.workspace_id, 'instrument', NEW.id, 'create', NULL, NULL,
      jsonb_build_object('name', NEW.name, 'location', NEW.location,
        'qualifiedFor', NEW.qualified_for));
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM internal.emit_change_event(OLD.workspace_id, 'instrument', OLD.id, 'delete', NULL, NULL,
      jsonb_build_object('name', OLD.name, 'location', OLD.location));
    RETURN NULL;
  END IF;

  -- Only the fields the board tracks; an untouched update is not history.
  FOREACH v_from IN ARRAY ARRAY['name', 'location', 'qualified_for'] LOOP
    v_to := to_jsonb(NEW)->>v_from;
    IF v_to IS DISTINCT FROM (to_jsonb(OLD)->>v_from) THEN
      v_changes := v_changes || jsonb_build_object(v_from,
        jsonb_build_object('from', to_jsonb(OLD)->>v_from, 'to', v_to,
          'label', CASE v_from
            WHEN 'name' THEN 'Name'
            WHEN 'location' THEN 'Location'
            ELSE 'Qualified for' END));
    END IF;
  END LOOP;
  IF v_changes = '{}'::jsonb THEN
    RETURN NULL;
  END IF;
  PERFORM internal.emit_change_event(NEW.workspace_id, 'instrument', NEW.id, 'update', NULL, NULL,
    jsonb_build_object('effect', 'renamed_or_moved', 'changes', v_changes));
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.instrument_change_event() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

CREATE TRIGGER instrument_change_event AFTER INSERT OR UPDATE OR DELETE ON api.instruments
  FOR EACH ROW EXECUTE FUNCTION internal.instrument_change_event();
--> statement-breakpoint

-- The instrument's name and location history, newest first.
CREATE OR REPLACE FUNCTION api.instrument_history(p_instrument_id uuid)
RETURNS TABLE(
  event_id uuid,
  at timestamp with time zone,
  actor_user_id text,
  operation text,
  from_name text,
  to_name text,
  from_location text,
  to_location text,
  qualified_for text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e.id, e.created_at, e.actor_user_id, e.operation,
         e.payload->'changes'->'name'->>'from',
         coalesce(e.payload->'changes'->'name'->>'to', e.payload->>'name'),
         e.payload->'changes'->'location'->>'from',
         coalesce(e.payload->'changes'->'location'->>'to', e.payload->>'location'),
         coalesce(e.payload->'changes'->'qualified_for'->>'to', e.payload->>'qualifiedFor')
    FROM api.change_events e
    JOIN api.instruments i ON i.id = e.entity_uuid AND i.workspace_id = e.workspace_id
   WHERE e.entity_type = 'instrument'
     AND e.entity_uuid = p_instrument_id
     AND e.workspace_id = api.current_workspace_id()
     AND api.is_workspace_member(e.workspace_id)
     AND internal.can_read_change_event(e)
   ORDER BY e.sequence DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.instrument_history(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.instrument_history(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
