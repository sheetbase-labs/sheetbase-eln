-- PROJ-01.2 — the project registry carries the design's columns.

DROP FUNCTION IF EXISTS api.project_list_summary();
--> statement-breakpoint
CREATE FUNCTION api.project_list_summary()
RETURNS TABLE (
  id uuid, workspace_id uuid, key text, title text, status text,
  display_id text, client_id uuid, client_code text, client_name text,
  modality text, stage text, lead_user_id text, default_reviewer_user_id text,
  agreement_reference text, started_on date, revision bigint,
  created_at timestamptz, updated_at timestamptz, archived_at timestamptz,
  record_count bigint, experiment_count bigint, last_activity_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, api
AS $$
  SELECT p.id, p.workspace_id, p.key, p.title, p.status,
    p.display_id, p.client_id, c.code, c.name,
    p.modality, p.stage, p.lead_user_id, p.default_reviewer_user_id,
    p.agreement_reference, p.started_on, p.revision,
    p.created_at, p.updated_at, p.archived_at,
    coalesce(r.record_count, 0), coalesce(r.experiment_count, 0), a.last_activity_at
  FROM api.projects p
  LEFT JOIN api.clients c ON c.id = p.client_id
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
