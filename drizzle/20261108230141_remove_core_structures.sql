-- Drawn structures belong to the Chemistry plugin now. It keeps its own search
-- index and its own same-thing key, so Sheetbase no longer stores fingerprints
-- or parent codes, and no longer has structure-specific registration calls.
-- What stays are lots: a lot is made from a lot model and linked to its entry,
-- and that is the same for any registry.

DROP TRIGGER IF EXISTS change_event_record_structures ON api.record_structures;
--> statement-breakpoint
DROP FUNCTION IF EXISTS api.register_compound(uuid, text, text, jsonb, jsonb, boolean);
--> statement-breakpoint
DROP FUNCTION IF EXISTS api.set_record_structure(uuid, integer, jsonb, boolean);
--> statement-breakpoint
DROP FUNCTION IF EXISTS api.index_record_structure(uuid, jsonb);
--> statement-breakpoint
DROP FUNCTION IF EXISTS api.query_structures(text, text, text, numeric, boolean, integer);
--> statement-breakpoint
DROP FUNCTION IF EXISTS api.find_structure_duplicates(text, text, text, uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS api.set_model_chemistry(text, text, text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS internal.write_record_structure_checked(uuid, text, jsonb);
--> statement-breakpoint
DROP FUNCTION IF EXISTS internal.write_record_structure(uuid, text, jsonb);
--> statement-breakpoint
DROP FUNCTION IF EXISTS internal.trg_change_event_compound();
--> statement-breakpoint
DROP TABLE IF EXISTS api.record_structures;
--> statement-breakpoint
DROP FUNCTION IF EXISTS internal.record_structures_guard();
--> statement-breakpoint
DROP FUNCTION IF EXISTS internal.structure_matches(bit, bit);
--> statement-breakpoint
DROP FUNCTION IF EXISTS internal.structure_fingerprint(text);
--> statement-breakpoint

-- The two events that came with structures are gone from the webhook names and
-- the pipeline trigger list; compound.lot_added stays.
DELETE FROM internal.webhook_event_names WHERE name IN ('compound.registered', 'compound.structure_changed');
--> statement-breakpoint
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  IF position('''compound.registered'', ''compound.structure_changed'', ' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_def := replace(v_def, '''compound.registered'', ''compound.structure_changed'', ', '');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- The structure field goes; the lot model stays, and lots work for any registry.
ALTER TABLE api.record_models DROP COLUMN registry_structure_field;
--> statement-breakpoint
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('internal.model_descendants(uuid,text)'::regprocedure) INTO v_def;
  IF position('registry_structure_field' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.model_descendants';
  END IF;
  v_def := replace(v_def, 'registry_sequence_field,
         registry_structure_field, registry_lot_kind', 'registry_sequence_field,
         registry_lot_kind');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- Choose the model that a registry's lots are made from (or clear it).
CREATE FUNCTION api.set_registry_lot_kind(p_model_key text, p_lot_kind text DEFAULT NULL)
RETURNS api.record_models
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_model api.record_models;
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  SELECT * INTO v_model FROM api.record_models WHERE workspace_id = v_workspace_id AND key = p_model_key;
  IF v_model.id IS NULL THEN
    RAISE EXCEPTION 'model not found' USING ERRCODE = 'SB036';
  END IF;
  IF NOT v_model.is_registry THEN
    RAISE EXCEPTION 'tick the model as a registry first' USING ERRCODE = '22023';
  END IF;
  IF nullif(p_lot_kind, '') IS NOT NULL AND (p_lot_kind = p_model_key OR NOT EXISTS (
       SELECT 1 FROM api.record_models m WHERE m.workspace_id = v_workspace_id AND m.key = p_lot_kind)) THEN
    RAISE EXCEPTION 'choose another model for lots' USING ERRCODE = '22023';
  END IF;
  UPDATE api.record_models
     SET registry_lot_kind = nullif(p_lot_kind, ''),
         updated_by_user_id = api.current_user_id(), updated_at = now()
   WHERE id = v_model.id
  RETURNING * INTO v_model;
  RETURN v_model;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_registry_lot_kind(p_model_key text, p_lot_kind text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_registry_lot_kind(p_model_key text, p_lot_kind text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_registry_lot_kind(p_model_key text, p_lot_kind text) TO authenticated;
--> statement-breakpoint

-- The lot calls only need a registry now, not one that takes structures.
CREATE OR REPLACE FUNCTION internal.chemistry_model(p_workspace_id uuid, p_kind text) RETURNS api.record_models
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_model api.record_models;
BEGIN
  SELECT * INTO v_model FROM api.record_models
   WHERE workspace_id = p_workspace_id AND key = p_kind AND is_registry;
  IF v_model.id IS NULL THEN
    RAISE EXCEPTION 'that model is not a registry' USING ERRCODE = '22023';
  END IF;
  RETURN v_model;
END $$;
