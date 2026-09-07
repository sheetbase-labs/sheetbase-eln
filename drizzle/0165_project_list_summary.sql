-- A single read for the project registry. SECURITY INVOKER preserves the
-- caller's project, record and change-event RLS boundaries for every aggregate.
CREATE FUNCTION api.project_list_summary()
RETURNS TABLE (
  id uuid, workspace_id uuid, key text, title text, status text,
  created_at timestamptz, updated_at timestamptz, archived_at timestamptz,
  record_count bigint, experiment_count bigint, last_activity_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, api
AS $$
  SELECT p.id, p.workspace_id, p.key, p.title, p.status,
    p.created_at, p.updated_at, p.archived_at,
    coalesce(r.record_count, 0), coalesce(r.experiment_count, 0), a.last_activity_at
  FROM api.projects p
  LEFT JOIN (
    SELECT project_id, count(*) AS record_count,
      count(*) FILTER (WHERE kind = 'experiment') AS experiment_count
    FROM api.records WHERE archived_at IS NULL GROUP BY project_id
  ) r ON r.project_id = p.id
  LEFT JOIN (
    SELECT project_id, max(created_at) AS last_activity_at
    FROM api.change_events GROUP BY project_id
  ) a ON a.project_id = p.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.project_list_summary() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.project_list_summary() TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
