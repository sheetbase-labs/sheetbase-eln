-- PROJ-03.2 — project governance settings, enforced on the server.
--
-- `require_independent_reviewer` is enforced by a trigger on signatures: when
-- the project is set, the reviewer approving a record must not be the person
-- who submitted it. The settings are written through an admin-only RPC.
-- `require_effective_protocol` (EXP-03) and `auto_share_to_client` (PORTAL) are
-- enforced by their owning tasks.

CREATE OR REPLACE FUNCTION internal.assert_independent_reviewer()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_author text;
  v_required boolean;
BEGIN
  IF NEW.signature_meaning <> 'approve-for-record' THEN
    RETURN NEW;
  END IF;
  SELECT rs.submitted_by_user_id, p.require_independent_reviewer
    INTO v_author, v_required
    FROM api.review_submissions rs
    JOIN api.records r ON r.id = rs.record_id
    LEFT JOIN api.projects p ON p.id = r.project_id
    WHERE rs.id = NEW.submission_id;
  IF v_required IS TRUE AND v_author IS NOT NULL
     AND NEW.signer_user_id = v_author THEN
    RAISE EXCEPTION 'the reviewer must not be the author' USING ERRCODE = 'SB008';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assert_independent_reviewer
BEFORE INSERT ON api.signatures
FOR EACH ROW EXECUTE FUNCTION internal.assert_independent_reviewer();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.update_project_settings(
  p_project_id uuid,
  p_require_effective_protocol boolean DEFAULT NULL,
  p_require_independent_reviewer boolean DEFAULT NULL,
  p_auto_share_to_client boolean DEFAULT NULL
)
RETURNS api.projects
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.projects;
BEGIN
  SELECT * INTO v FROM api.projects
    WHERE id = p_project_id AND workspace_id = api.current_workspace_id()
    FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
    WHERE m.workspace_id = v.workspace_id
      AND m.user_id = api.current_user_id()
      AND m.suspended_at IS NULL
      AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  UPDATE api.projects
    SET require_effective_protocol = coalesce(p_require_effective_protocol, require_effective_protocol),
        require_independent_reviewer = coalesce(p_require_independent_reviewer, require_independent_reviewer),
        auto_share_to_client = coalesce(p_auto_share_to_client, auto_share_to_client)
    WHERE id = v.id
    RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_project_settings(uuid, boolean, boolean, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_project_settings(uuid, boolean, boolean, boolean) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
