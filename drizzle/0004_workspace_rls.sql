-- AUTH-004: row-level security on every workspace-owned table.
--
-- Claim-reader helpers live in api (where authenticated already has USAGE),
-- not internal — decision record 0002 closes internal to request roles, and
-- these helpers read only GUCs and api.workspace_memberships, never internal
-- data. They reuse api.claim_probe (AUTH-003), which is defensive: missing,
-- empty or malformed request.jwt.claims yield NULL, so every policy
-- comparison fails closed — zero rows, never an error that leaks structure
-- (docs/database-access.md).
--
-- is_workspace_member is SECURITY DEFINER (owned by migrator) so it can read
-- api.workspace_memberships without recursing through that table's RLS. It
-- pins search_path = '' and qualifies every object.
--
-- RLS is ENABLED but not FORCED. The request roles (anon, authenticated) are
-- not the table owner, so RLS is already authoritative for every API path.
-- The owner (migrator) legitimately bypasses RLS for migrations, seed and
-- bootstrap; the production bootstrap path runs as the DATABASE_URL
-- superuser. FORCE RLS would break those without adding any protection to
-- normal API use, where no request role is ever the owner.

-- ---------------------------------------------------------------------------
-- Claim readers (reuse api.claim_probe from AUTH-003).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."current_user_id"()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT "api"."claim_probe"() ->> 'sub'
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."current_workspace_id"()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  value text;
BEGIN
  claims := "api"."claim_probe"();
  IF claims IS NULL THEN
    RETURN NULL;
  END IF;
  value := claims ->> 'workspace_id';
  IF value IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN value::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."is_workspace_member"(
  p_workspace_id uuid,
  p_role text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "api"."workspace_memberships" m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = "api"."current_user_id"()
      AND (p_role IS NULL OR m.role = p_role)
  )
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."current_user_id"() FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."current_workspace_id"() FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."is_workspace_member"(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."current_user_id"() TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."current_workspace_id"() TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."is_workspace_member"(uuid, text) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.workspaces — owner-only mutation; no INSERT/DELETE for authenticated
-- (workspace creation and deletion are service operations).
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "workspaces_select" ON "api"."workspaces"
  FOR SELECT TO authenticated
  USING (
    id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(id)
  );--> statement-breakpoint

CREATE POLICY "workspaces_update" ON "api"."workspaces"
  FOR UPDATE TO authenticated
  USING (
    id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(id, 'owner')
  )
  WITH CHECK (id = "api"."current_workspace_id"());--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.workspace_memberships — members read; owners add, update, remove.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."workspace_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "memberships_select" ON "api"."workspace_memberships"
  FOR SELECT TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  );--> statement-breakpoint

CREATE POLICY "memberships_insert" ON "api"."workspace_memberships"
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id, 'owner')
  );--> statement-breakpoint

CREATE POLICY "memberships_update" ON "api"."workspace_memberships"
  FOR UPDATE TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id, 'owner')
  )
  WITH CHECK (workspace_id = "api"."current_workspace_id"());--> statement-breakpoint

CREATE POLICY "memberships_delete" ON "api"."workspace_memberships"
  FOR DELETE TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id, 'owner')
  );--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.projects — members read/create/update; owners delete.
-- Updates cannot move a project between workspaces (WITH CHECK pins
-- workspace_id to the active claim).
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "projects_select" ON "api"."projects"
  FOR SELECT TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  );--> statement-breakpoint

CREATE POLICY "projects_insert" ON "api"."projects"
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  );--> statement-breakpoint

CREATE POLICY "projects_update" ON "api"."projects"
  FOR UPDATE TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  )
  WITH CHECK (workspace_id = "api"."current_workspace_id"());--> statement-breakpoint

CREATE POLICY "projects_delete" ON "api"."projects"
  FOR DELETE TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id, 'owner')
  );--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
