-- How each person likes to see the clock, and whether they want the layout bar.
--
-- Times were 24-hour only. A person can now choose a 12 or 24 hour clock, and
-- choose to keep the workspace layout bar and shortcut footer always visible
-- (they are otherwise hidden until a pane is split). Both live in the person's
-- own api.user_preferences row, under preferences.clock and
-- preferences.alwaysShowLayout. The table stays read-only to the app role: this
-- function is the only writer, and it writes only the caller's row.

CREATE FUNCTION api.set_display_preferences(
  p_clock text DEFAULT NULL,
  p_always_show_layout boolean DEFAULT NULL
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_id text;
  v_patch jsonb := '{}'::jsonb;
BEGIN
  v_user_id := api.current_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'set_display_preferences requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_clock IS NOT NULL AND p_clock NOT IN ('12h', '24h') THEN
    RAISE EXCEPTION 'the clock is 12h or 24h' USING ERRCODE = '22023';
  END IF;
  IF p_clock IS NOT NULL THEN
    v_patch := v_patch || jsonb_build_object('clock', p_clock);
  END IF;
  IF p_always_show_layout IS NOT NULL THEN
    v_patch := v_patch || jsonb_build_object('alwaysShowLayout', p_always_show_layout);
  END IF;

  INSERT INTO api.user_preferences
    (user_id, appearance, nav_collapsed, preferences, created_at, updated_at)
  VALUES
    (v_user_id, 'system', false, v_patch, now(), now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    preferences = coalesce(api.user_preferences.preferences, '{}'::jsonb) || v_patch,
    updated_at = now();
END;
$$;

ALTER FUNCTION api.set_display_preferences(p_clock text, p_always_show_layout boolean) OWNER TO migrator;
REVOKE ALL ON FUNCTION api.set_display_preferences(p_clock text, p_always_show_layout boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION api.set_display_preferences(p_clock text, p_always_show_layout boolean) TO authenticated;
