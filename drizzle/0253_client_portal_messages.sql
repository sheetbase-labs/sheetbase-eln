CREATE TABLE "api"."client_portal_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"author_user_id" text NOT NULL,
	"author_kind" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_client_portal_messages_author_kind" CHECK ("api"."client_portal_messages"."author_kind" IN ('team', 'client')),
	CONSTRAINT "chk_client_portal_messages_body" CHECK (length(btrim("api"."client_portal_messages"."body")) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
ALTER TABLE "api"."client_portal_messages" ADD CONSTRAINT "client_portal_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."client_portal_messages" ADD CONSTRAINT "client_portal_messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "api"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."client_portal_messages" ADD CONSTRAINT "client_portal_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "api"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."client_portal_messages" ADD CONSTRAINT "client_portal_messages_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_client_portal_messages_client" ON "api"."client_portal_messages" USING btree ("client_id","created_at");--> statement-breakpoint
ALTER TABLE api.client_portal_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON api.client_portal_messages TO authenticated;
--> statement-breakpoint
CREATE POLICY "client_portal_messages_select" ON api.client_portal_messages
  FOR SELECT TO authenticated
  USING (
    workspace_id = api.current_workspace_id()
    AND (
      api.is_workspace_member(workspace_id)
      OR client_id = api.current_client_id()
    )
  );
--> statement-breakpoint

-- Post a message: the client posts as 'client'; an internal writer posts as
-- 'team'. Everything else is denied.
CREATE OR REPLACE FUNCTION api.post_client_portal_message(
  p_client_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_body text DEFAULT NULL
)
RETURNS api.client_portal_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c api.clients;
  v api.client_portal_messages;
  v_kind text;
BEGIN
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'a message needs 1 to 4000 characters' USING ERRCODE = '22023';
  END IF;
  -- A client posts to their own portal without naming the client.
  IF p_client_id IS NULL AND api.current_client_id() IS NOT NULL THEN
    p_client_id := api.current_client_id();
  END IF;
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'Client denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM api.clients
    WHERE id = p_client_id AND workspace_id = api.current_workspace_id();
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'Client denied' USING ERRCODE = '42501';
  END IF;

  IF api.current_client_id() = p_client_id THEN
    v_kind := 'client';
  ELSIF api.is_workspace_member(c.workspace_id) AND api.is_workspace_writer(c.workspace_id) THEN
    v_kind := 'team';
  ELSE
    RAISE EXCEPTION 'Client denied' USING ERRCODE = '42501';
  END IF;

  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.projects p
     WHERE p.id = p_project_id AND p.client_id = p_client_id
       AND p.workspace_id = c.workspace_id
  ) THEN
    RAISE EXCEPTION 'project is not this client''s' USING ERRCODE = '22023';
  END IF;

  INSERT INTO api.client_portal_messages(
    workspace_id, client_id, project_id, author_user_id, author_kind, body
  ) VALUES (
    c.workspace_id, c.id, p_project_id, api.current_user_id(), v_kind, btrim(p_body)
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.post_client_portal_message(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.post_client_portal_message(uuid, uuid, text) TO authenticated;
--> statement-breakpoint

-- Read the thread. A client reads their own; an internal member reads the
-- client they name.
CREATE OR REPLACE FUNCTION api.client_portal_messages(p_client_id uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid, client_id uuid, project_id uuid, author_kind text,
  author_user_id text, body text, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client uuid;
BEGIN
  IF api.current_client_id() IS NOT NULL THEN
    v_client := api.current_client_id();
  ELSE
    IF p_client_id IS NULL THEN
      -- An internal member with no client named sees nothing (not an error).
      RETURN;
    END IF;
    IF NOT api.is_workspace_member(api.current_workspace_id()) THEN
      RAISE EXCEPTION 'Client denied' USING ERRCODE = '42501';
    END IF;
    v_client := p_client_id;
  END IF;
  RETURN QUERY
    SELECT m.id, m.client_id, m.project_id, m.author_kind,
           m.author_user_id, m.body, m.created_at
      FROM api.client_portal_messages m
     WHERE m.client_id = v_client
       AND m.workspace_id = api.current_workspace_id()
     ORDER BY m.created_at ASC;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_messages(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_messages(uuid) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
--> statement-breakpoint

-- Who is the caller in the portal? Null for internal members.
CREATE OR REPLACE FUNCTION api.client_portal_identity()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
    'clientId', c.id, 'clientName', c.name, 'clientCode', c.code
  ) END
  FROM api.clients c
  WHERE c.id = api.current_client_id()
    AND c.workspace_id = api.current_workspace_id()
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_identity() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_identity() TO authenticated;
