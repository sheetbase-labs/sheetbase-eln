-- ADR-0051 / SHEET-03 — a Sheet may compose a workspace-defined Record Model
-- Record as a constant source, not only a built-in model kind.
--
-- `api.record_models` is the workspace registry (ADR-0051); a Record of such a
-- model carries the model key as its `kind`. Parameter resolution and the bound
-- column projection previously accepted only built-in `api.model_kinds` rows,
-- so a workspace Model Record could not be a Sheet source. Both predicates now
-- accept a built-in kind or a same-workspace model key; nothing else changes.
DO $$ DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('internal.resolve_sheet_parameters(uuid,uuid,jsonb)'::regprocedure);

  IF strpos(definition, 'IF NOT EXISTS(SELECT 1 FROM api.records r JOIN api.model_kinds m ON m.record_kind=r.kind AND m.identity_table=''api.records'' WHERE r.id=(supplied->>''recordId'')::uuid AND r.workspace_id=p_workspace_id AND r.deleted_at IS NULL AND m.key=type_spec->>''modelKey'') THEN') = 0 THEN
    RAISE EXCEPTION 'Parameter resolution record-source anchor missing';
  END IF;
  definition := replace(
    definition,
    'IF NOT EXISTS(SELECT 1 FROM api.records r JOIN api.model_kinds m ON m.record_kind=r.kind AND m.identity_table=''api.records'' WHERE r.id=(supplied->>''recordId'')::uuid AND r.workspace_id=p_workspace_id AND r.deleted_at IS NULL AND m.key=type_spec->>''modelKey'') THEN',
    'IF NOT EXISTS(SELECT 1 FROM api.records r WHERE r.id=(supplied->>''recordId'')::uuid AND r.workspace_id=p_workspace_id AND r.deleted_at IS NULL AND (EXISTS(SELECT 1 FROM api.model_kinds m WHERE m.record_kind=r.kind AND m.identity_table=''api.records'' AND m.key=type_spec->>''modelKey'') OR EXISTS(SELECT 1 FROM api.record_models rm WHERE rm.workspace_id=p_workspace_id AND rm.key=r.kind AND rm.key=type_spec->>''modelKey''))) THEN'
  );

  EXECUTE definition;
END $$;
--> statement-breakpoint

DO $$ DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('api.query_sheet_instance_rows_core037(uuid,integer,integer)'::regprocedure);

  IF strpos(definition, 'JOIN api.model_kinds model ON model.record_kind=r.kind AND model.identity_table=''api.records''
    WHERE r.id=(binding_item->>''recordId'')::uuid
      AND r.workspace_id=instance.workspace_id AND r.deleted_at IS NULL
      AND model.key=binding_item->>''modelKey'';') = 0 THEN
    RAISE EXCEPTION 'Bound column projection record-source anchor missing';
  END IF;
  definition := replace(
    definition,
    'JOIN api.model_kinds model ON model.record_kind=r.kind AND model.identity_table=''api.records''
    WHERE r.id=(binding_item->>''recordId'')::uuid
      AND r.workspace_id=instance.workspace_id AND r.deleted_at IS NULL
      AND model.key=binding_item->>''modelKey'';',
    'WHERE r.id=(binding_item->>''recordId'')::uuid
      AND r.workspace_id=instance.workspace_id AND r.deleted_at IS NULL
      AND (
        EXISTS(SELECT 1 FROM api.model_kinds model WHERE model.record_kind=r.kind AND model.identity_table=''api.records'' AND model.key=binding_item->>''modelKey'')
        OR EXISTS(SELECT 1 FROM api.record_models rm WHERE rm.workspace_id=instance.workspace_id AND rm.key=r.kind AND rm.key=binding_item->>''modelKey'')
      );'
  );

  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
