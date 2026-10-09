-- LAB-07 — editing linked protocol text inside a notebook records a deviation.
--
-- `api.pin_protocol_reference` copies a protocol's procedure steps into the
-- experiment and keeps their provenance (`sourceProtocolRevisionId`,
-- `sourceStepBlockId`). Execution progress (`completed`, `note`) is not a
-- deviation; rewriting the step's scientific text away from the frozen revision
-- is. The trigger records the frozen and recorded text, the exact protocol
-- version the experiment started on, and an audit event, so the deviation
-- appears in the experiment's History and review.
DO $$ DECLARE expression text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO expression FROM pg_constraint
    WHERE conrelid='api.change_events'::regclass AND conname='chk_change_events_entity_type';
  IF strpos(expression,'''protocol_version''::text')=0 THEN RAISE EXCEPTION 'Unexpected event vocabulary'; END IF;
  IF strpos(expression,'''protocol_deviation''::text')>0 THEN RETURN; END IF;
  expression:=replace(expression,'''protocol_version''::text','''protocol_version''::text, ''protocol_deviation''::text');
  ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type '||expression;
END $$;
--> statement-breakpoint

CREATE TABLE "api"."protocol_deviations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "api"."workspaces"("id") ON DELETE CASCADE,
  "record_id" uuid NOT NULL REFERENCES "api"."records"("id") ON DELETE CASCADE,
  "block_id" uuid NOT NULL REFERENCES "api"."blocks"("id") ON DELETE CASCADE,
  "source_step_block_id" uuid,
  "source_protocol_revision_id" uuid REFERENCES "api"."revisions"("id") ON DELETE SET NULL,
  "protocol_version_id" uuid REFERENCES "api"."protocol_versions"("id") ON DELETE SET NULL,
  "frozen_text" text NOT NULL,
  "recorded_text" text NOT NULL,
  "created_by_user_id" text REFERENCES internal."user"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "idx_protocol_deviations_record" ON "api"."protocol_deviations" ("record_id");
--> statement-breakpoint
CREATE INDEX "idx_protocol_deviations_workspace" ON "api"."protocol_deviations" ("workspace_id");
--> statement-breakpoint

ALTER TABLE "api"."protocol_deviations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "api"."protocol_deviations" FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT ON "api"."protocol_deviations" TO authenticated;
--> statement-breakpoint
-- Reads follow the experiment's own read authority; writes happen only through
-- the trigger below, so no insert/update/delete policy exists for request roles.
CREATE POLICY "protocol_deviations_select" ON "api"."protocol_deviations"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"("workspace_id")
    AND "internal"."can_access_object"('record', "record_id", 'view'));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "internal"."protocol_step_deviation"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_frozen text;
  v_revision uuid;
  v_step uuid;
  v_record api.records;
  v_last text;
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
  RETURNING id INTO v_step;
  PERFORM internal.emit_change_event(v_record.workspace_id, 'protocol_deviation', v_step, 'create',
    v_record.id, v_record.project_id,
    jsonb_build_object('deviationId', v_step, 'blockId', NEW.id,
      'protocolVersionId', v_record.protocol_version_id,
      'sourceProtocolRevisionId', v_revision, 'frozenText', v_frozen,
      'recordedText', NEW.payload->>'text'));
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "internal"."protocol_step_deviation"() FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE TRIGGER protocol_step_deviation AFTER UPDATE ON api.blocks
  FOR EACH ROW EXECUTE FUNCTION internal.protocol_step_deviation();
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
