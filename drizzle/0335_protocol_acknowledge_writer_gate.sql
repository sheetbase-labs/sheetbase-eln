-- GOV-01 / LAB-07 — protocol acknowledgement is a writer action.
--
-- `api.acknowledge_protocol_version` is an authenticated mutation RPC that
-- gated on workspace membership alone, which the GOV-01 write-plane inventory
-- flags (a membership gate without a writer or capability gate). Read-and-
-- acknowledge training exists so a person can start an experiment on that exact
-- version, and starting requires a workspace writer, so the gate is now
-- `is_workspace_writer` — the same requirement the start guard enforces.
DO $$ DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('api.acknowledge_protocol_version(uuid)'::regprocedure);

  IF strpos(definition, 'OR NOT api.is_workspace_member(v_version.workspace_id) THEN') = 0 THEN
    RAISE EXCEPTION 'acknowledge_protocol_version membership anchor missing';
  END IF;

  definition := replace(
    definition,
    'OR NOT api.is_workspace_member(v_version.workspace_id) THEN',
    'OR NOT api.is_workspace_writer(v_version.workspace_id) THEN'
  );

  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
