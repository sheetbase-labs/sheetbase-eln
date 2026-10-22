-- Collaboration grants intersect current canonical read/edit authority with
-- lifecycle. No workspace role is a substitute for an explicit project rule.
CREATE FUNCTION api.collaboration_object_state(p_kind text, p_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  w uuid := api.current_workspace_id();
  u text := api.current_user_id();
  authority_kind text := CASE WHEN p_kind = 'sheet' THEN 'instance' ELSE p_kind END;
  read_only boolean;
  parent uuid;
BEGIN
  IF api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated'
    OR NOT EXISTS (SELECT 1 FROM api.workspaces WHERE id = w AND status = 'active')
    OR NOT EXISTS (SELECT 1 FROM api.workspace_memberships
      WHERE workspace_id = w AND user_id = u AND suspended_at IS NULL
        AND role IN ('owner','admin','member','steward','scientist','analyst','reviewer','viewer'))
    OR p_kind NOT IN ('record','sheet','dataset')
    OR NOT internal.can_access_object(authority_kind, p_id, 'view') THEN
    RETURN 'denied';
  END IF;

  CASE p_kind
    WHEN 'record' THEN
      IF NOT internal.record_readable_by(p_id, u) THEN RETURN 'denied'; END IF;
      SELECT archived_at IS NOT NULL OR locked_at IS NOT NULL INTO read_only
        FROM api.records WHERE id = p_id AND workspace_id = w AND deleted_at IS NULL;
    WHEN 'sheet' THEN
      SELECT lifecycle = 'archived', notebook_record_id INTO read_only, parent
        FROM api.sheet_instances WHERE id = p_id AND workspace_id = w;
      IF parent IS NOT NULL THEN
        IF NOT internal.record_readable_by(parent, u)
          OR EXISTS (SELECT 1 FROM api.records WHERE id = parent AND deleted_at IS NOT NULL)
          THEN RETURN 'denied'; END IF;
        read_only := read_only OR EXISTS (SELECT 1 FROM api.records
          WHERE id = parent AND (archived_at IS NOT NULL OR locked_at IS NOT NULL));
      END IF;
    WHEN 'dataset' THEN
      SELECT lifecycle = 'archived' INTO read_only
        FROM api.datasets WHERE id = p_id AND workspace_id = w;
    ELSE RETURN 'denied';
  END CASE;
  IF read_only IS NULL THEN RETURN 'denied'; END IF;
  IF read_only OR NOT internal.can_access_object(authority_kind, p_id, 'edit') THEN
    RETURN 'read_only';
  END IF;
  RETURN 'writable';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.collaboration_object_state(text, uuid) FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.collaboration_object_state(text, uuid) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
