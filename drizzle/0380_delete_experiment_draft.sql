-- EXP-03.5 - delete a draft experiment; identifiers are never reused.
--
-- A draft has no evidence behind it, so its author may clear it away instead of
-- leaving an abandoned shell in the project. Everything with evidentiary weight
-- refuses: only status 'draft' is deletable, the caller must be the author (or a
-- workspace admin), and the record must have no revisions or review submissions.
-- The restrict foreign keys on api.revisions and api.review_submissions are the
-- backstop if a new evidence table is added without updating this check.
--
-- internal.id_sequences is deliberately untouched: the identifier counter only
-- ever advances, so a deleted draft's identifier is never handed out again.
CREATE OR REPLACE FUNCTION api.delete_experiment_draft(p_record_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_record api.records;
  v_revisions integer;
  v_submissions integer;
BEGIN
  SELECT * INTO v_record FROM api.records
   WHERE id = p_record_id AND deleted_at IS NULL
   FOR UPDATE;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_record.kind <> 'experiment' THEN
    RAISE EXCEPTION 'not an experiment' USING ERRCODE = '22023';
  END IF;
  IF NOT api.is_workspace_writer(v_record.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  -- A draft is private to its author; a workspace admin may also clear one away.
  IF v_record.created_by_user_id IS DISTINCT FROM api.current_user_id()
     AND NOT api.has_capability(v_record.workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'only the author may delete this draft' USING ERRCODE = '42501';
  END IF;
  IF v_record.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft experiment can be deleted' USING ERRCODE = 'SB122';
  END IF;

  SELECT count(*) INTO v_revisions FROM api.revisions WHERE record_id = p_record_id;
  SELECT count(*) INTO v_submissions FROM api.review_submissions WHERE record_id = p_record_id;
  IF v_revisions > 0 OR v_submissions > 0 THEN
    RAISE EXCEPTION 'experiment has submitted evidence' USING ERRCODE = 'SB122';
  END IF;

  DELETE FROM api.records WHERE id = p_record_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_experiment_draft(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.delete_experiment_draft(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
