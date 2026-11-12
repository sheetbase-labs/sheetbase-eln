-- Pipelines: the snapshots a pipeline's snapshot starts heard, with the rows
-- each added, so "Test against the last 7 days" on Starts and runs can say what
-- the rules would have done. Read-only: for each snapshot start (an event
-- schedule on dataset.versioned) it lists the snapshots made in the last
-- `p_days` days that the start's dataset and instrument filters let through.
CREATE FUNCTION api.pipeline_start_events(
  p_workspace_id uuid,
  p_definition_id uuid,
  p_days integer DEFAULT 7
) RETURNS TABLE (
  schedule_id uuid,
  event_id uuid,
  occurred_at timestamp with time zone,
  dataset_id uuid,
  dataset_display_id text,
  version_label text,
  new_rows integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace member' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 90 THEN
    RAISE EXCEPTION 'p_days must be from 1 to 90' USING ERRCODE = 'SB034';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.pipeline_definitions
     WHERE id = p_definition_id AND workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'pipeline definition not found' USING ERRCODE = 'SB036';
  END IF;
  RETURN QUERY
  SELECT s.id, e.id, e.created_at, d.id, d.display_id, v.label,
         internal.dataset_version_new_rows(v.id)
    FROM api.pipeline_schedules s
    JOIN api.change_events e
      ON e.workspace_id = s.workspace_id
     AND e.entity_type = 'dataset_version'
     AND e.operation = 'create'
     AND e.created_at >= now() - make_interval(days => p_days)
    JOIN api.dataset_versions v ON v.id = e.entity_uuid
    JOIN api.datasets d ON d.id = v.dataset_id
   WHERE s.definition_id = p_definition_id
     AND s.workspace_id = p_workspace_id
     AND s.kind = 'event'
     AND s.spec->>'eventType' IN ('dataset.versioned', 'dataset_version_created')
     AND (s.spec->>'datasetId' IS NULL
          OR (s.spec->>'datasetId')::uuid = v.dataset_id)
     AND (s.spec->>'instrumentId' IS NULL
          OR EXISTS (
            SELECT 1 FROM api.dataset_imports di
             WHERE di.snapshot_version_id = v.id
               AND di.instrument_id = (s.spec->>'instrumentId')::uuid))
   ORDER BY e.created_at, s.id;
END $$;
--> statement-breakpoint

ALTER FUNCTION api.pipeline_start_events(uuid, uuid, integer) OWNER TO migrator;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.pipeline_start_events(uuid, uuid, integer) FROM PUBLIC;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION api.pipeline_start_events(uuid, uuid, integer)
  TO authenticated, api_client;
