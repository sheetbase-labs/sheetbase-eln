ALTER TABLE "api"."records" ADD COLUMN "decision" text;--> statement-breakpoint
ALTER TABLE "api"."records" ADD COLUMN "decision_notes" text;--> statement-breakpoint
ALTER TABLE "api"."records" ADD CONSTRAINT "chk_records_decision"
  CHECK ("decision" IS NULL OR "decision" IN ('supported', 'refuted', 'inconclusive'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.set_experiment_decision(
  p_record_id uuid,
  p_decision text,
  p_notes text DEFAULT NULL
)
RETURNS api.records
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.records;
BEGIN
  SELECT * INTO v FROM api.records
   WHERE id = p_record_id AND deleted_at IS NULL FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
  END IF;
  IF v.kind <> 'experiment' THEN
    RAISE EXCEPTION 'not an experiment' USING ERRCODE = '22023';
  END IF;
  IF api.current_workspace_id() IS DISTINCT FROM v.workspace_id
     OR NOT api.is_workspace_writer(v.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NOT NULL
     AND p_decision NOT IN ('supported', 'refuted', 'inconclusive') THEN
    RAISE EXCEPTION 'invalid decision' USING ERRCODE = '22023';
  END IF;
  UPDATE api.records
     SET decision = p_decision,
         decision_notes = p_notes,
         metadata_version = metadata_version + 1,
         updated_at = now(),
         updated_by_user_id = api.current_user_id()
   WHERE id = p_record_id
   RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_experiment_decision(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_experiment_decision(uuid, text, text) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
