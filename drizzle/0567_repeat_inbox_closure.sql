-- Keep repeat plans in dataset_rows and their sample provenance on the existing
-- lineage link. Every client (including callers omitting p_planned_key) gets a
-- stable fill key. No values are written before the planned -> recorded commit.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('api.request_repeat(uuid,uuid,timestamptz,integer,uuid,uuid,text,jsonb,text)'::regprocedure) INTO definition;
  definition := replace(definition,
    'WHEN p_planned_key IS NULL THEN NULL',
    'WHEN p_planned_key IS NULL THEN ''repeat:'' || v_sample.id::text || '':'' || i');
  definition := replace(definition,
    'RETURN jsonb_build_object(
    ''sample'', to_jsonb(v_sample),',
    'UPDATE api.record_links SET link_metadata = link_metadata || jsonb_build_object(''plannedRowIds'', to_jsonb(v_row_ids))
      WHERE source_record_id = v_source.id AND target_record_id = v_sample.id
        AND link_metadata->>''origin'' = ''request_repeat'';
  RETURN jsonb_build_object(
    ''datasetId'', v_dataset.id,
    ''plannedRows'', (SELECT jsonb_agg(jsonb_build_object(''id'', r.id, ''plannedKey'', r.planned_key) ORDER BY r.planned_key)
      FROM api.dataset_rows r WHERE r.id = ANY(v_row_ids)),
    ''sample'', to_jsonb(v_sample),');
  EXECUTE definition;
END $$;
--> statement-breakpoint

CREATE VIEW api.reading_planned_rows WITH (security_invoker = true) AS
SELECT r.id, r.dataset_id, r.planned_key, r.scheduled_at,
       l.target_record_id AS sample_id,
       (l.link_metadata->>'sourceFieldId')::uuid AS measurement_field_id
FROM api.dataset_rows r
LEFT JOIN api.record_links l ON l.link_metadata->>'origin' = 'request_repeat'
  AND l.link_metadata->'plannedRowIds' @> jsonb_build_array(r.id::text)
WHERE r.status = 'planned' AND r.planned_key IS NOT NULL;
--> statement-breakpoint
GRANT SELECT ON api.reading_planned_rows TO authenticated;
--> statement-breakpoint

-- Replace the old anonymous flag branch, leaving all other recipients and
-- destinations unchanged. A flag's UUID is its identity, not the dataset label.
DO $$
DECLARE previous text;
BEGIN
  SELECT rtrim(pg_get_viewdef('api.my_work_items'::regclass,true),E';\n ') INTO previous;
  EXECUTE 'CREATE OR REPLACE VIEW api.my_work_items WITH(security_invoker=true) AS
    SELECT old.*,NULL::uuid AS dataset_id,NULL::uuid AS row_id,NULL::uuid AS field_id
    FROM ('||previous||') old
    WHERE NOT (old.kind=''data_issue'' AND old.source_type IS NULL)
    UNION ALL
    SELECT ''data_issue''::text,NULL::uuid,d.display_id,d.name,d.primary_project_id,
      ''Flagged: '' || f.reason,NULL::timestamptz,''needs_action''::text,f.set_at,
      ''dataset_value_flag''::text,f.id,NULL::uuid,NULL::uuid,NULL::uuid,
      f.dataset_id,f.row_id,f.field_id
    FROM api.dataset_value_flags f JOIN api.datasets d ON d.id=f.dataset_id
    WHERE f.cleared_at IS NULL AND d.workspace_id=api.current_workspace_id()
      AND d.created_by_user_id=api.current_user_id()';
END $$;
--> statement-breakpoint

-- One invoker read model for list, filters and exact counts. The explicit user
-- and workspace predicate also scopes reads on the app's privileged connection.
CREATE VIEW api.inbox_work_items WITH (security_invoker = true) AS
SELECT i.*,
  i.kind || ':' || coalesce(i.source_id::text,i.record_id::text,i.identifier,i.title,'Untitled') AS item_key,
  CASE WHEN i.state='following' OR i.kind='following' THEN 'following'
       WHEN i.state='done_today' OR EXISTS (
         SELECT 1 FROM api.work_item_views v
         WHERE v.item_key=i.kind || ':' || coalesce(i.source_id::text,i.record_id::text,i.identifier,i.title,'Untitled')
           AND v.workspace_id=api.current_workspace_id() AND v.user_id=api.current_user_id()
       ) THEN 'done-today' ELSE 'needs-action' END AS inbox_tab,
  CASE WHEN i.kind IN ('review_requested','witness_requested','review_returned','approval_unsigned','witness_signed') THEN 'reviews'
       WHEN i.kind IN ('data_issue','cell_conflict') THEN 'data'
       WHEN i.kind IN ('run_failed','run_waiting') THEN 'runs'
       WHEN i.kind='material_expiring' THEN 'materials'
       WHEN i.kind IN ('sample_awaiting_release','sample_hold_exceeded','calibration_overdue','qualification_granted') THEN 'lab'
       WHEN i.kind IN ('access_requested','access_decided','agent_proposal','invitation_accepted','verification_requested','verification_granted','qualification_requested') THEN 'admin'
       ELSE 'following' END AS inbox_type
FROM api.my_work_items i;
--> statement-breakpoint
GRANT SELECT ON api.inbox_work_items TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.inbox_work_items_page(
  p_tab text DEFAULT 'needs-action', p_type text DEFAULT NULL,
  p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF p_tab IS NULL OR p_tab NOT IN ('needs-action','following','done-today')
     OR (p_type IS NOT NULL AND p_type NOT IN ('reviews','data','runs','materials','lab','admin','following'))
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
REVOKE ALL ON FUNCTION api.inbox_work_items_page(text,text,integer,integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.inbox_work_items_page(text,text,integer,integer) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.inbox_needs_action_counts()
RETURNS TABLE (total integer,reviews integer) LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT count(*)::int,count(*) FILTER (WHERE inbox_type='reviews')::int
  FROM api.inbox_work_items WHERE inbox_tab='needs-action'
$$;
--> statement-breakpoint

-- An Inbox flag points at the live value, even when it has not been snapshotted
-- or lies outside the snapshot grid's loaded window. RLS owns visibility.
CREATE FUNCTION api.dataset_value_context(p_dataset_id uuid,p_row_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('datasetId',d.id,'schemaVersionId',d.schema_version_id,'totalCount',1,'offset',0,'limit',1,
    'rows',jsonb_build_array(jsonb_build_object('rowId',r.id,'revision',r.revision,
      'values',coalesce((SELECT jsonb_object_agg(field_id,value) FROM (
        SELECT v.field_id,CASE WHEN f.cardinality='one' THEN (jsonb_agg(
          coalesce(to_jsonb(v.text_value),to_jsonb(v.integer_value),to_jsonb(v.numeric_value),to_jsonb(v.boolean_value),to_jsonb(v.date_value),to_jsonb(v.timestamp_value),to_jsonb(v.category_option_id),to_jsonb(v.reference_id)) ORDER BY v.ordinal))->0
        ELSE jsonb_agg(coalesce(to_jsonb(v.text_value),to_jsonb(v.integer_value),to_jsonb(v.numeric_value),to_jsonb(v.boolean_value),to_jsonb(v.date_value),to_jsonb(v.timestamp_value),to_jsonb(v.category_option_id),to_jsonb(v.reference_id)) ORDER BY v.ordinal) END AS value
        FROM api.dataset_row_values v JOIN api.dataset_schema_version_fields f
          ON f.schema_version_id=d.schema_version_id AND f.field_id=v.field_id
        WHERE v.row_id=r.id GROUP BY v.field_id,f.cardinality
      ) fields),'{}'::jsonb))))
  FROM api.datasets d JOIN api.dataset_rows r ON r.dataset_id=d.id
  WHERE d.id=p_dataset_id AND r.id=p_row_id AND d.workspace_id=api.current_workspace_id()
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.dataset_value_context(uuid,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.dataset_value_context(uuid,uuid) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
