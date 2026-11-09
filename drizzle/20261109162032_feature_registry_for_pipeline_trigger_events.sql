-- The events a pipeline may be triggered by become a table, so a feature's
-- migration adds rows instead of rewriting api.normalize_pipeline_event_type,
-- which every feature with events used to patch (docs/development/features.md).
-- Seeded from the function as it stands, so the accepted names do not change.
-- The old wire aliases stay in the function.

CREATE TABLE internal.pipeline_trigger_events (
    name text PRIMARY KEY,
    CONSTRAINT chk_pipeline_trigger_events_name CHECK (name ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);
ALTER TABLE internal.pipeline_trigger_events OWNER TO migrator;
COMMENT ON TABLE internal.pipeline_trigger_events IS
  'Events a pipeline may be triggered by. Mirrors PIPELINE_TRIGGER_EVENTS in src/lib/pipeline-schedule.ts; each feature''s migration adds its own.';

DO $$
DECLARE
  v_def text;
  v_start int;
  v_end int;
  v_list text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  v_start := position('IF p_event IN (' IN v_def);
  v_end := position(') THEN' IN substring(v_def FROM v_start));
  IF v_start = 0 OR v_end = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_list := substring(v_def FROM v_start FOR v_end + length(') THEN') - 1);

  INSERT INTO internal.pipeline_trigger_events (name)
  SELECT match[1]
  FROM regexp_matches(regexp_replace(v_list, '--[^\n]*', '', 'g'), '''([^'']+)''', 'g') AS match
  ON CONFLICT (name) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM internal.pipeline_trigger_events WHERE name = 'record.created') THEN
    RAISE EXCEPTION 'could not read the trigger events from api.normalize_pipeline_event_type';
  END IF;

  v_def := replace(v_def, v_list,
    'IF EXISTS (SELECT 1 FROM internal.pipeline_trigger_events WHERE name = p_event) THEN');
  -- It reads a table now: stable, and run as its owner so every caller can.
  v_def := replace(v_def, E'\n IMMUTABLE\n', E'\n STABLE SECURITY DEFINER\n');
  IF position('STABLE SECURITY DEFINER' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected volatility on api.normalize_pipeline_event_type';
  END IF;
  EXECUTE v_def;
END $$;

-- It calls the function above, so it can no longer say it never reads data.
ALTER FUNCTION api.validate_pipeline_event_spec(jsonb) STABLE;
