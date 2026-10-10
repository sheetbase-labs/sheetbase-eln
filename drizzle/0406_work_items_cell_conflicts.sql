-- EXP-05.4 — an unresolved cell conflict is a work item.
--
-- The replay raises a conflict and a person has to decide between two attributable
-- edits; until they do, the cell is unresolved. That belongs in the same place as every
-- other thing waiting for a person, rather than only on the sheet someone happens to open.
--
-- Derived, not stored: the item exists while the conflict is open and disappears the
-- moment it is resolved, so the list cannot show a decision that is already made. It is
-- addressed to whoever raised it (the person whose offline edit conflicted), because that
-- is whose work is blocked.

DO $$
DECLARE previous text;
BEGIN
  SELECT rtrim(pg_get_viewdef('api.my_work_items'::regclass,true),E';\n ') INTO previous;
  EXECUTE 'CREATE OR REPLACE VIEW api.my_work_items WITH(security_invoker=true) AS
    SELECT old.* FROM ('||previous||') old UNION ALL
    SELECT ''cell_conflict''::text,r.id,r.identifier,r.title,r.project_id,
      ''A cell changed in two places''::text,NULL::timestamptz,''needs_action''::text,c.created_at,
      ''sheet_cell_conflict''::text,c.id,NULL::uuid,NULL::uuid,NULL::uuid
    FROM api.sheet_cell_conflicts c
    JOIN api.sheet_instances si ON si.id=c.sheet_instance_id
    JOIN api.records r ON r.id=si.notebook_record_id
    WHERE c.workspace_id=api.current_workspace_id()
      AND c.state=''open''
      AND c.local_author_user_id=api.current_user_id()';
END $$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
