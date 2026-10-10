-- New-experiment fields: a reviewer and a planned end date. Stored on the
-- experiment record so they can be surfaced (lists, review assignment) without
-- abusing the validated custom-field definitions.

ALTER TABLE api.records ADD COLUMN IF NOT EXISTS reviewer_user_id text
  REFERENCES internal."user"(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE api.records ADD COLUMN IF NOT EXISTS planned_end date;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.set_experiment_fields(
  p_record_id uuid,
  p_reviewer_user_id text DEFAULT NULL,
  p_planned_end date DEFAULT NULL
)
RETURNS api.records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
  IF NOT api.is_workspace_writer(v.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_reviewer_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM api.workspace_memberships m
        WHERE m.workspace_id = v.workspace_id
          AND m.user_id = p_reviewer_user_id
     ) THEN
    RAISE EXCEPTION 'reviewer is not a workspace member' USING ERRCODE = '22023';
  END IF;

  UPDATE api.records
     SET reviewer_user_id = p_reviewer_user_id,
         planned_end = p_planned_end,
         metadata_version = metadata_version + 1,
         updated_at = now(),
         updated_by_user_id = api.current_user_id()
   WHERE id = p_record_id
   RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_experiment_fields(uuid, text, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_experiment_fields(uuid, text, date) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
