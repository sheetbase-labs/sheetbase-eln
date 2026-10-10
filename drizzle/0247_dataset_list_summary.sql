-- UI port (DSET-02.1) — one read for the dataset registry.
--
-- SECURITY INVOKER keeps the caller's datasets/rows/flags RLS for every
-- aggregate.

CREATE FUNCTION api.dataset_list_summary()
RETURNS TABLE(
  id uuid,
  display_id text,
  name text,
  model text,
  project_id uuid,
  created_by_user_id text,
  row_count bigint,
  issue_count bigint,
  updated_at timestamptz,
  archived_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, api
AS $$
  SELECT d.id, d.display_id, d.name, sd.name, d.primary_project_id,
    d.created_by_user_id,
    (SELECT count(*) FROM api.dataset_rows r WHERE r.dataset_id = d.id),
    (SELECT count(*) FROM api.dataset_value_flags f
      WHERE f.dataset_id = d.id AND f.cleared_at IS NULL),
    d.updated_at, d.archived_at
  FROM api.datasets d
  LEFT JOIN api.dataset_schema_versions sv ON sv.id = d.schema_version_id
  LEFT JOIN api.dataset_schema_definitions sd ON sd.id = sv.schema_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.dataset_list_summary() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.dataset_list_summary() TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
