-- Sidebar pages.
--
-- A lab can take pages it does not use (say Shipments or Incidents) out of
-- everyone's sidebar. The pages still open from search, links and the command
-- palette; this only changes what the sidebar lists. Each person can also fold
-- the sidebar's groups, and the fold follows them between devices.

ALTER TABLE api.workspace_settings
    ADD COLUMN hidden_nav_pages text[] DEFAULT '{}'::text[] NOT NULL,
    ADD CONSTRAINT chk_workspace_settings_hidden_nav_pages CHECK (
        cardinality(hidden_nav_pages) <= 40
        AND array_to_string(hidden_nav_pages, ',') ~ '^[a-z-]*(,[a-z-]+)*$'
    );
--> statement-breakpoint
ALTER TABLE api.user_preferences
    ADD COLUMN nav_folded text[] DEFAULT '{}'::text[] NOT NULL,
    ADD CONSTRAINT chk_user_preferences_nav_folded CHECK (
        cardinality(nav_folded) <= 10
        AND array_to_string(nav_folded, ',') ~ '^[a-z-]*(,[a-z-]+)*$'
    );
--> statement-breakpoint
CREATE FUNCTION api.set_hidden_nav_pages(p_workspace_id uuid, p_pages text[]) RETURNS api.workspace_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v api.workspace_settings;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  IF p_pages IS NULL THEN
    RAISE EXCEPTION 'invalid sidebar pages' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.workspace_settings (workspace_id, hidden_nav_pages, created_by_user_id)
  VALUES (p_workspace_id, ARRAY(SELECT DISTINCT unnest(p_pages) ORDER BY 1), api.current_user_id())
  ON CONFLICT (workspace_id) DO UPDATE
    SET hidden_nav_pages = EXCLUDED.hidden_nav_pages, updated_at = now()
  RETURNING * INTO v;
  PERFORM internal.emit_change_event(v.workspace_id, 'workspace_settings', v.workspace_id, 'update', NULL, NULL,
    jsonb_build_object('effect', 'sidebar', 'hiddenNavPages', to_jsonb(v.hidden_nav_pages)));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_hidden_nav_pages(uuid, text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_hidden_nav_pages(uuid, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_hidden_nav_pages(uuid, text[]) TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.set_nav_folded(p_groups text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_user_id text := api.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'set_nav_folded requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_groups IS NULL THEN
    RAISE EXCEPTION 'invalid folded groups' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.user_preferences (user_id, nav_folded)
  VALUES (v_user_id, ARRAY(SELECT DISTINCT unnest(p_groups) ORDER BY 1))
  ON CONFLICT (user_id) DO UPDATE
    SET nav_folded = EXCLUDED.nav_folded, updated_at = now();
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_nav_folded(text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_nav_folded(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_nav_folded(text[]) TO authenticated;
