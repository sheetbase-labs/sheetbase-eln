-- LAB-07 — the deviation event follows the audit payload convention.
--
-- The History surface renders captured facts from `payload.changes`, so the
-- deviation event carries the frozen and recorded step text as a labelled
-- before/after pair. Without it the row showed only a generic action and the
-- reviewer could not see what changed.
CREATE OR REPLACE FUNCTION "internal"."protocol_step_deviation"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_frozen text;
  v_revision uuid;
  v_step uuid;
  v_record api.records;
  v_last text;
  v_deviation uuid;
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.type <> 'procedure_step' THEN
    RETURN NEW;
  END IF;
  v_revision := NULLIF(NEW.payload->>'sourceProtocolRevisionId', '')::uuid;
  v_step := NULLIF(NEW.payload->>'sourceStepBlockId', '')::uuid;
  IF v_revision IS NULL OR v_step IS NULL THEN
    RETURN NEW;
  END IF;
  -- The frozen text is the pinned revision's own step text, never a live read of
  -- the protocol Record.
  SELECT element->'payload'->>'text' INTO v_frozen
    FROM api.revisions r,
         LATERAL jsonb_array_elements(coalesce(r.block_snapshot, '[]'::jsonb)) element
   WHERE r.id = v_revision AND element->>'id' = v_step::text;
  IF v_frozen IS NULL THEN
    RETURN NEW;
  END IF;
  -- Progress and annotations are not deviations; restoring the protocol text is
  -- not a new deviation either.
  IF NEW.payload->>'text' IS NOT DISTINCT FROM v_frozen THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_record FROM api.records WHERE id = NEW.record_id;
  IF v_record.id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT d.recorded_text INTO v_last FROM api.protocol_deviations d
   WHERE d.block_id = NEW.id ORDER BY d.created_at DESC, d.id DESC LIMIT 1;
  IF v_last IS NOT DISTINCT FROM NEW.payload->>'text' THEN
    RETURN NEW;
  END IF;
  INSERT INTO api.protocol_deviations(
    workspace_id, record_id, block_id, source_step_block_id,
    source_protocol_revision_id, protocol_version_id,
    frozen_text, recorded_text, created_by_user_id)
  VALUES (
    v_record.workspace_id, v_record.id, NEW.id, v_step,
    v_revision, v_record.protocol_version_id,
    v_frozen, NEW.payload->>'text', api.current_user_id())
  RETURNING id INTO v_deviation;
  PERFORM internal.emit_change_event(v_record.workspace_id, 'protocol_deviation', v_deviation, 'update',
    v_record.id, v_record.project_id,
    jsonb_build_object(
      'effect', 'protocol_deviation',
      'deviationId', v_deviation,
      'blockId', NEW.id,
      'protocolVersionId', v_record.protocol_version_id,
      'sourceProtocolRevisionId', v_revision,
      'frozenText', v_frozen,
      'recordedText', NEW.payload->>'text',
      'changes', jsonb_build_object(
        'text', jsonb_build_object('from', v_frozen, 'to', NEW.payload->>'text',
          'label', 'Protocol step text'))));
  RETURN NEW;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
