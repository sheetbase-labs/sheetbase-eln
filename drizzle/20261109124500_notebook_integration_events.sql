-- Notebook work on the change feed: protocol training and trained records.
--
-- Comments, files, protocol versions and step deviations already write to the
-- change feed. What was missing: someone being given a protocol to train on (and
-- taken off it) and someone being recorded as trained on a version. Each is
-- written by a trigger on its table, so it fires however the change was made:
-- from the page, the API, the assistant or a pipeline.

-- New kinds of thing on the change feed.
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
  IF position('''protocol_training''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''protocol_training''::text, ''protocol_acknowledgement''::text]');
  END IF;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('comment.created'), ('comment.resolved'), ('comment.reopened'),
  ('protocol.version.created'), ('protocol.version.updated'),
  ('protocol.deviation.updated'),
  ('protocol.training.assigned'), ('protocol.training.removed'),
  ('protocol.acknowledged'),
  ('file.uploaded'), ('file.version.added'),
  ('file.quarantined'), ('file.deleted'), ('file.restored')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- A person is given a protocol to train on, or taken off it.
CREATE FUNCTION internal.trg_change_event_protocol_training() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.protocol_training := CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  v_record api.records;
BEGIN
  SELECT * INTO v_record FROM api.records WHERE id = v_row.protocol_record_id;
  PERFORM internal.emit_change_event(v_row.workspace_id, 'protocol_training', v_row.id,
    CASE TG_OP WHEN 'DELETE' THEN 'delete' ELSE 'create' END,
    v_row.protocol_record_id, v_record.project_id,
    jsonb_build_object('protocolRecordId', v_row.protocol_record_id,
                       'identifier', v_record.identifier, 'title', v_record.title,
                       'userId', v_row.user_id, 'dueAt', v_row.due_at));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_protocol_training() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_protocol_training
  AFTER INSERT OR DELETE ON api.protocol_training
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_protocol_training();
--> statement-breakpoint

-- A person is recorded as having read or been trained on a protocol version.
CREATE FUNCTION internal.trg_change_event_protocol_acknowledgement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_version api.protocol_versions;
  v_record api.records;
BEGIN
  SELECT * INTO v_version FROM api.protocol_versions WHERE id = NEW.protocol_version_id;
  SELECT * INTO v_record FROM api.records WHERE id = v_version.protocol_record_id;
  PERFORM internal.emit_change_event(NEW.workspace_id, 'protocol_acknowledgement', NEW.id, 'create',
    v_version.protocol_record_id, v_record.project_id,
    jsonb_build_object('protocolRecordId', v_version.protocol_record_id,
                       'protocolVersionId', NEW.protocol_version_id,
                       'version', v_version.version,
                       'identifier', v_record.identifier, 'title', v_record.title,
                       'userId', NEW.user_id, 'recordedByUserId', NEW.recorded_by_user_id));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_protocol_acknowledgement() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_protocol_acknowledgement
  AFTER INSERT ON api.protocol_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_protocol_acknowledgement();
--> statement-breakpoint

-- Quarantine, restore and delete a file, as calls of their own over the general
-- status call.
CREATE FUNCTION api.quarantine_file(p_file_id uuid, p_expected_version integer, p_reason text DEFAULT NULL)
    RETURNS api.file_objects
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  SELECT * FROM api.transition_file_status(p_file_id, 'quarantined', p_expected_version, p_reason)
$$;
--> statement-breakpoint
ALTER FUNCTION api.quarantine_file(uuid, integer, text) OWNER TO migrator;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.quarantine_file(uuid, integer, text) TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.restore_file(p_file_id uuid, p_expected_version integer)
    RETURNS api.file_objects
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  SELECT * FROM api.transition_file_status(p_file_id, 'active', p_expected_version, NULL)
$$;
--> statement-breakpoint
ALTER FUNCTION api.restore_file(uuid, integer) OWNER TO migrator;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.restore_file(uuid, integer) TO authenticated;

--> statement-breakpoint
--> statement-breakpoint
CREATE FUNCTION api.delete_file(p_file_id uuid, p_expected_version integer, p_reason text DEFAULT NULL)
    RETURNS api.file_objects
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  SELECT * FROM api.transition_file_status(p_file_id, 'deleted', p_expected_version, p_reason)
$$;
--> statement-breakpoint
ALTER FUNCTION api.delete_file(uuid, integer, text) OWNER TO migrator;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.delete_file(uuid, integer, text) TO authenticated;
--> statement-breakpoint

-- A pipeline can run these notebook actions. The database's copy of the action
-- catalogue (checked when a pipeline is saved) gains them.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"create_record_comment","rpc":"create_record_comment","label":"Comment on a notebook","description":"Starts a comment thread on a notebook or on one block of it. `p_target_kind` is `record` or `block` and `p_target` names the block. Returns the comment.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_target_kind","type":"text","required":true,"nullable":false},{"name":"p_target","type":"jsonb","required":true,"nullable":false},{"name":"p_body","type":"text","required":true,"nullable":false},{"name":"p_mentions","type":"text[]","required":false,"nullable":false}]},{"operation":"reply_to_comment","rpc":"reply_to_comment","label":"Reply to a comment","description":"Adds a reply to a comment thread. Returns the reply.","arguments":[{"name":"p_parent_id","type":"uuid","required":true,"nullable":false},{"name":"p_body","type":"text","required":true,"nullable":false},{"name":"p_mentions","type":"text[]","required":false,"nullable":false}]},{"operation":"resolve_comment_thread","rpc":"resolve_comment_thread","label":"Resolve a comment thread","description":"Marks a comment thread as resolved. Returns the thread.","arguments":[{"name":"p_comment_id","type":"uuid","required":true,"nullable":false}]},{"operation":"reopen_comment_thread","rpc":"reopen_comment_thread","label":"Reopen a comment thread","description":"Opens a resolved comment thread again. Returns the thread.","arguments":[{"name":"p_comment_id","type":"uuid","required":true,"nullable":false}]},{"operation":"quarantine_file","rpc":"quarantine_file","label":"Quarantine a file","description":"Takes a file out of use, for example after a virus warning. A quarantined file cannot be downloaded until it is restored. Returns the file.","arguments":[{"name":"p_file_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_version","type":"integer","required":true,"nullable":false},{"name":"p_reason","type":"text","required":false,"nullable":false}]},{"operation":"restore_file","rpc":"restore_file","label":"Restore a file","description":"Brings a quarantined file back into use. Returns the file.","arguments":[{"name":"p_file_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_version","type":"integer","required":true,"nullable":false}]},{"operation":"delete_file","rpc":"delete_file","label":"Delete a file","description":"Marks a file deleted. The bytes are kept for the retention period and a deleted file can be restored. Returns the file.","arguments":[{"name":"p_file_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_version","type":"integer","required":true,"nullable":false},{"name":"p_reason","type":"text","required":false,"nullable":false}]},{"operation":"create_protocol_version","rpc":"create_protocol_version","label":"Start a new protocol version","description":"Freezes the protocol as it is now into a new draft version, with a summary of what changed. Returns the version.","arguments":[{"name":"p_protocol_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_change_summary","type":"text","required":true,"nullable":false},{"name":"p_reason","type":"text","required":false,"nullable":false}]},{"operation":"set_protocol_version_status","rpc":"set_protocol_version_status","label":"Change a protocol version’s status","description":"Moves a version between `draft`, `in_review`, `effective`, `superseded` and `retired`. A version cannot become effective until its approvals are in; the database refuses it. Returns the version.","arguments":[{"name":"p_version_id","type":"uuid","required":true,"nullable":false},{"name":"p_status","type":"text","required":true,"nullable":false},{"name":"p_reason","type":"text","required":false,"nullable":false},{"name":"p_effective_at","type":"timestamptz","required":false,"nullable":false}]},{"operation":"confirm_protocol_version_current","rpc":"confirm_protocol_version_current","label":"Confirm a protocol version is still current","description":"Records that an effective version was reviewed and is still right, and when the next review is due. Needs the right to edit schemas. Returns the version.","arguments":[{"name":"p_version_id","type":"uuid","required":true,"nullable":false},{"name":"p_next_review_due_at","type":"timestamptz","required":false,"nullable":false},{"name":"p_reason","type":"text","required":false,"nullable":false}]},{"operation":"assign_protocol_training","rpc":"assign_protocol_training","label":"Give someone a protocol to train on","description":"Asks a person to be trained on a protocol, with an optional due date. Returns the assignment.","arguments":[{"name":"p_protocol_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false},{"name":"p_due_at","type":"timestamptz","required":false,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":false}]},{"operation":"unassign_protocol_training","rpc":"unassign_protocol_training","label":"Take someone off a protocol’s training","description":"Removes a person from a protocol’s training list.","arguments":[{"name":"p_protocol_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false}]},{"operation":"record_protocol_trained","rpc":"record_protocol_trained","label":"Record someone as trained on a protocol","description":"Records that a person was trained on a version of a protocol, by the person who trained them. Returns the record.","arguments":[{"name":"p_version_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":false}]},{"operation":"record_protocol_deviation_reason","rpc":"record_protocol_deviation_reason","label":"Give the reason for a protocol deviation","description":"Records why a step was done differently from the protocol. Returns the deviation.","arguments":[{"name":"p_deviation_id","type":"uuid","required":true,"nullable":false},{"name":"p_reason","type":"text","required":true,"nullable":false}]},{"operation":"submit_approval_request","rpc":"submit_approval_request","label":"Ask for an approval","description":"Asks people in the named roles to approve something, such as a dataset schema version. Deciding it stays with them in the app. Returns the request.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_object_kind","type":"text","required":true,"nullable":false},{"name":"p_object_id","type":"uuid","required":true,"nullable":false},{"name":"p_required_approver_roles","type":"text[]","required":true,"nullable":false},{"name":"p_reason","type":"text","required":true,"nullable":false},{"name":"p_require_independence","type":"boolean","required":false,"nullable":false},{"name":"p_required_approvals","type":"integer","required":false,"nullable":false},{"name":"p_object_revision","type":"bigint","required":false,"nullable":false}]},{"operation":"withdraw_approval_request","rpc":"withdraw_approval_request","label":"Withdraw an approval request","description":"Takes back a request that is still waiting. Returns the request.","arguments":[{"name":"p_request_id","type":"uuid","required":true,"nullable":false},{"name":"p_reason","type":"text","required":false,"nullable":false}]}]$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || '$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- A pipeline can start on a comment, a file, a protocol or an approval request.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  IF position('''storage.alarm.raised'', ''storage.alarm.cleared'', ''watcher.finding.created''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_def := replace(v_def, '''storage.alarm.raised'', ''storage.alarm.cleared'', ''watcher.finding.created''',
    '''storage.alarm.raised'', ''storage.alarm.cleared'', ''watcher.finding.created'', ''approval.requested'', ''file.uploaded'', ''file.version.added'', ''file.deleted'', ''file.quarantined'', ''file.restored'', ''comment.created'', ''comment.resolved'', ''comment.reopened'', ''protocol.version.created'', ''protocol.version.updated'', ''protocol.training.assigned'', ''protocol.training.removed'', ''protocol.acknowledged'', ''protocol.deviation.updated''');
  EXECUTE v_def;
END $$;
