-- The Projects list took about a second because "last activity" grouped every
-- change event the person may read, and each one runs the full access check.
-- Ask for each project's newest readable event instead: the check stops at the
-- first event that passes, so the same answer costs a few milliseconds.
CREATE INDEX IF NOT EXISTS idx_change_events_project_created
  ON api.change_events USING btree (project_id, created_at DESC);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.project_list_summary()
 RETURNS TABLE(id uuid, workspace_id uuid, key text, title text, status text, display_id text, client_id uuid, client_code text, client_name text, modality text, stage text, lead_user_id text, lead_name text, default_reviewer_user_id text, agreement_reference text, started_on date, revision bigint, created_at timestamp with time zone, updated_at timestamp with time zone, archived_at timestamp with time zone, record_count bigint, experiment_count bigint, last_activity_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'api'
AS $function$
  SELECT p.id, p.workspace_id, p.key, p.title, p.status,
    p.display_id, p.client_id, c.code, c.name,
    p.modality, p.stage, p.lead_user_id,
    api.workspace_member_label(p.lead_user_id),
    p.default_reviewer_user_id, p.agreement_reference, p.started_on, p.revision,
    p.created_at, p.updated_at, p.archived_at,
    coalesce(r.record_count, 0), coalesce(r.experiment_count, 0), a.last_activity_at
  FROM api.projects p
  LEFT JOIN api.clients c ON c.id = p.client_id
  LEFT JOIN (
    SELECT project_id, count(*) AS record_count,
      count(*) FILTER (WHERE kind = 'experiment') AS experiment_count
    FROM api.records WHERE archived_at IS NULL GROUP BY project_id
  ) r ON r.project_id = p.id
  LEFT JOIN LATERAL (
    SELECT e.created_at AS last_activity_at
    FROM api.change_events e
    WHERE e.project_id = p.id
    ORDER BY e.created_at DESC
    LIMIT 1
  ) a ON true
$function$;
