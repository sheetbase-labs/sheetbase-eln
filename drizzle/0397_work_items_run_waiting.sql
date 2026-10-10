-- WORK-01.4 — a run waiting for a person is a work item.
--
-- PIPE-02 made the `waiting` status and the prompt table possible; this is the
-- first of the "later kinds" that could not exist before it. The item is derived,
-- not stored: a run appears while it is waiting, I am one of the people asked, and
-- the prompt has no answer yet. Answering it, or the prompt expiring, removes the
-- item, so the inbox cannot show a decision that is already made.
--
-- The view keeps its security_invoker posture and is extended in place, the same
-- way the previous kind was added.

DO $$
DECLARE previous text;
BEGIN
  SELECT rtrim(pg_get_viewdef('api.my_work_items'::regclass,true),E';\n ') INTO previous;
  EXECUTE 'CREATE OR REPLACE VIEW api.my_work_items WITH(security_invoker=true) AS
    SELECT old.* FROM ('||previous||') old UNION ALL
    SELECT ''run_waiting''::text,NULL::uuid,pd.key,pd.name,NULL::uuid,
      ''Waiting for your decision''::text,p.expires_at,''needs_action''::text,p.created_at,
      ''pipeline_run_prompt''::text,p.id,NULL::uuid,NULL::uuid,NULL::uuid
    FROM api.pipeline_run_prompts p
    JOIN api.pipeline_runs pr ON pr.id=p.run_id
    JOIN api.pipeline_definition_versions pdv ON pdv.id=pr.definition_version_id
    JOIN api.pipeline_definitions pd ON pd.id=pdv.definition_id
    WHERE p.workspace_id=api.current_workspace_id()
      AND pr.status=''waiting''
      AND api.current_user_id()=ANY(p.asked_user_ids)
      AND p.answer IS NULL
      AND (p.expires_at IS NULL OR p.expires_at>now())';
END $$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
