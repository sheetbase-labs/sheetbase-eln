-- How a person likes their lists.
--
-- Every table in the app can be sorted by a column header and have columns
-- hidden. What one person chose is remembered for that person, on every
-- device, and never changes what anyone else sees.

CREATE TABLE api.list_views (
    user_id text NOT NULL,
    list_key text NOT NULL,
    sorting jsonb DEFAULT '[]'::jsonb NOT NULL,
    hidden_columns jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT list_views_pkey PRIMARY KEY (user_id, list_key),
    CONSTRAINT chk_list_views_key CHECK (length(list_key) BETWEEN 1 AND 80),
    CONSTRAINT chk_list_views_sorting CHECK (jsonb_typeof(sorting) = 'array' AND jsonb_array_length(sorting) <= 4),
    CONSTRAINT chk_list_views_hidden CHECK (jsonb_typeof(hidden_columns) = 'array' AND jsonb_array_length(hidden_columns) <= 100)
);
--> statement-breakpoint
ALTER TABLE api.list_views OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.list_views ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY list_views_select ON api.list_views FOR SELECT TO authenticated
    USING (user_id = api.current_user_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.list_views TO authenticated;
--> statement-breakpoint

-- Remember (or, with both lists empty, forget) the caller's choices for a list.
CREATE FUNCTION api.set_list_view(p_list_key text, p_sorting jsonb DEFAULT '[]'::jsonb, p_hidden_columns jsonb DEFAULT '[]'::jsonb)
RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_id text := api.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'set_list_view requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF coalesce(jsonb_typeof(p_sorting), 'array') <> 'array' OR coalesce(jsonb_typeof(p_hidden_columns), 'array') <> 'array' THEN
    RAISE EXCEPTION 'sorting and hidden columns must be lists' USING ERRCODE = '22023';
  END IF;
  IF (coalesce(p_sorting, '[]'::jsonb) = '[]'::jsonb) AND (coalesce(p_hidden_columns, '[]'::jsonb) = '[]'::jsonb) THEN
    DELETE FROM api.list_views WHERE user_id = v_user_id AND list_key = p_list_key;
    RETURN;
  END IF;
  INSERT INTO api.list_views (user_id, list_key, sorting, hidden_columns)
  VALUES (v_user_id, p_list_key, coalesce(p_sorting, '[]'::jsonb), coalesce(p_hidden_columns, '[]'::jsonb))
  ON CONFLICT (user_id, list_key)
  DO UPDATE SET sorting = EXCLUDED.sorting, hidden_columns = EXCLUDED.hidden_columns, updated_at = now();
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_list_view(text, jsonb, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_list_view(text, jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_list_view(text, jsonb, jsonb) TO authenticated;
