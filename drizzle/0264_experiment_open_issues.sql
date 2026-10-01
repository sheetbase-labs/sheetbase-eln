-- UI port (RM-119) — the experiments list's "Open issues" column.
--
-- A dataset value flag (out of range, missing unit, above curve, high CV) is
-- the ELN's real notion of an open issue. An experiment's count is the
-- uncleared flags on the datasets it produced (linked through `record_links`
-- with link_type 'dataset', the same links the experiment's Datasets tab
-- reads), so the count matches what a reviewer sees on the record.
--
-- SECURITY INVOKER keeps the caller's records/datasets/flags RLS.

CREATE FUNCTION api.experiment_open_issue_counts()
RETURNS TABLE(record_id uuid, open_issues bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, api
AS $$
  SELECT r.id,
    (SELECT count(*)
       FROM api.record_links l
       JOIN api.datasets d ON d.display_id = l.target_identifier
       JOIN api.dataset_value_flags f
         ON f.dataset_id = d.id AND f.cleared_at IS NULL
      WHERE l.source_record_id = r.id AND l.link_type = 'dataset')
  FROM api.records r
  WHERE r.kind = 'experiment' AND r.deleted_at IS NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.experiment_open_issue_counts() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.experiment_open_issue_counts() TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
