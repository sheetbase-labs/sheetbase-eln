-- The Experiments list waited on this for about half a second: for every
-- experiment it searched all links and all flags again, with the access check
-- on each row. Count the active flags once per linked dataset, then attach the
-- totals; the answer is the same.
CREATE OR REPLACE FUNCTION api.experiment_open_issue_counts()
 RETURNS TABLE(record_id uuid, open_issues bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'api'
AS $function$
  SELECT r.id, coalesce(x.n, 0)::bigint
  FROM api.records r
  LEFT JOIN (
    SELECT l.source_record_id, count(*) AS n
    FROM api.dataset_value_flags f
    JOIN api.datasets d ON d.id = f.dataset_id
    JOIN api.record_links l
      ON l.target_identifier = d.display_id AND l.link_type = 'dataset'
    WHERE f.cleared_at IS NULL
    GROUP BY l.source_record_id
  ) x ON x.source_record_id = r.id
  WHERE r.kind = 'experiment' AND r.deleted_at IS NULL
$function$;
