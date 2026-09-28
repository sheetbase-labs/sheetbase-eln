ALTER TABLE "api"."workspace_invitations" DROP CONSTRAINT "chk_workspace_invitations_role";--> statement-breakpoint
ALTER TABLE "api"."workspace_invitations" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."workspace_invitations" ADD CONSTRAINT "workspace_invitations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "api"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."workspace_invitations" ADD CONSTRAINT "chk_workspace_invitations_client" CHECK (("api"."workspace_invitations"."role" = 'client_viewer') = ("api"."workspace_invitations"."client_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "api"."workspace_invitations" ADD CONSTRAINT "chk_workspace_invitations_role" CHECK ("api"."workspace_invitations"."role" IN ('owner', 'admin', 'member', 'steward', 'scientist', 'analyst', 'reviewer', 'viewer', 'client_viewer'));--> statement-breakpoint

-- ADR-0049 — invite a client viewer. The invitation carries the client, and
-- accepting it stamps the membership's client_id.
DROP FUNCTION IF EXISTS api.create_invitation(uuid, text, text, integer);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.create_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role text DEFAULT 'member',
  p_expires_after_days integer DEFAULT 7,
  p_client_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.workspace_invitations; v_token text:=gen_random_uuid()::text;
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
  INSERT INTO api.workspace_invitations(
    workspace_id,email,role,client_id,token_hash,expires_at,created_by_user_id
  ) VALUES(
    p_workspace_id,
    lower(btrim(p_email)),
    p_role,
    p_client_id,
    encode(sha256(convert_to(v_token,'UTF8')),'hex'),
    now()+make_interval(days=>p_expires_after_days),
    api.current_user_id()
  ) RETURNING * INTO v;
  RETURN to_jsonb(v)-'token_hash'||jsonb_build_object('token',v_token);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_invitation(uuid, text, text, integer, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_invitation(uuid, text, text, integer, uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.accept_invitation(p_token text,p_user_id text) RETURNS api.workspace_invitations
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.workspace_invitations;
BEGIN
  IF p_user_id IS DISTINCT FROM api.current_user_id() THEN RAISE EXCEPTION 'user identity mismatch' USING ERRCODE='SB062'; END IF;
  SELECT * INTO v FROM api.workspace_invitations WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE;
  IF v IS NULL OR v.status <> 'pending' THEN RAISE EXCEPTION 'invitation is not pending' USING ERRCODE='SB061'; END IF;
  IF v.expires_at <= now() THEN UPDATE api.workspace_invitations SET status='expired',updated_at=now() WHERE id=v.id; RAISE EXCEPTION 'invitation expired' USING ERRCODE='SB061'; END IF;
  INSERT INTO api.workspace_memberships(workspace_id,user_id,role,client_id)
    VALUES(v.workspace_id,p_user_id,v.role,v.client_id)
    ON CONFLICT (workspace_id,user_id) DO UPDATE
      SET role=EXCLUDED.role,client_id=EXCLUDED.client_id,suspended_at=NULL,updated_at=now();
  UPDATE api.workspace_invitations SET status='accepted',accepted_at=now(),accepted_by_user_id=p_user_id,updated_at=now() WHERE id=v.id RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint

-- Members list now carries the client, so the members screen can show it.
DROP FUNCTION IF EXISTS api.workspace_members_list();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.workspace_members_list()
RETURNS TABLE(user_id text, name text, role text, client_id uuid, client_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.user_id, u.name, m.role, m.client_id, c.name
  FROM api.workspace_memberships m
  JOIN internal."user" u ON u.id = m.user_id
  LEFT JOIN api.clients c ON c.id = m.client_id
  WHERE m.workspace_id = api.current_workspace_id()
    AND m.suspended_at IS NULL
    AND api.is_workspace_member(m.workspace_id)
  ORDER BY u.name
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.workspace_members_list() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.workspace_members_list() TO authenticated;
--> statement-breakpoint

-- Role change also handles client viewers, carrying the client.
DROP FUNCTION IF EXISTS api.change_member_role(uuid, text, text);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.change_member_role(
  p_workspace_id uuid,
  p_user_id text,
  p_new_role text,
  p_client_id uuid DEFAULT NULL
) RETURNS api.workspace_memberships
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.workspace_memberships;
BEGIN
  IF NOT api.has_capability(p_workspace_id, 'workspace.admin')
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'owner access required' USING ERRCODE='SB052';
  END IF;
  IF p_new_role NOT IN ('owner','admin','member','steward','scientist','analyst','reviewer','viewer','client_viewer') THEN
    RAISE EXCEPTION 'invalid role' USING ERRCODE='SB053';
  END IF;
  IF p_new_role = 'client_viewer' THEN
    IF p_client_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM api.clients c WHERE c.id = p_client_id AND c.workspace_id = p_workspace_id
    ) THEN
      RAISE EXCEPTION 'a client viewer needs a client' USING ERRCODE='SB053';
    END IF;
  ELSIF p_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'only client viewers carry a client' USING ERRCODE='SB053';
  END IF;
  IF p_user_id=api.current_user_id() THEN RAISE EXCEPTION 'cannot change own role' USING ERRCODE='SB050'; END IF;
  SELECT * INTO v FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND user_id=p_user_id FOR UPDATE;
  IF v IS NULL THEN RAISE EXCEPTION 'member not found' USING ERRCODE='SB052'; END IF;
  IF v.role='owner' AND p_new_role<>'owner'
     AND (SELECT count(*) FROM api.workspace_memberships
           WHERE workspace_id=p_workspace_id AND role='owner' AND suspended_at IS NULL)=1 THEN
    RAISE EXCEPTION 'cannot demote last owner' USING ERRCODE='SB051';
  END IF;
  UPDATE api.workspace_memberships
     SET role=p_new_role,client_id=p_client_id,updated_at=now()
   WHERE id=v.id RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.change_member_role(uuid, text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.change_member_role(uuid, text, text, uuid) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
