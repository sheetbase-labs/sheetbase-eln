-- Agent proposals waiting on a person were filed under "Access & admin" with
-- every other administrator task, and showed up for people who were not the
-- proposal's approver. They now have their own Inbox type, and a proposal that
-- names an approver only reaches that approver.

CREATE OR REPLACE VIEW api.inbox_work_items WITH (security_invoker='true') AS
 SELECT kind,
    record_id,
    identifier,
    title,
    project_id,
    reason,
    due_at,
    state,
    created_at,
    source_type,
    source_id,
    parser_version_id,
    connector_id,
    revision_id,
    dataset_id,
    row_id,
    field_id,
    ((kind || ':'::text) || COALESCE((source_id)::text, (record_id)::text, identifier, title, 'Untitled'::text)) AS item_key,
        CASE
            WHEN ((state = 'following'::text) OR (kind = 'following'::text)) THEN 'following'::text
            WHEN ((state = 'done_today'::text) OR (EXISTS ( SELECT 1
               FROM api.work_item_views v
              WHERE ((v.item_key = ((i.kind || ':'::text) || COALESCE((i.source_id)::text, (i.record_id)::text, i.identifier, i.title, 'Untitled'::text))) AND (v.workspace_id = api.current_workspace_id()) AND (v.user_id = api.current_user_id()))))) THEN 'done-today'::text
            ELSE 'needs-action'::text
        END AS inbox_tab,
        CASE
            WHEN (kind = ANY (ARRAY['review_requested'::text, 'witness_requested'::text, 'review_returned'::text, 'approval_unsigned'::text, 'witness_signed'::text])) THEN 'reviews'::text
            WHEN (kind = ANY (ARRAY['data_issue'::text, 'cell_conflict'::text])) THEN 'data'::text
            WHEN (kind = ANY (ARRAY['run_failed'::text, 'run_waiting'::text])) THEN 'runs'::text
            WHEN (kind = 'material_expiring'::text) THEN 'materials'::text
            WHEN (kind = ANY (ARRAY['sample_awaiting_release'::text, 'sample_hold_exceeded'::text, 'calibration_overdue'::text, 'qualification_granted'::text])) THEN 'lab'::text
            WHEN (kind = ANY (ARRAY['access_requested'::text, 'access_decided'::text, 'invitation_accepted'::text, 'verification_requested'::text, 'verification_granted'::text, 'qualification_requested'::text])) THEN 'admin'::text
            WHEN (kind = 'agent_proposal'::text) THEN 'agents'::text
            ELSE 'following'::text
        END AS inbox_type
   FROM api.my_work_items i
  WHERE ((kind <> 'agent_proposal'::text) OR (EXISTS ( SELECT 1
           FROM api.agent_operation_proposals ap
          WHERE ((ap.id = i.source_id) AND ((ap.approver_user_id IS NULL) OR ((ap.approver_user_id)::text = (api.current_user_id())::text))))));;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.inbox_work_items_page(p_tab text DEFAULT 'needs-action'::text, p_type text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE result jsonb;
BEGIN
  IF p_tab IS NULL OR p_tab NOT IN ('needs-action','following','done-today')
     OR (p_type IS NOT NULL AND p_type NOT IN ('reviews','data','runs','materials','lab','admin','agents','following'))
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 OR p_offset IS NULL OR p_offset<0 THEN
    RAISE EXCEPTION 'invalid Inbox page' USING ERRCODE='22023';
  END IF;
  WITH all_items AS MATERIALIZED (SELECT * FROM api.inbox_work_items),
  filtered AS (SELECT * FROM all_items WHERE inbox_tab=p_tab AND (p_type IS NULL OR inbox_type=p_type)),
  page AS (SELECT * FROM filtered ORDER BY due_at ASC NULLS LAST,created_at DESC NULLS LAST,item_key ASC LIMIT p_limit OFFSET p_offset)
  SELECT jsonb_build_object(
    'items',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY due_at ASC NULLS LAST,created_at DESC NULLS LAST,item_key ASC) FROM page p),'[]'::jsonb),
    'total',(SELECT count(*) FROM filtered),'offset',p_offset,
    'tabs',coalesce((SELECT jsonb_object_agg(inbox_tab,n) FROM (SELECT inbox_tab,count(*) n FROM all_items GROUP BY inbox_tab) t),'{}'::jsonb),
    'types',coalesce((SELECT jsonb_object_agg(inbox_type,n) FROM (SELECT inbox_type,count(*) n FROM all_items WHERE inbox_tab=p_tab GROUP BY inbox_type) t),'{}'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
--> statement-breakpoint
