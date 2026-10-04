-- Connector imports retain platform Files and governed runs, not browser
-- dataset_import_files. Derive their failure work from those same runs. A
-- claimed successful run alone cannot resolve it: a canonical import receipt
-- for the matching retry is required.
DO $$
DECLARE previous text;
BEGIN
  SELECT rtrim(pg_get_viewdef('api.my_work_items'::regclass, true), E';\n ') INTO previous;
  EXECUTE 'CREATE OR REPLACE VIEW api.my_work_items WITH (security_invoker = true) AS
    SELECT old.*, NULL::uuid AS connector_id FROM (' || previous || ') old
    UNION ALL
    SELECT ''run_failed''::text, NULL::uuid, c.key, ''Import failed: '' || c.name, NULL::uuid,
      coalesce(cr.error_message, ''Connector import failed''), NULL::timestamptz, ''needs_action''::text,
      cr.finished_at, ''connector_run''::text, cr.id, NULL::uuid, c.id
    FROM api.connector_runs cr JOIN api.connectors c ON c.id = cr.connector_id
    WHERE cr.status = ''failed'' AND cr.workspace_id = api.current_workspace_id()
      AND EXISTS (SELECT 1 FROM api.workspace_memberships wm WHERE wm.workspace_id = cr.workspace_id
        AND wm.user_id = api.current_user_id() AND wm.suspended_at IS NULL
        AND (wm.role IN (''owner'', ''admin'', ''steward'') OR wm.user_id = cr.actor_user_id))
      AND NOT EXISTS (SELECT 1 FROM api.dataset_imports di JOIN api.connector_runs retry ON retry.id = di.connector_run_id
        WHERE di.status = ''committed'' AND di.workspace_id = cr.workspace_id
          AND retry.connector_id = cr.connector_id AND di.created_at > cr.started_at
          AND (retry.retry_of_run_id = cr.id OR
            (cr.request_digest IS NOT NULL AND retry.request_digest = cr.request_digest) OR
            (cr.selector_digest IS NOT NULL AND retry.selector_digest = cr.selector_digest)))';
END $$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
