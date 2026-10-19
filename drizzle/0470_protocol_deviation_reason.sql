-- A deviation from a pinned protocol step is recorded automatically when the
-- step's text is rewritten; this adds the part only a person can supply, why.
--
-- The reason is kept on the deviation row (who wrote it and when) and the
-- change goes to the audit trail as a before/after pair, so History and review
-- read it the same way as the deviation itself. A reason can be corrected while
-- the experiment is open; a signed (locked) experiment takes no further change.
ALTER TABLE "api"."protocol_deviations"
  ADD COLUMN "reason" text,
  ADD COLUMN "reason_by_user_id" text REFERENCES internal."user"("id") ON DELETE SET NULL,
  ADD COLUMN "reason_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "api"."protocol_deviations"
  ADD CONSTRAINT "chk_protocol_deviations_reason"
  CHECK ("reason" IS NULL OR length(btrim("reason")) BETWEEN 1 AND 2000);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."record_protocol_deviation_reason"(
  p_deviation_id uuid,
  p_reason text
) RETURNS "api"."protocol_deviations"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row api.protocol_deviations;
  v_record api.records;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_previous text;
BEGIN
  SELECT * INTO v_row FROM api.protocol_deviations WHERE id = p_deviation_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.workspace_id IS DISTINCT FROM api.current_workspace_id()
    OR NOT api.is_workspace_member(v_row.workspace_id) THEN
    RAISE EXCEPTION 'deviation not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_record FROM api.records WHERE id = v_row.record_id;
  IF v_record.id IS NULL OR v_record.deleted_at IS NOT NULL
    OR NOT api.is_workspace_writer(v_row.workspace_id)
    OR NOT internal.can_access_object('record', v_row.record_id, 'edit') THEN
    RAISE EXCEPTION 'deviation not found' USING ERRCODE = '42501';
  END IF;
  IF v_record.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'a signed experiment takes no further change' USING ERRCODE = '55000';
  END IF;
  IF v_reason IS NULL OR length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'a deviation reason of 1 to 2000 characters is required' USING ERRCODE = '22023';
  END IF;
  v_previous := v_row.reason;
  IF v_previous IS NOT DISTINCT FROM v_reason THEN
    RETURN v_row;
  END IF;
  UPDATE api.protocol_deviations
     SET reason = v_reason, reason_by_user_id = api.current_user_id(), reason_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  PERFORM internal.emit_change_event(v_row.workspace_id, 'protocol_deviation', v_row.id, 'update',
    v_row.record_id, v_record.project_id,
    jsonb_build_object(
      'effect', 'protocol_deviation_reason',
      'deviationId', v_row.id,
      'blockId', v_row.block_id,
      'changes', jsonb_build_object(
        'reason', jsonb_build_object('from', v_previous, 'to', v_reason,
          'label', 'Reason for the deviation'))));
  RETURN v_row;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."record_protocol_deviation_reason"(uuid, text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."record_protocol_deviation_reason"(uuid, text) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
