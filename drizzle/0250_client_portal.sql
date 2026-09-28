CREATE TABLE "api"."client_portal_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"shared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shared_by_user_id" text,
	CONSTRAINT "uq_client_portal_shares_client_record" UNIQUE("client_id","record_id")
);
--> statement-breakpoint
ALTER TABLE "api"."workspace_memberships" DROP CONSTRAINT "chk_workspace_memberships_role";--> statement-breakpoint
ALTER TABLE "api"."workspace_memberships" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."client_portal_shares" ADD CONSTRAINT "client_portal_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."client_portal_shares" ADD CONSTRAINT "client_portal_shares_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "api"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."client_portal_shares" ADD CONSTRAINT "client_portal_shares_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "api"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."client_portal_shares" ADD CONSTRAINT "client_portal_shares_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "api"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."client_portal_shares" ADD CONSTRAINT "client_portal_shares_shared_by_user_id_user_id_fk" FOREIGN KEY ("shared_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_client_portal_shares_client" ON "api"."client_portal_shares" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_client_portal_shares_workspace" ON "api"."client_portal_shares" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "api"."workspace_memberships" ADD CONSTRAINT "workspace_memberships_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "api"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."workspace_memberships" ADD CONSTRAINT "chk_workspace_memberships_client" CHECK (("api"."workspace_memberships"."role" = 'client_viewer') = ("api"."workspace_memberships"."client_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "api"."workspace_memberships" ADD CONSTRAINT "chk_workspace_memberships_role" CHECK ("api"."workspace_memberships"."role" IN ('owner', 'admin', 'member', 'steward', 'scientist', 'analyst', 'reviewer', 'viewer', 'client_viewer'));--> statement-breakpoint

-- ADR-0049 — client users are isolated from the internal read surface.
--
-- `is_workspace_member` now means an INTERNAL member: a `client_viewer` is a
-- member for identity but never a member for reads, so every policy keyed on it
-- (records, blocks, datasets, files, comments, revisions, projects, …) denies a
-- client. The portal reads go through its own SECURITY DEFINER RPCs, which check
-- `is_workspace_client` and scope to the caller's client.
CREATE OR REPLACE FUNCTION api.is_workspace_member(p_workspace_id uuid, p_role text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN coalesce(api.claim_probe()->>'role', '') = 'api_client' THEN
      p_workspace_id IS NOT DISTINCT FROM api.current_workspace_id()
      AND p_role IS NULL
    ELSE EXISTS (
      SELECT 1
        FROM api.workspace_memberships m
       WHERE m.workspace_id = p_workspace_id
         AND m.user_id = api.current_user_id()
         AND m.suspended_at IS NULL
         AND m.role <> 'client_viewer'
         AND (p_role IS NULL OR m.role = p_role)
    )
  END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.is_workspace_client(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM api.workspace_memberships m
     WHERE m.workspace_id = p_workspace_id
       AND m.user_id = api.current_user_id()
       AND m.suspended_at IS NULL
       AND m.role = 'client_viewer'
  )
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.current_client_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.client_id
    FROM api.workspace_memberships m
   WHERE m.workspace_id = api.current_workspace_id()
     AND m.user_id = api.current_user_id()
     AND m.suspended_at IS NULL
     AND m.role = 'client_viewer'
$$;
--> statement-breakpoint

ALTER TABLE api.client_portal_shares ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON api.client_portal_shares TO authenticated;
--> statement-breakpoint
CREATE POLICY "client_portal_shares_select" ON api.client_portal_shares
  FOR SELECT TO authenticated
  USING (
    workspace_id = api.current_workspace_id()
    AND api.is_workspace_member(workspace_id)
  );
--> statement-breakpoint

-- Share one approved record with one client's portal. Internal writers only,
-- and the record must be approved and belong to a project.
CREATE OR REPLACE FUNCTION api.share_record_with_client(
  p_client_id uuid,
  p_record_id uuid
)
RETURNS api.client_portal_shares
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c api.clients;
  r api.records;
  v api.client_portal_shares;
BEGIN
  SELECT * INTO c FROM api.clients
    WHERE id = p_client_id
      AND workspace_id = api.current_workspace_id()
      AND api.is_workspace_writer(workspace_id);
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'Client denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM api.records
    WHERE id = p_record_id
      AND workspace_id = c.workspace_id
      AND deleted_at IS NULL;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Record denied' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'approved' THEN
    RAISE EXCEPTION 'only approved records can be shared to a client portal'
      USING ERRCODE = '22023';
  END IF;
  IF r.project_id IS NULL THEN
    RAISE EXCEPTION 'a shared record needs a project' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.client_portal_shares(
    workspace_id, client_id, project_id, record_id, shared_by_user_id
  ) VALUES (
    c.workspace_id, c.id, r.project_id, r.id, api.current_user_id()
  )
  ON CONFLICT (client_id, record_id) DO UPDATE
    SET shared_at = now(), shared_by_user_id = api.current_user_id()
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.share_record_with_client(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.share_record_with_client(uuid, uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.unshare_record_with_client(
  p_client_id uuid,
  p_record_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM api.clients c
     WHERE c.id = p_client_id
       AND c.workspace_id = api.current_workspace_id()
       AND api.is_workspace_writer(c.workspace_id)
  ) THEN
    RAISE EXCEPTION 'Client denied' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api.client_portal_shares
    WHERE client_id = p_client_id AND record_id = p_record_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.unshare_record_with_client(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.unshare_record_with_client(uuid, uuid) TO authenticated;
--> statement-breakpoint

-- Portal reads: the caller's client's projects and shared approved records.
CREATE OR REPLACE FUNCTION api.client_portal_projects()
RETURNS TABLE(
  project_id uuid, display_id text, title text, stage text,
  client_name text, client_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.display_id, p.title, p.stage, c.name, c.code
    FROM api.projects p
    JOIN api.clients c ON c.id = p.client_id
   WHERE c.id = api.current_client_id()
     AND c.workspace_id = api.current_workspace_id()
   ORDER BY p.title
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_projects() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_projects() TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.client_portal_records()
RETURNS TABLE(
  record_id uuid, identifier text, title text, kind text, status text,
  project_id uuid, shared_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.id, r.identifier, r.title, r.kind, r.status, s.project_id, s.shared_at
    FROM api.client_portal_shares s
    JOIN api.records r ON r.id = s.record_id
   WHERE s.client_id = api.current_client_id()
     AND s.workspace_id = api.current_workspace_id()
     AND r.deleted_at IS NULL
     AND r.status = 'approved'
   ORDER BY s.shared_at DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_records() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_records() TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.is_workspace_client(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.is_workspace_client(uuid) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.current_client_id() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.current_client_id() TO authenticated;
