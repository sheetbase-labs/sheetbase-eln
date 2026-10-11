-- R5-SURF-02 — the dataset read model gains a project filter and a page.
--
-- The project Datasets tab lists one project's datasets; filtering that in the
-- browser over the global registry would leak every other project's rows and
-- is never allowed. The filter therefore runs here, at the canonical boundary,
-- against `api.datasets.primary_project_id` — the project-scoped column the
-- dataset RLS, global search and inbox already use.
--
-- `p_include_archived` defaults to true so the global registry (which shows
-- archived datasets) is unchanged; the project tab asks for the active set.
-- `p_limit`/`p_offset` default to "all rows from the start" so existing callers
-- that pass no arguments keep returning the whole registry.
--
-- SECURITY INVOKER keeps the caller's datasets/rows/flags/links/records RLS for
-- every column, including the project filter.

-- Adding parameters changes the signature, which CREATE OR REPLACE cannot do.
DROP FUNCTION IF EXISTS api.dataset_list_summary();
--> statement-breakpoint
CREATE FUNCTION api.dataset_list_summary(
  p_project_id uuid DEFAULT NULL,
  p_include_archived boolean DEFAULT true,
  p_limit integer DEFAULT NULL,
  p_offset integer DEFAULT 0
)
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
  archived_at timestamptz,
  experiment_display_id text,
  out_of_range_count bigint,
  missing_unit_count bigint,
  missing_unit_fields text[],
  review_state text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, api
AS $$
  SELECT d.id, d.display_id, d.name,
    -- The design's Model column carries the schema version ("ViCell v2").
    sd.name || ' v' || sv.version,
    d.primary_project_id,
    d.created_by_user_id,
    (SELECT count(*) FROM api.dataset_rows r WHERE r.dataset_id = d.id),
    (SELECT count(*) FROM api.dataset_value_flags f
      WHERE f.dataset_id = d.id AND f.cleared_at IS NULL),
    d.updated_at, d.archived_at,
    exp.identifier,
    (SELECT count(*) FROM api.dataset_value_flags f
      WHERE f.dataset_id = d.id AND f.cleared_at IS NULL
        AND f.kind = 'out_of_range'),
    (SELECT count(*) FROM api.dataset_value_flags f
      WHERE f.dataset_id = d.id AND f.cleared_at IS NULL
        AND f.kind = 'missing_unit'),
    (SELECT array_agg(DISTINCT fv.label ORDER BY fv.label)
       FROM api.dataset_value_flags f
       JOIN api.dataset_schema_version_fields fv
         ON fv.schema_version_id = d.schema_version_id
        AND fv.field_id = f.field_id
      WHERE f.dataset_id = d.id AND f.cleared_at IS NULL
        AND f.kind = 'missing_unit'),
    CASE
      WHEN exp.status = 'approved' THEN 'locked'
      WHEN exp.status = 'in_review' AND exp.locked_at IS NULL THEN 'in_review'
      ELSE NULL
    END
  FROM api.datasets d
  LEFT JOIN api.dataset_schema_versions sv ON sv.id = d.schema_version_id
  LEFT JOIN api.dataset_schema_definitions sd ON sd.id = sv.schema_id
  LEFT JOIN LATERAL (
    SELECT r.identifier, r.status, r.locked_at
      FROM api.record_links l
      JOIN api.records r ON r.id = l.source_record_id
     WHERE l.target_kind = 'dataset'
       AND l.link_type = 'dataset'
       AND l.target_identifier = d.display_id
     ORDER BY r.created_at
     LIMIT 1
  ) exp ON true
  WHERE (p_project_id IS NULL OR d.primary_project_id = p_project_id)
    AND (p_include_archived OR d.archived_at IS NULL)
  ORDER BY d.updated_at DESC, d.id
  LIMIT p_limit OFFSET coalesce(p_offset, 0)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.dataset_list_summary(uuid, boolean, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.dataset_list_summary(uuid, boolean, integer, integer) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
