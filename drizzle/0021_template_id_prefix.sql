-- The Settings > Record IDs table offered an NBK prefix for notebook templates,
-- but their ids have always been TPL-nnnn and the setting changed nothing. The
-- display id now follows the workspace's notebook_template prefix, and the
-- table's default is TPL.

CREATE OR REPLACE FUNCTION internal.next_display_id(p_workspace_id uuid, p_kind text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_prefix text;
  v_width integer;
  v_number bigint;
  v_custom text;
BEGIN
  -- Notebook templates take the prefix the workspace chose for them in
  -- Settings (their display ids read TPL-0001 until it is changed).
  IF p_kind = 'template' THEN
    SELECT nullif(btrim(id_prefixes ->> 'notebook_template'), '')
      INTO v_custom
      FROM api.workspace_settings WHERE workspace_id = p_workspace_id;
  END IF;
  v_prefix := coalesce(v_custom, CASE p_kind WHEN 'project' THEN 'PRJ' WHEN 'client' THEN 'CL'
                          WHEN 'model' THEN 'MDL' WHEN 'template' THEN 'TPL'
                          WHEN 'sheet' THEN 'SHT' WHEN 'analysis' THEN 'AN'
                          ELSE upper(left(p_kind, 3)) END);
  v_width := CASE p_kind WHEN 'client' THEN 3 ELSE 4 END;
  INSERT INTO internal.id_sequences (workspace_id, kind, last_number)
  VALUES (p_workspace_id, 'display:' || p_kind, 1)
  ON CONFLICT (workspace_id, kind)
  DO UPDATE SET last_number = internal.id_sequences.last_number + 1
  RETURNING last_number INTO v_number;
  RETURN v_prefix || '-' || lpad(v_number::text, v_width, '0');
END;
$$;
--> statement-breakpoint
