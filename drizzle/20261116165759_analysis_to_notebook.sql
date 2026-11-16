-- Put a saved analysis into an experiment's notebook as a live block.
--
-- The Analysis Studio's "Save and add to <experiment>", the assistant, the API,
-- MCP and pipelines all call this one function, so a result lands in the
-- notebook the same way from everywhere. The block names the saved analysis and
-- runs it each time the notebook opens: change the analysis or its data and the
-- notebook, and the experiment's Results tab, show the new numbers without
-- anything being copied across.
--
-- Asking twice for the same analysis in the same notebook returns the block that
-- is already there (`already_there` true) instead of adding a second. The block
-- goes through api.insert_block, so the structure version, the change feed and
-- the locking rules for a submitted notebook all apply.
--
-- A trigger on the notebook's blocks sends `analysis.added_to_notebook` when an
-- analysis block that names a saved analysis is added, however it was added:
-- this function, the block editor, "Cite in a notebook" or a plain insert_block.

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  IF position('''analysis_notebook''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''analysis_notebook''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES ('analysis.added_to_notebook')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO internal.pipeline_trigger_events (name) VALUES ('analysis.added_to_notebook')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE FUNCTION internal.trg_change_event_analysis_block() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_definition_id uuid;
  v_name text;
  v_workspace_id uuid;
  v_project_id uuid;
BEGIN
  IF NEW.payload ->> 'definitionId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  v_definition_id := (NEW.payload ->> 'definitionId')::uuid;

  SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
    FROM api.records WHERE id = NEW.record_id;
  IF v_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_name FROM api.analysis_definitions WHERE id = v_definition_id;

  PERFORM internal.emit_change_event(v_workspace_id, 'analysis_notebook', NEW.id, 'create', NEW.record_id, v_project_id,
    jsonb_build_object('recordId', NEW.record_id, 'blockId', NEW.id, 'definitionId', v_definition_id,
      'analysis', v_name, 'title', NEW.payload ->> 'title'));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_analysis_block() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_analysis_block
  AFTER INSERT ON api.blocks
  FOR EACH ROW WHEN (NEW.type = 'analysis')
  EXECUTE FUNCTION internal.trg_change_event_analysis_block();
--> statement-breakpoint

CREATE FUNCTION api.add_analysis_to_notebook(
  p_record_id uuid,
  p_definition_id uuid,
  p_title text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_name text;
  v_title text;
  v_block api.blocks;
  v_inserted jsonb;
BEGIN
  SELECT name INTO v_name FROM api.analysis_definitions WHERE id = p_definition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'saved analysis not found, or you cannot read it' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM api.records WHERE id = p_record_id) THEN
    RAISE EXCEPTION 'notebook not found, or you cannot change it' USING ERRCODE = '42501';
  END IF;

  v_title := left(coalesce(nullif(btrim(coalesce(p_title, '')), ''), v_name), 200);

  SELECT * INTO v_block
    FROM api.blocks
   WHERE record_id = p_record_id
     AND type = 'analysis'
     AND payload ->> 'definitionId' = p_definition_id::text
   ORDER BY "order"
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('block', to_jsonb(v_block), 'already_there', true);
  END IF;

  v_inserted := api.insert_block(
    p_record_id,
    'analysis',
    jsonb_build_object('title', v_title, 'definitionId', p_definition_id)
  );

  RETURN jsonb_build_object(
    'block', v_inserted -> 'block',
    'structure_version', v_inserted -> 'structure_version',
    'already_there', false
  );
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.add_analysis_to_notebook(uuid, uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.add_analysis_to_notebook(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.add_analysis_to_notebook(uuid, uuid, text) TO authenticated, api_client;
--> statement-breakpoint

-- The pipeline action. Mirrors src/features/results-analysis/operations.ts.
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('add_analysis_to_notebook', '{"operation":"add_analysis_to_notebook","rpc":"add_analysis_to_notebook","label":"Add an analysis to a notebook","description":"Puts a saved analysis into an experiment notebook as a live block: the notebook shows its numbers and plot and keeps them current as the analysis or its data change. Adding the same analysis to the same notebook again returns the block that is already there. Returns the block and `already_there`. Sends `analysis.added_to_notebook`.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_definition_id","type":"uuid","required":true,"nullable":false},{"name":"p_title","type":"text","required":false,"nullable":true}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
