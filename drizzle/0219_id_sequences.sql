-- SET-01.2 — per-kind identifier prefixes and never-reused sequence numbers.
--
-- workspace_settings.id_prefixes holds the prefix per kind; the durable counter
-- lives in internal.id_sequences so a number is never reused. Assignment reads
-- the prefix and bumps the counter.

CREATE TABLE internal.id_sequences (
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL,
  last_number bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, kind)
);
--> statement-breakpoint
REVOKE ALL ON internal.id_sequences FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.next_record_identifier(
  p_workspace_id uuid,
  p_kind text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prefix text;
  v_number bigint;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF p_kind IS NULL OR p_kind !~ '^[a-z][a-z0-9_]{0,59}$' THEN
    RAISE EXCEPTION 'unknown record kind' USING ERRCODE = '22023';
  END IF;

  SELECT nullif(btrim(id_prefixes ->> p_kind), '')
    INTO v_prefix
    FROM api.workspace_settings WHERE workspace_id = p_workspace_id;
  v_prefix := coalesce(v_prefix, upper(left(p_kind, 3)));

  INSERT INTO internal.id_sequences (workspace_id, kind, last_number)
  VALUES (p_workspace_id, p_kind, 1)
  ON CONFLICT (workspace_id, kind)
  DO UPDATE SET last_number = internal.id_sequences.last_number + 1
  RETURNING last_number INTO v_number;

  RETURN v_prefix || '-' || lpad(v_number::text, 4, '0');
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.next_record_identifier(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.next_record_identifier(uuid, text) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
