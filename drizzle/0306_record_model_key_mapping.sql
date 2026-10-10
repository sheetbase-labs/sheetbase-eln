-- ADR-0051: workspace model keys may repeat across workspaces. This helper
-- maps an admitted record kind to its field/rule key; it does not authorise it.
-- guard_record_kind checks the row's workspace, and all callers read fields
-- and rules using that same row-owned workspace, including claims-free paths.
CREATE OR REPLACE FUNCTION internal.model_key_for(p_table text, p_kind text DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(
    (SELECT key FROM api.model_kinds
      WHERE identity_table = p_table
        AND (record_kind = p_kind OR (record_kind IS NULL AND p_kind IS NULL))),
    CASE WHEN p_table = 'api.records' THEN p_kind END
  )
$$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
