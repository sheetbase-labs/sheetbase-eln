-- EXP-05.4 — a cell conflict records both sides and how it was settled.
--
-- Offline replay can find that the same cell changed in two places: what this device
-- edited while offline, and what arrived from someone else first. EXP-05.3 raises the
-- conflict; this is where it is kept and how it is settled.
--
-- Both values are recorded with their authors and times, because the point of the
-- conflict is that a person decides between two attributable edits — not that the last
-- writer wins. Resolving requires a reason, and the resolution names the person who
-- chose. The row is never rewritten: `resolve_cell_conflict` fills the resolution once
-- and refuses a second decision, so the record of what was in conflict survives.

CREATE TABLE api.sheet_cell_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
  sheet_instance_id uuid NOT NULL REFERENCES api.sheet_instances(id) ON DELETE CASCADE,
  row_key text NOT NULL,
  field_id uuid NOT NULL,
  -- The value this device had edited but not yet sent.
  local_value jsonb,
  local_author_user_id text NOT NULL,
  local_at timestamptz NOT NULL,
  -- The value that arrived first from elsewhere.
  remote_value jsonb,
  remote_author_user_id text,
  remote_at timestamptz,
  state text NOT NULL DEFAULT 'open',
  resolved_value jsonb,
  resolved_by_user_id text,
  resolved_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_sheet_cell_conflicts_state CHECK (state IN ('open', 'resolved')),
  CONSTRAINT chk_sheet_cell_conflicts_row_key CHECK (
    length(btrim(row_key)) BETWEEN 1 AND 128
  ),
  -- A resolved conflict has all of its resolution and an open one has none, so a row
  -- cannot look settled without saying who settled it or why.
  CONSTRAINT chk_sheet_cell_conflicts_resolution CHECK (
    (state = 'resolved')
      = (resolved_by_user_id IS NOT NULL AND resolved_at IS NOT NULL
         AND reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 2000)
  ),
  CONSTRAINT chk_sheet_cell_conflicts_remote CHECK (
    (remote_author_user_id IS NULL) = (remote_at IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX idx_sheet_cell_conflicts_instance
  ON api.sheet_cell_conflicts(sheet_instance_id, state);
--> statement-breakpoint
CREATE INDEX idx_sheet_cell_conflicts_workspace
  ON api.sheet_cell_conflicts(workspace_id);
--> statement-breakpoint
-- One open conflict per cell: a second replay of the same cell settles the same one.
CREATE UNIQUE INDEX uq_sheet_cell_conflicts_open_cell
  ON api.sheet_cell_conflicts(sheet_instance_id, row_key, field_id)
  WHERE state = 'open';
--> statement-breakpoint

ALTER TABLE api.sheet_cell_conflicts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sheet_cell_conflicts_select ON api.sheet_cell_conflicts
  FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
GRANT SELECT ON api.sheet_cell_conflicts TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.resolve_cell_conflict(
  p_conflict_id uuid,
  p_value jsonb,
  p_reason text
)
RETURNS api.sheet_cell_conflicts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row api.sheet_cell_conflicts;
  v_actor text := api.current_user_id();
BEGIN
  SELECT * INTO v_row FROM api.sheet_cell_conflicts WHERE id = p_conflict_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'Unknown conflict' USING ERRCODE = '22023';
  END IF;
  PERFORM internal.assert_object_access('instance', v_row.sheet_instance_id, 'edit');
  IF v_row.state <> 'open' THEN
    RAISE EXCEPTION 'This conflict is already resolved' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'a reason is required to resolve a conflict' USING ERRCODE = '22023';
  END IF;

  UPDATE api.sheet_cell_conflicts
     SET state = 'resolved',
         resolved_value = p_value,
         resolved_by_user_id = v_actor,
         resolved_at = now(),
         reason = btrim(p_reason),
         updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  -- The decision belongs in the record's history, attributed to the person who made it.
  PERFORM internal.emit_change_event(
    v_row.workspace_id,
    'scientific_row',
    v_row.sheet_instance_id,
    'resolve',
    NULL,
    NULL,
    jsonb_build_object(
      'conflict', 'cell',
      'conflictId', v_row.id,
      'fieldId', v_row.field_id,
      'rowKey', v_row.row_key,
      'resolvedBy', v_actor,
      'reason', v_row.reason
    )
  );

  RETURN v_row;
END $function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.resolve_cell_conflict(uuid, jsonb, text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.resolve_cell_conflict(uuid, jsonb, text) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
