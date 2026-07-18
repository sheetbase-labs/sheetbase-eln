-- API-004: controlled project creation RPC. Direct INSERT is safe under RLS,
-- but the stable per-workspace key must be generated server-side so clients
-- cannot collide, pick poor keys, or guess other workspaces' identifiers.
--
-- SECURITY INVOKER: the function runs as the caller (authenticated), so the
-- projects INSERT inside it is still subject to the projects_insert RLS
-- policy (defense in depth — the WITH CHECK pins workspace_id to the active
-- claim). The function reads only the caller's own workspace's projects
-- (RLS-scoped) to keep keys unique within that workspace.
--
-- Returns the created row. PostgREST exposes it at POST /rpc/create_project.

CREATE OR REPLACE FUNCTION "api"."create_project"(p_title text)
RETURNS "api"."projects"
LANGUAGE plpgsql
AS $$
DECLARE
  v_workspace_id uuid;
  v_base text;
  v_key text;
  v_suffix int := 1;
  v_row "api"."projects";
BEGIN
  v_workspace_id := "api"."current_workspace_id"();
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'no active workspace in request claims' USING ERRCODE = '42804';
  END IF;
  IF NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RAISE EXCEPTION 'caller is not a member of the active workspace' USING ERRCODE = '42501';
  END IF;

  -- Normalise the title: trim, then derive the key. A whitespace-only or
  -- empty title falls back to 'project' so the row always has a usable key
  -- and a non-empty title.
  p_title := btrim(coalesce(p_title, ''));
  v_base := lower(regexp_replace(regexp_replace(p_title, '[^a-zA-Z0-9]+', '-', 'g'), '^-+|-+$', '', 'g'));
  IF v_base = '' THEN
    v_base := 'project';
  END IF;

  v_key := v_base;
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM "api"."projects" p
      WHERE p.workspace_id = v_workspace_id AND p.key = v_key
    );
    v_suffix := v_suffix + 1;
    v_key := v_base || '-' || v_suffix::text;
  END LOOP;

  INSERT INTO "api"."projects" (workspace_id, key, title)
  VALUES (v_workspace_id, v_key, CASE WHEN p_title = '' THEN v_key ELSE p_title END)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."create_project"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_project"(text) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
