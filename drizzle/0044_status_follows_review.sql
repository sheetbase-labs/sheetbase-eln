-- A status is a fact about the review, not a field to set.
--
-- `set_experiment_status` could still put an experiment straight into In
-- review, Returned or Approved with no submission behind it, so a record could
-- say "In review" with nobody assigned and nothing in anyone's inbox, and
-- "Approved" with no approval. Those three now come only from the review
-- workflow (the trigger from 0025); this function keeps hold, resume and the
-- reopen move.
--
-- An approved experiment is also closed to edits: its notebook blocks cannot
-- be written until it is signed (which locks it) or reopened. Amending a
-- signed record unlocks it, and that returns an approved record to In
-- progress so the author can edit the new draft.
--
-- Existing rows are corrected: In review with no open submission, and Approved
-- or Returned with no matching decision, go back to In progress.

CREATE OR REPLACE FUNCTION api.set_experiment_status(p_record_id uuid, p_expected_metadata_version bigint, p_status text, p_reason text) RETURNS api.records
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records;
BEGIN
  SELECT * INTO v_record FROM api.records
   WHERE id = p_record_id AND deleted_at IS NULL FOR UPDATE;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_record.kind <> 'experiment' THEN
    RAISE EXCEPTION 'not an experiment' USING ERRCODE = '22023';
  END IF;
  IF NOT api.is_workspace_writer(v_record.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_expected_metadata_version IS NULL
     OR p_expected_metadata_version IS DISTINCT FROM v_record.metadata_version THEN
    RAISE EXCEPTION 'stale Record metadata revision' USING ERRCODE = 'SB001';
  END IF;
  IF p_status IS NULL
     OR p_status NOT IN ('draft', 'in_progress', 'on_hold', 'in_review', 'returned', 'approved') THEN
    RAISE EXCEPTION 'invalid experiment status' USING ERRCODE = '22023';
  END IF;
  IF v_record.status = p_status THEN
    RAISE EXCEPTION 'experiment already has that status' USING ERRCODE = '22023';
  END IF;
  IF p_status IN ('in_review', 'returned', 'approved') THEN
    RAISE EXCEPTION 'the review sets this status; submit the notebook for review' USING ERRCODE = 'SB116';
  END IF;
  IF p_status = 'in_progress' AND v_record.status = 'draft' THEN
    RAISE EXCEPTION 'start an experiment with api.start_experiment' USING ERRCODE = 'SB109';
  END IF;
  IF NOT (
       (v_record.status = 'in_progress' AND p_status IN ('in_review', 'on_hold'))
    OR (v_record.status = 'on_hold' AND p_status = 'in_progress')
    OR (v_record.status = 'in_review' AND p_status IN ('returned', 'approved'))
    OR (v_record.status = 'returned' AND p_status = 'in_progress')
    OR (v_record.status = 'approved' AND p_status = 'in_progress')
  ) THEN
    RAISE EXCEPTION 'illegal experiment status transition' USING ERRCODE = 'SB111';
  END IF;
  IF v_record.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'record is locked; create an amendment instead' USING ERRCODE = 'SB112';
  END IF;
  IF p_status IN ('returned', 'approved') THEN
    IF v_record.project_id IS NULL OR NOT internal.can_review_project(v_record.project_id) THEN
      RAISE EXCEPTION 'project review authority required' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_record.project_id IS NULL OR NOT internal.can_edit_project(v_record.project_id) THEN
      RAISE EXCEPTION 'project edit authority required' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_record.status <> 'draft'
     AND (p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000) THEN
    RAISE EXCEPTION 'a transition reason is required' USING ERRCODE = '22023';
  END IF;

  UPDATE api.records
     SET status = p_status,
         metadata_version = metadata_version + 1,
         updated_at = now(),
         updated_by_user_id = api.current_user_id()
   WHERE id = v_record.id
  RETURNING * INTO v_record;
  PERFORM internal.emit_change_event(v_record.workspace_id, 'record', v_record.id, 'update',
    v_record.id, v_record.project_id,
    jsonb_build_object('effect', 'experiment_status', 'status', p_status,
      'reason', btrim(coalesce(p_reason, ''))));
  RETURN v_record;
END $$;
--> statement-breakpoint

UPDATE api.records r
   SET status = 'in_progress',
       metadata_version = r.metadata_version + 1,
       updated_at = now()
 WHERE r.kind = 'experiment'
   AND r.locked_at IS NULL
   -- Records in an archived project cannot be changed, so they keep what they say.
   AND NOT EXISTS (
     SELECT 1 FROM api.projects p
      WHERE p.id = r.project_id AND p.archived_at IS NOT NULL)
   AND (
     (r.status = 'in_review' AND NOT EXISTS (
        SELECT 1 FROM api.review_submissions s
         WHERE s.record_id = r.id AND s.state = 'submitted'))
     OR (r.status = 'approved' AND NOT EXISTS (
        SELECT 1 FROM api.review_submissions s
         WHERE s.record_id = r.id AND s.state = 'approved'))
     OR (r.status = 'returned' AND NOT EXISTS (
        SELECT 1 FROM api.review_submissions s
         WHERE s.record_id = r.id AND s.state = 'returned'))
   );
--> statement-breakpoint

CREATE FUNCTION internal.trg_blocks_closed_when_approved() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record_id uuid;
BEGIN
  v_record_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.record_id ELSE NEW.record_id END;
  IF EXISTS (
    SELECT 1 FROM api.records
     WHERE id = v_record_id
       AND kind = 'experiment'
       AND status = 'approved'
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'this experiment is approved; reopen or amend it to change the notebook'
      USING ERRCODE = 'SB116';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_blocks_closed_when_approved() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER blocks_closed_when_approved
  BEFORE INSERT OR UPDATE OR DELETE ON api.blocks
  FOR EACH ROW EXECUTE FUNCTION internal.trg_blocks_closed_when_approved();
--> statement-breakpoint

CREATE FUNCTION internal.trg_amendment_reopens_approved() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL AND NEW.locked_at IS NULL AND NEW.status = 'approved' THEN
    NEW.status := 'in_progress';
    NEW.metadata_version := NEW.metadata_version + 1;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_amendment_reopens_approved() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER amendment_reopens_approved
  BEFORE UPDATE OF locked_at ON api.records
  FOR EACH ROW EXECUTE FUNCTION internal.trg_amendment_reopens_approved();
