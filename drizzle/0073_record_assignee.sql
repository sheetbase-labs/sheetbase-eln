-- Assign records to people.
--
-- Any record can now name one person it is assigned to, so a lead can hand a
-- batch of experiments, samples or registry entries to a colleague from a list
-- in one go. The assignee must belong to the record's workspace. Assigning
-- is an ordinary metadata edit: it checks edit access on the record, honours
-- the metadata version the caller last saw, and bumps it.

ALTER TABLE api.records ADD COLUMN assignee_user_id text;
--> statement-breakpoint
ALTER TABLE ONLY api.records
    ADD CONSTRAINT records_assignee_user_id_fkey FOREIGN KEY (assignee_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX idx_records_assignee ON api.records USING btree (assignee_user_id) WHERE assignee_user_id IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION api.assign_record(p_record_id uuid, p_expected_metadata_version integer, p_assignee_user_id text) RETURNS api.records
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.records;
BEGIN
  PERFORM internal.assert_object_access('record', p_record_id, 'edit');
  SELECT * INTO v FROM api.records
   WHERE id = p_record_id AND deleted_at IS NULL FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
  END IF;
  IF NOT api.is_workspace_writer(v.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF v.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'record is not editable' USING ERRCODE = 'SB004';
  END IF;
  IF v.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v.metadata_version USING ERRCODE = 'SB001';
  END IF;
  IF p_assignee_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM api.workspace_memberships m
        WHERE m.workspace_id = v.workspace_id
          AND m.user_id = p_assignee_user_id
     ) THEN
    RAISE EXCEPTION 'assignee is not a workspace member' USING ERRCODE = '22023';
  END IF;

  UPDATE api.records
     SET assignee_user_id = p_assignee_user_id,
         metadata_version = metadata_version + 1,
         updated_at = now(),
         updated_by_user_id = api.current_user_id()
   WHERE id = p_record_id
   RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.assign_record(p_record_id uuid, p_expected_metadata_version integer, p_assignee_user_id text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.assign_record(p_record_id uuid, p_expected_metadata_version integer, p_assignee_user_id text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.assign_record(p_record_id uuid, p_expected_metadata_version integer, p_assignee_user_id text) TO authenticated;
