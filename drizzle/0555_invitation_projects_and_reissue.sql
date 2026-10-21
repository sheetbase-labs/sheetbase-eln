-- An invitation can name the projects the person joins, so a lead is not asked
-- to add them separately once they have accepted, and a pending invitation can
-- be given out again (a lost link used to mean revoke and re-invite).
ALTER TABLE "api"."workspace_invitations"
  ADD COLUMN "project_grants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."workspace_invitations"
  ADD CONSTRAINT "chk_workspace_invitations_project_grants"
  CHECK (jsonb_typeof("project_grants") = 'array');--> statement-breakpoint

DROP FUNCTION IF EXISTS api.create_invitation(uuid, text, text, integer, uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.create_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role text DEFAULT 'member',
  p_expires_after_days integer DEFAULT 7,
  p_client_id uuid DEFAULT NULL,
  p_project_grants jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v api.workspace_invitations;
  v_token text:=gen_random_uuid()::text;
  v_grant jsonb;
  v_grants jsonb:=coalesce(p_project_grants,'[]'::jsonb);
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_capability(p_workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'owner access required' USING ERRCODE='SB061';
  END IF;
  IF p_email IS NULL OR btrim(p_email) !~ '^[^@]+@[^@]+\.[^@]+$'
     OR p_role NOT IN ('owner','admin','member','steward','scientist','analyst','reviewer','viewer','client_viewer')
     OR p_expires_after_days IS NULL OR p_expires_after_days <= 0 THEN
    RAISE EXCEPTION 'invalid invitation' USING ERRCODE='SB061';
  END IF;
  IF p_role = 'client_viewer' THEN
    IF p_client_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM api.clients c
       WHERE c.id = p_client_id AND c.workspace_id = p_workspace_id
    ) THEN
      RAISE EXCEPTION 'a client viewer invitation needs a client' USING ERRCODE='SB061';
    END IF;
  ELSIF p_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'only client viewers carry a client' USING ERRCODE='SB061';
  END IF;
  IF jsonb_typeof(v_grants) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'project grants must be a list' USING ERRCODE='SB061';
  END IF;
  IF jsonb_array_length(v_grants) > 0 AND p_role = 'client_viewer' THEN
    RAISE EXCEPTION 'a client viewer joins through the client portal, not projects' USING ERRCODE='SB061';
  END IF;
  -- Each grant is the inviter's own authority: they must be able to manage the
  -- project, exactly as when they add the person after the fact.
  FOR v_grant IN SELECT * FROM jsonb_array_elements(v_grants) LOOP
    IF coalesce(v_grant->>'access_level','') NOT IN ('owner','editor','reviewer','viewer')
       OR NOT EXISTS (
         SELECT 1 FROM api.projects p
          WHERE p.id = (v_grant->>'project_id')::uuid
            AND p.workspace_id = p_workspace_id
            AND internal.can_manage_project(p.id)
       ) THEN
      RAISE EXCEPTION 'you cannot grant access to that project' USING ERRCODE='SB061';
    END IF;
  END LOOP;
  INSERT INTO api.workspace_invitations(
    workspace_id,email,role,client_id,project_grants,token_hash,expires_at,created_by_user_id
  ) VALUES(
    p_workspace_id,
    lower(btrim(p_email)),
    p_role,
    p_client_id,
    v_grants,
    encode(sha256(convert_to(v_token,'UTF8')),'hex'),
    now()+make_interval(days=>p_expires_after_days),
    api.current_user_id()
  ) RETURNING * INTO v;
  RETURN to_jsonb(v)-'token_hash'||jsonb_build_object('token',v_token);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_invitation(uuid, text, text, integer, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_invitation(uuid, text, text, integer, uuid, jsonb) TO authenticated;
--> statement-breakpoint

-- Apply the projects an invitation names. Called from api.accept_invitation, and
-- not callable on its own: it trusts the invitation row it is handed.
CREATE OR REPLACE FUNCTION api.apply_invitation_project_grants(p_invitation api.workspace_invitations) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_grant jsonb; v_level text;
BEGIN
  -- A project that has been archived or deleted since the invitation was made
  -- is skipped rather than failing the join.
  FOR v_grant IN SELECT * FROM jsonb_array_elements(p_invitation.project_grants) LOOP
    v_level:=v_grant->>'access_level';
    INSERT INTO api.project_access(workspace_id,project_id,user_id,can_view,can_edit,can_review,client_portal,can_manage,granted_by_user_id)
    SELECT p_invitation.workspace_id,p.id,p_invitation.accepted_by_user_id,true,v_level IN ('owner','editor'),v_level IN ('owner','reviewer'),false,v_level='owner',p_invitation.created_by_user_id
      FROM api.projects p
     WHERE p.id=(v_grant->>'project_id')::uuid AND p.workspace_id=p_invitation.workspace_id
    ON CONFLICT(workspace_id,project_id,user_id) DO UPDATE
      SET can_view=excluded.can_view,can_edit=excluded.can_edit,can_review=excluded.can_review,
          can_manage=excluded.can_manage,granted_by_user_id=excluded.granted_by_user_id,updated_at=now();
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.apply_invitation_project_grants(api.workspace_invitations) FROM PUBLIC;
--> statement-breakpoint

-- Accepting applies them. The function is patched in place, as 0346 and 0436
-- did, so those changes (portal grant, an active member keeps their role) stay.
DO $$ DECLARE definition text; anchor text;
BEGIN
  definition := pg_get_functiondef('api.accept_invitation(text,text)'::regprocedure);
  anchor := E'  UPDATE api.workspace_invitations SET status=\'accepted\'';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'accept_invitation anchor missing';
  END IF;
  -- The grants need the accepting user on the row, which the UPDATE below sets,
  -- so run them after it: split the statement at its RETURNING clause.
  definition := replace(
    definition,
    anchor,
    E'  v.accepted_by_user_id:=p_user_id;\n  PERFORM api.apply_invitation_project_grants(v);\n' || anchor
  );
  EXECUTE definition;
END $$;
--> statement-breakpoint

-- Give a pending invitation a new link. The old one stops working: only the
-- hash is stored, so the link cannot be shown again, but it can be replaced.
CREATE OR REPLACE FUNCTION api.reissue_invitation(
  p_workspace_id uuid,
  p_invitation_id uuid,
  p_expires_after_days integer DEFAULT 7
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.workspace_invitations; v_token text:=gen_random_uuid()::text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_capability(p_workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'owner access required' USING ERRCODE='SB061';
  END IF;
  IF p_expires_after_days IS NULL OR p_expires_after_days <= 0 THEN
    RAISE EXCEPTION 'invalid invitation' USING ERRCODE='SB061';
  END IF;
  SELECT * INTO v FROM api.workspace_invitations
   WHERE id=p_invitation_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF v IS NULL OR v.status NOT IN ('pending','expired') THEN
    RAISE EXCEPTION 'invitation is not pending' USING ERRCODE='SB061';
  END IF;
  UPDATE api.workspace_invitations
     SET token_hash=encode(sha256(convert_to(v_token,'UTF8')),'hex'),
         status='pending',
         expires_at=now()+make_interval(days=>p_expires_after_days),
         updated_at=now()
   WHERE id=v.id RETURNING * INTO v;
  RETURN to_jsonb(v)-'token_hash'||jsonb_build_object('token',v_token);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.reissue_invitation(uuid, uuid, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.reissue_invitation(uuid, uuid, integer) TO authenticated;
