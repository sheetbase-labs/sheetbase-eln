-- Searching a workspace read every dataset cell through the cell-search read
-- policy, which called internal.can_access_object once per cell row before the
-- text match could discard it. With a few thousand cells that is seconds per
-- search, and it grows with the data. The policy now asks once per dataset,
-- through a function that returns the datasets the caller can view, and checks
-- each cell against that set. The rule is the same one can_access_object gives.

CREATE FUNCTION internal.viewable_dataset_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT d.id
    FROM api.datasets d
   WHERE d.workspace_id = api.current_workspace_id()
     AND internal.can_access_object('dataset', d.id, 'view')
$$;
--> statement-breakpoint
ALTER FUNCTION internal.viewable_dataset_ids() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.viewable_dataset_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION internal.viewable_dataset_ids() TO migrator;
--> statement-breakpoint
GRANT ALL ON FUNCTION internal.viewable_dataset_ids() TO authenticated;
--> statement-breakpoint
GRANT ALL ON FUNCTION internal.viewable_dataset_ids() TO api_client;
--> statement-breakpoint
ALTER POLICY set02_live_read ON api.dataset_cell_search
    USING (dataset_id IN (SELECT internal.viewable_dataset_ids()));
