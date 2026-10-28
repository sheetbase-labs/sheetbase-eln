-- The Experiments tab strip asked PostgREST for nine separate counts, one
-- request per tab, on every visit. One grouped read gives the same numbers:
-- experiments per status, split into live and archived, with how many of the
-- live ones the caller created. The app maps statuses to tabs, so the status
-- table stays in one place. Runs as the caller, so row security still decides
-- which experiments are counted.

CREATE FUNCTION api.experiment_tab_counts(p_user_id text DEFAULT NULL::text) RETURNS TABLE(status text, archived boolean, total integer, mine integer)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT r.status,
         r.archived_at IS NOT NULL,
         count(*)::int,
         (count(*) FILTER (WHERE r.created_by_user_id = p_user_id))::int
  FROM api.records r
  WHERE r.kind = 'experiment' AND r.deleted_at IS NULL
  GROUP BY r.status, r.archived_at IS NOT NULL
$$;
--> statement-breakpoint
ALTER FUNCTION api.experiment_tab_counts(p_user_id text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.experiment_tab_counts(p_user_id text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.experiment_tab_counts(p_user_id text) TO authenticated;
