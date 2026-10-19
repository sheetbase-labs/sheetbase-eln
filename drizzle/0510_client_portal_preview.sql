-- Preview as the client. An internal writer sees what a client's portal would
-- list for them: the client's approved records (explicitly shared, or covered
-- by the project's automatic share) and the client's automatically shared
-- projects. The rows have the same shape as api.client_portal_records and
-- api.client_portal_projects, and apply the same rules, except that they do not
-- depend on one particular client user's project authority: the preview shows
-- what is shared with the client, not whether a given person has signed in.
--
-- Nothing is written, and a caller who is not an internal writer of the
-- client's workspace is denied.

CREATE OR REPLACE FUNCTION api.client_portal_preview_records(p_client_id uuid)
RETURNS TABLE(
  record_id uuid, identifier text, title text, kind text, status text,
  project_id uuid, shared_at timestamptz,
  approved_at timestamptz, approved_by_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM api.clients c
     WHERE c.id = p_client_id
       AND c.workspace_id = api.current_workspace_id()
       AND api.is_workspace_writer(c.workspace_id)
  ) THEN
    RAISE EXCEPTION 'Client denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.id, r.identifier, r.title, r.kind, r.status,
         coalesce(s.project_id, r.project_id),
         coalesce(s.shared_at, r.updated_at),
         sig.signed_at, sig.signer_name
    FROM api.records r
    JOIN api.projects p ON p.id = r.project_id
    LEFT JOIN api.client_portal_shares s
      ON s.record_id = r.id AND s.client_id = p_client_id
    LEFT JOIN LATERAL (
      SELECT sg.signed_at, sg.signer_name
        FROM api.signatures sg
        JOIN api.revisions rev ON rev.id = sg.revision_id
       WHERE sg.record_id = r.id AND sg.workspace_id = r.workspace_id
         AND rev.record_id = r.id AND rev.workspace_id = r.workspace_id
         AND sg.signature_meaning IN ('approve-for-record', 'reviewed-and-approved')
         AND (r.locked_by_revision_id IS NULL OR sg.revision_id = r.locked_by_revision_id)
       ORDER BY sg.signed_at DESC, sg.id DESC
       LIMIT 1
    ) sig ON true
   WHERE p.client_id = p_client_id
     AND p.workspace_id = api.current_workspace_id()
     AND r.deleted_at IS NULL
     AND r.status = 'approved'
     AND (s.id IS NOT NULL OR p.auto_share_to_client)
   ORDER BY coalesce(s.shared_at, r.updated_at) DESC;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_preview_records(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_preview_records(uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.client_portal_preview_projects(p_client_id uuid)
RETURNS TABLE(
  project_id uuid, display_id text, title text, stage text, status text,
  modality text, lead_name text, last_update timestamptz,
  client_name text, client_code text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM api.clients c
     WHERE c.id = p_client_id
       AND c.workspace_id = api.current_workspace_id()
       AND api.is_workspace_writer(c.workspace_id)
  ) THEN
    RAISE EXCEPTION 'Client denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, p.display_id, p.title, p.stage, p.status, p.modality,
         u.name,
         (SELECT max(r.updated_at)
            FROM api.records r
           WHERE r.project_id = p.id AND r.deleted_at IS NULL),
         c.name, c.code
    FROM api.projects p
    JOIN api.clients c ON c.id = p.client_id
    LEFT JOIN internal."user" u ON u.id = p.lead_user_id
   WHERE c.id = p_client_id
     AND c.workspace_id = api.current_workspace_id()
     AND p.auto_share_to_client
   ORDER BY p.title;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_preview_projects(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_preview_projects(uuid) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
