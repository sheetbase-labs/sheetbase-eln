-- MDL-01 / MDL-03 — a workspace Model Record uses its model's identifier prefix.
--
-- `api.create_model_record` allocated through `api.next_record_identifier`,
-- whose fallback for an unrecognised kind is `upper(left(kind,3))`, so a model
-- keyed `cell_bank` produced `CEL-0001` instead of the model's declared `CB`
-- prefix. A workspace Model Record now allocates through
-- `api.next_record_model_identifier`, which uses the model's identifier prefix
-- and its per-prefix counter; built-in kinds are unchanged.
DO $$ DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('api.create_model_record(uuid,text,text,text,text[],jsonb,jsonb)'::regprocedure);

  IF strpos(definition, 'generated_identifier := api.next_record_identifier(workspace, p_kind);') = 0 THEN
    RAISE EXCEPTION 'create_model_record identifier anchor missing';
  END IF;

  definition := replace(
    definition,
    'generated_identifier := api.next_record_identifier(workspace, p_kind);',
    'generated_identifier := CASE WHEN v_model.id IS NOT NULL THEN api.next_record_model_identifier(v_model.id) ELSE api.next_record_identifier(workspace, p_kind) END;'
  );

  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
