-- DSET-02.2 — the dataset registry list read model, extended for the
-- DatasetsList design: the Experiment column, the Validation wording and the
-- Locked tab.
--
-- `experiment_display_id` resolves the experiment that produced the dataset
-- through `record_links` (target_kind 'dataset', link_type 'dataset', keyed by
-- the dataset's display id), the same link the seed writes and the experiment
-- Datasets tab reads.
--
-- `out_of_range_count` / `missing_unit_count` / `missing_unit_fields` split the
-- active value flags by kind so the list can say "1 out of range" and
-- "2 columns missing units" instead of "N issues"; the field labels drive the
-- issues inspector sentence.
--
-- `review_state` mirrors the producing experiment's lifecycle as the design
-- renders it: an approved experiment marks its datasets `locked`; an in-review,
-- not-yet-signed experiment marks them `in_review`; a signed experiment's
-- datasets carry no suffix (the review is complete).
--
-- SECURITY INVOKER keeps the caller's datasets/rows/flags/links/records RLS for
-- every column.

-- The return row type gains columns, which CREATE OR REPLACE cannot change.
DROP FUNCTION IF EXISTS api.dataset_list_summary();
--> statement-breakpoint
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
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.dataset_list_summary() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.dataset_list_summary() TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
