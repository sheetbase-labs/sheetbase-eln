-- ---------------------------------------------------------------------------
-- EVENT-03: canonical pipeline event triggers.
--
-- Event schedules reference catalogue event names
-- (`src/lib/event-catalogue.ts`), not the pre-catalogue
-- `dataset_version_created` string. Aliases (wire names + the legacy name)
-- are accepted at the intake boundary and normalized here; the canonical
-- name is what is stored in the schedule spec.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.normalize_pipeline_event_type(p_event text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  CASE p_event
    -- Pre-catalogue name, kept working at the intake boundary.
    WHEN 'dataset_version_created' THEN RETURN 'dataset.versioned';
    -- Shipped wire aliases, kept working at the intake boundary.
    WHEN 'sheet_instance.created' THEN RETURN 'sheet.created';
    WHEN 'sheet_instance.updated' THEN RETURN 'sheet.updated';
    WHEN 'sheet_instance.archived' THEN RETURN 'sheet.archived';
    WHEN 'sheet_instance.restored' THEN RETURN 'sheet.restored';
    WHEN 'sheet_definition.created' THEN RETURN 'sheet.definition.created';
    WHEN 'sheet_definition.updated' THEN RETURN 'sheet.definition.updated';
    WHEN 'sheet_definition.versioned' THEN RETURN 'sheet.definition.versioned';
    WHEN 'notebook_template.created' THEN RETURN 'notebook.template.created';
    WHEN 'notebook_template.updated' THEN RETURN 'notebook.template.updated';
    WHEN 'notebook_template.versioned' THEN RETURN 'notebook.template.versioned';
    ELSE
      -- Canonical triggerable set: stable catalogue entries with a producer
      -- in the record/dataset/sheet/notebook families. Mirrors
      -- PIPELINE_TRIGGER_EVENTS in src/lib/pipeline-schedule.ts.
      IF p_event IN (
        'record.created', 'record.updated', 'record.moved',
        'record.deleted', 'record.archived', 'record.restored',
        'dataset.created', 'dataset.updated',
        'dataset.archived', 'dataset.restored',
        'dataset.versioned',
        'sheet.created', 'sheet.updated',
        'sheet.archived', 'sheet.restored',
        'sheet.definition.created', 'sheet.definition.updated',
        'sheet.definition.versioned',
        'notebook.submitted', 'review.decided', 'notebook.signed',
        'notebook.template.created', 'notebook.template.updated',
        'notebook.template.versioned'
      ) THEN
        RETURN p_event;
      END IF;
      RAISE EXCEPTION 'unsupported event trigger' USING ERRCODE = 'SB034';
  END CASE;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.normalize_pipeline_event_type(text) FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- create_pipeline_schedule: normalize the trigger name, store canonical.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.create_pipeline_schedule(
  p_workspace_id uuid,
  p_definition_id uuid,
  p_kind text,
  p_spec jsonb,
  p_enabled boolean DEFAULT true
)
RETURNS api.pipeline_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_schedules;
  v_definition api.pipeline_definitions;
  v_event text;
  v_spec jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v_definition FROM api.pipeline_definitions
   WHERE id = p_definition_id AND workspace_id = p_workspace_id;
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'pipeline definition not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_kind NOT IN ('interval', 'daily', 'event') THEN
    RAISE EXCEPTION 'invalid schedule kind' USING ERRCODE = 'SB034';
  END IF;
  v_spec := p_spec;
  IF p_kind = 'event' THEN
    v_event := api.normalize_pipeline_event_type(p_spec->>'eventType');
    v_spec := jsonb_set(v_spec, '{eventType}', to_jsonb(v_event));
    IF v_spec ? 'datasetId' AND jsonb_typeof(v_spec->'datasetId') <> 'string' THEN
      RAISE EXCEPTION 'invalid event dataset filter' USING ERRCODE = 'SB034';
    ELSIF jsonb_typeof(v_spec->'datasetId') = 'string' THEN
      BEGIN
        PERFORM (v_spec->>'datasetId')::uuid;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'invalid event dataset filter' USING ERRCODE = 'SB034';
      END;
    END IF;
  ELSE
    PERFORM api.pipeline_schedule_next_run(p_kind, p_spec, now());
  END IF;
  INSERT INTO api.pipeline_schedules(
    workspace_id, definition_id, kind, spec, enabled, next_run_at, created_by_user_id
  ) VALUES (
    p_workspace_id, p_definition_id, p_kind, v_spec, p_enabled,
    CASE WHEN p_kind = 'event' THEN NULL ELSE api.pipeline_schedule_next_run(p_kind, p_spec, now()) END,
    api.current_user_id()
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_pipeline_schedule(uuid, uuid, text, jsonb, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_pipeline_schedule(uuid, uuid, text, jsonb, boolean) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- update_pipeline_schedule: same normalization on rewrite.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.update_pipeline_schedule(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_kind text DEFAULT NULL,
  p_spec jsonb DEFAULT NULL,
  p_enabled boolean DEFAULT NULL
)
RETURNS api.pipeline_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_schedules;
  v_kind text;
  v_spec jsonb;
  v_event text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v FROM api.pipeline_schedules
   WHERE id = p_schedule_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'pipeline schedule not found' USING ERRCODE = 'SB036';
  END IF;
  v_kind := COALESCE(p_kind, v.kind);
  v_spec := COALESCE(p_spec, v.spec);
  IF v_kind NOT IN ('interval', 'daily', 'event') THEN
    RAISE EXCEPTION 'invalid schedule kind' USING ERRCODE = 'SB034';
  END IF;
  IF v_kind = 'event' THEN
    v_event := api.normalize_pipeline_event_type(v_spec->>'eventType');
    v_spec := jsonb_set(v_spec, '{eventType}', to_jsonb(v_event));
  ELSE
    PERFORM api.pipeline_schedule_next_run(v_kind, v_spec, now());
  END IF;
  UPDATE api.pipeline_schedules SET
    kind = v_kind,
    spec = v_spec,
    enabled = COALESCE(p_enabled, enabled),
    next_run_at = CASE WHEN v_kind = 'event' THEN NULL ELSE api.pipeline_schedule_next_run(v_kind, v_spec, now()) END,
    updated_at = now()
  WHERE id = p_schedule_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.update_pipeline_schedule(uuid, uuid, text, jsonb, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_pipeline_schedule(uuid, uuid, text, jsonb, boolean) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Backfill: stored specs carry the canonical name from here on. Normalize
-- any pre-catalogue or alias spellings already persisted.
-- ---------------------------------------------------------------------------

UPDATE api.pipeline_schedules
   SET spec = jsonb_set(spec, '{eventType}', '"dataset.versioned"'),
       updated_at = now()
 WHERE kind = 'event'
   AND spec->>'eventType' = 'dataset_version_created';
--> statement-breakpoint
UPDATE api.pipeline_schedules
   SET spec = jsonb_set(spec, '{eventType}', '"sheet.created"'),
       updated_at = now()
 WHERE kind = 'event'
   AND spec->>'eventType' = 'sheet_instance.created';
--> statement-breakpoint
UPDATE api.pipeline_schedules
   SET spec = jsonb_set(spec, '{eventType}', '"sheet.updated"'),
       updated_at = now()
 WHERE kind = 'event'
   AND spec->>'eventType' = 'sheet_instance.updated';
--> statement-breakpoint
UPDATE api.pipeline_schedules
   SET spec = jsonb_set(spec, '{eventType}', '"sheet.archived"'),
       updated_at = now()
 WHERE kind = 'event'
   AND spec->>'eventType' = 'sheet_instance.archived';
--> statement-breakpoint
UPDATE api.pipeline_schedules
   SET spec = jsonb_set(spec, '{eventType}', '"sheet.restored"'),
       updated_at = now()
 WHERE kind = 'event'
   AND spec->>'eventType' = 'sheet_instance.restored';
--> statement-breakpoint
UPDATE api.pipeline_schedules
   SET spec = jsonb_set(spec, '{eventType}', '"sheet.definition.created"'),
       updated_at = now()
 WHERE kind = 'event'
   AND spec->>'eventType' = 'sheet_definition.created';
--> statement-breakpoint
UPDATE api.pipeline_schedules
   SET spec = jsonb_set(spec, '{eventType}', '"sheet.definition.updated"'),
       updated_at = now()
 WHERE kind = 'event'
   AND spec->>'eventType' = 'sheet_definition.updated';
--> statement-breakpoint
UPDATE api.pipeline_schedules
   SET spec = jsonb_set(spec, '{eventType}', '"sheet.definition.versioned"'),
       updated_at = now()
 WHERE kind = 'event'
   AND spec->>'eventType' = 'sheet_definition.versioned';
--> statement-breakpoint
UPDATE api.pipeline_schedules
   SET spec = jsonb_set(spec, '{eventType}', '"notebook.template.created"'),
       updated_at = now()
 WHERE kind = 'event'
   AND spec->>'eventType' = 'notebook_template.created';
--> statement-breakpoint
UPDATE api.pipeline_schedules
   SET spec = jsonb_set(spec, '{eventType}', '"notebook.template.updated"'),
       updated_at = now()
 WHERE kind = 'event'
   AND spec->>'eventType' = 'notebook_template.updated';
--> statement-breakpoint
UPDATE api.pipeline_schedules
   SET spec = jsonb_set(spec, '{eventType}', '"notebook.template.versioned"'),
       updated_at = now()
 WHERE kind = 'event'
   AND spec->>'eventType' = 'notebook_template.versioned';
