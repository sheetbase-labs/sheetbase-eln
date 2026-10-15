-- QA4-Home-Count — the Inbox totals become a server-side count, not a preview length.
--
-- Home's "Open inbox · N items" and its quiet/busy pace were the length of a
-- `limit=200` read of `api.my_work_items`, so a workspace with more than 200
-- needs-action items stated a smaller number than the sidebar badge, which
-- counts server-side. The number has to be a real count over the same two read
-- models the sidebar uses — `api.my_work_items` (the predicate's rows) and
-- `api.work_item_views` (the caller's seen keys) — and the seen state is per
-- person, which a plain `count=exact` on one table cannot express.
--
-- So the count moves next to the read model it counts. The predicate itself
-- stays in `src/lib/work-items/predicate.ts`; this function restates its two
-- branches over the same rows, in the same order the client computes the key
-- (`kind:source_id ?? record_id ?? identifier ?? title`), so the number cannot
-- drift from the list it opens:
--
--   * needs action = state in ('needs_action','overdue') and no seen key,
--   * reviews = the `workItemType` mapping's review kinds.
--
-- The seen keys are matched on the caller's own claims (`user_id` and
-- `workspace_id`), the same two predicates the `work_item_views_select` policy
-- applies, rather than on the policy alone. Both callers set the claims —
-- PostgREST from the request JWT, the shell's server count with
-- `set_config('request.jwt.claims', …)` — and the shell's connection owns the
-- table, so it bypasses that policy however it poses the query. Stating the
-- caller in the query is what keeps the number the caller's own either way;
-- without it the count would subtract a colleague's acknowledged work.
--
-- SECURITY INVOKER (the default, stated for the reader): both read models are
-- read as the caller, so `api.my_work_items`' own workspace scope applies
-- exactly as it does for the list, and no parameter can widen what the caller
-- sees.

CREATE OR REPLACE FUNCTION api.inbox_needs_action_counts()
RETURNS TABLE (total integer, reviews integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH unseen AS (
    SELECT i.kind
      FROM api.my_work_items i
     WHERE i.state = ANY (ARRAY['needs_action', 'overdue']::text[])
       AND NOT EXISTS (
         SELECT 1
           FROM api.work_item_views v
          WHERE v.item_key = i.kind || ':' ||
                coalesce(i.source_id::text, i.record_id::text, i.identifier,
                         i.title, 'Untitled')
            AND v.user_id = api.current_user_id()
            AND v.workspace_id = api.current_workspace_id()
       )
  )
  SELECT count(*)::int AS total,
         count(*) FILTER (
           WHERE kind IN ('review_requested', 'witness_requested')
         )::int AS reviews
    FROM unseen
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.inbox_needs_action_counts() FROM PUBLIC;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION api.inbox_needs_action_counts() TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
