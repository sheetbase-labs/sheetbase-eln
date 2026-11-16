-- Undo for what the assistant changed. A "change set" remembers the stretch of
-- the audit trail (api.change_events) that one assistant card or plan wrote, as
-- the person who approved it. Nothing about the changes is copied: what was
-- made is read back from the audit trail, and a before-image of each existing
-- record the stretch edited is kept so its fields can be put back.
--
--   begin_ai_change_set   opens a window (a plan that pauses opens another)
--   finish_ai_change_set  closes it; a set that changed nothing is dropped
--   preview_ai_undo       says what undoing would do, and what stops it
--   undo_ai_change_set    does it, all or nothing, as the person
--
-- Only what can be put back cleanly is undone: records and projects the set
-- made are archived, bookings cancelled, notebook blocks it added removed and
-- the fields it edited on an existing record restored. Anything signed,
-- locked, submitted, edited by someone else afterwards or of a kind that cannot
-- be taken back stops the whole undo, and nothing is touched.

CREATE TABLE api.ai_change_sets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    title text NOT NULL,
    kind text NOT NULL,
    -- [{"from": <sequence before the first change>, "to": <sequence after the last>}]
    windows jsonb DEFAULT '[]'::jsonb NOT NULL,
    -- Steps whose changes the audit trail does not carry: [{"title": "..."}]
    untracked jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    undone_at timestamp with time zone,
    CONSTRAINT ai_change_sets_pkey PRIMARY KEY (id),
    CONSTRAINT ai_change_sets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT ai_change_sets_user_id_fkey FOREIGN KEY (user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT chk_ai_change_sets_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT chk_ai_change_sets_kind CHECK (kind IN ('card', 'plan')),
    CONSTRAINT chk_ai_change_sets_status CHECK (status IN ('open', 'applied', 'undone')),
    CONSTRAINT chk_ai_change_sets_windows CHECK (jsonb_typeof(windows) = 'array' AND jsonb_array_length(windows) <= 50),
    CONSTRAINT chk_ai_change_sets_untracked CHECK (jsonb_typeof(untracked) = 'array' AND jsonb_array_length(untracked) <= 50)
);
--> statement-breakpoint
ALTER TABLE api.ai_change_sets OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_ai_change_sets_user_created ON api.ai_change_sets (user_id, workspace_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_ai_change_sets_open ON api.ai_change_sets (user_id, workspace_id) WHERE status = 'open';
--> statement-breakpoint
ALTER TABLE api.ai_change_sets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_change_sets_select ON api.ai_change_sets FOR SELECT TO authenticated
    USING (user_id = api.current_user_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
-- Undoing marks the set; nothing else about it can be changed by the person.
CREATE POLICY ai_change_sets_update ON api.ai_change_sets FOR UPDATE TO authenticated
    USING (user_id = api.current_user_id() AND api.is_workspace_member(workspace_id))
    WITH CHECK (user_id = api.current_user_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.ai_change_sets TO authenticated;
--> statement-breakpoint
GRANT UPDATE (status, undone_at) ON TABLE api.ai_change_sets TO authenticated;
--> statement-breakpoint

-- The before-image of each record a set edited (the first edit wins). Kept out
-- of the api schema: the preview and the undo read it on the person's behalf.
CREATE TABLE internal.ai_change_snapshots (
    set_id uuid NOT NULL,
    record_id uuid NOT NULL,
    before jsonb NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_change_snapshots_pkey PRIMARY KEY (set_id, record_id),
    CONSTRAINT ai_change_snapshots_set_id_fkey FOREIGN KEY (set_id) REFERENCES api.ai_change_sets(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE internal.ai_change_snapshots OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON TABLE internal.ai_change_snapshots FROM PUBLIC;
--> statement-breakpoint

-- Change events and webhook names --------------------------------------------

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
  IF position('''assistant_change_set''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''assistant_change_set''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO internal.webhook_event_names (name) VALUES ('assistant.changes.undone') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO internal.pipeline_trigger_events (name) VALUES ('assistant.changes.undone') ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Marking a set undone tells the workspace (the actions themselves already
-- emitted their own events as the person).
CREATE FUNCTION internal.ai_change_set_undone() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.status = 'undone' AND OLD.status IS DISTINCT FROM 'undone' THEN
    PERFORM internal.emit_change_event(NEW.workspace_id, 'assistant_change_set', NEW.id, 'update', NULL, NULL,
      jsonb_build_object('changeSetId', NEW.id, 'title', NEW.title, 'kind', NEW.kind, 'effect', 'undone'));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.ai_change_set_undone() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER ai_change_set_undone AFTER UPDATE ON api.ai_change_sets
    FOR EACH ROW EXECUTE FUNCTION internal.ai_change_set_undone();
--> statement-breakpoint

-- Before-images ---------------------------------------------------------------

-- While a person has a set open, the first edit to each record keeps what the
-- record looked like before, so its fields can be put back.
CREATE FUNCTION internal.ai_change_capture() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user text := api.current_user_id();
  v_set uuid;
BEGIN
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.id INTO v_set
    FROM api.ai_change_sets s
   WHERE s.user_id = v_user AND s.workspace_id = NEW.workspace_id
     AND s.status = 'open' AND s.opened_at > now() - interval '2 hours'
   ORDER BY s.opened_at DESC
   LIMIT 1;
  IF v_set IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO internal.ai_change_snapshots (set_id, record_id, before)
  VALUES (v_set, OLD.id, jsonb_build_object(
    'title', OLD.title, 'status', OLD.status, 'tags', to_jsonb(OLD.tags),
    'customFields', OLD.custom_fields, 'properties', OLD.properties,
    'assigneeUserId', OLD.assignee_user_id, 'folderId', OLD.folder_id,
    'projectId', OLD.project_id))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.ai_change_capture() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER ai_change_capture BEFORE UPDATE ON api.records
    FOR EACH ROW
    WHEN (OLD.title IS DISTINCT FROM NEW.title
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.tags IS DISTINCT FROM NEW.tags
       OR OLD.custom_fields IS DISTINCT FROM NEW.custom_fields
       OR OLD.properties IS DISTINCT FROM NEW.properties
       OR OLD.assignee_user_id IS DISTINCT FROM NEW.assignee_user_id
       OR OLD.folder_id IS DISTINCT FROM NEW.folder_id
       OR OLD.project_id IS DISTINCT FROM NEW.project_id)
    EXECUTE FUNCTION internal.ai_change_capture();
--> statement-breakpoint

-- Opening and closing a set -----------------------------------------------------

-- Opens a window on the audit trail. Pass an existing set to open another
-- window on it (a plan that paused and carries on). Returns the set.
CREATE FUNCTION api.begin_ai_change_set(
    p_title text,
    p_kind text DEFAULT 'plan',
    p_set_id uuid DEFAULT NULL
) RETURNS api.ai_change_sets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user text := api.current_user_id();
  v_workspace uuid := api.current_workspace_id();
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_seq bigint;
  v api.ai_change_sets;
BEGIN
  IF v_user IS NULL OR v_workspace IS NULL THEN
    RAISE EXCEPTION 'begin_ai_change_set requires an authenticated user in a workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT api.is_workspace_writer(v_workspace) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('card', 'plan') THEN
    RAISE EXCEPTION 'kind must be card or plan' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(max(q.last_seq), 0) INTO v_seq
    FROM api.workspace_change_seq q WHERE q.workspace_id = v_workspace;
  IF p_set_id IS NOT NULL THEN
    UPDATE api.ai_change_sets s
       SET windows = s.windows || jsonb_build_array(jsonb_build_object('from', v_seq)),
           status = 'open', opened_at = now()
     WHERE s.id = p_set_id AND s.user_id = v_user AND s.workspace_id = v_workspace
       AND s.status IN ('open', 'applied')
    RETURNING * INTO v;
    IF v.id IS NULL THEN
      RAISE EXCEPTION 'change set not found' USING ERRCODE = '42501';
    END IF;
    RETURN v;
  END IF;
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'a change set needs a title' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.ai_change_sets (workspace_id, user_id, title, kind, windows)
  VALUES (v_workspace, v_user, left(v_title, 200), p_kind,
          jsonb_build_array(jsonb_build_object('from', v_seq)))
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint

-- What a set wrote: the audit events inside its windows, by the same person.
CREATE FUNCTION internal.ai_set_events(p_set_id uuid) RETURNS SETOF api.change_events
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT e.*
    FROM api.change_events e
    JOIN api.ai_change_sets s ON s.id = p_set_id
   WHERE e.workspace_id = s.workspace_id
     AND e.actor_user_id = s.user_id
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(s.windows) w
        WHERE e.sequence > (w ->> 'from')::bigint
          AND e.sequence <= coalesce((w ->> 'to')::bigint, 9223372036854775807))
$$;
--> statement-breakpoint

-- Closes the last window. A set that changed nothing and has nothing to flag is
-- dropped (returns null). `p_untracked` lists steps whose changes the audit
-- trail does not carry, so the preview can say they stay.
CREATE FUNCTION api.finish_ai_change_set(p_set_id uuid, p_untracked jsonb DEFAULT '[]'::jsonb)
    RETURNS api.ai_change_sets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user text := api.current_user_id();
  v_workspace uuid := api.current_workspace_id();
  v_seq bigint;
  v api.ai_change_sets;
  v_last int;
BEGIN
  IF v_user IS NULL OR v_workspace IS NULL THEN
    RAISE EXCEPTION 'finish_ai_change_set requires an authenticated user in a workspace' USING ERRCODE = '42501';
  END IF;
  IF p_untracked IS NULL OR jsonb_typeof(p_untracked) <> 'array' THEN
    RAISE EXCEPTION 'untracked must be an array' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM api.ai_change_sets s
   WHERE s.id = p_set_id AND s.user_id = v_user AND s.workspace_id = v_workspace
   FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'change set not found' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(max(q.last_seq), 0) INTO v_seq
    FROM api.workspace_change_seq q WHERE q.workspace_id = v_workspace;
  v_last := jsonb_array_length(v.windows) - 1;
  IF v_last >= 0 AND NOT (v.windows -> v_last) ? 'to' THEN
    v.windows := jsonb_set(v.windows, ARRAY[v_last::text, 'to'], to_jsonb(v_seq));
  END IF;
  UPDATE api.ai_change_sets s
     SET windows = v.windows,
         untracked = (s.untracked || p_untracked),
         status = CASE WHEN s.status = 'undone' THEN s.status ELSE 'applied' END
   WHERE s.id = v.id
  RETURNING * INTO v;
  IF NOT EXISTS (SELECT 1 FROM internal.ai_set_events(v.id))
     AND jsonb_array_length(v.untracked) = 0 THEN
    DELETE FROM api.ai_change_sets WHERE id = v.id;
    RETURN NULL;
  END IF;
  RETURN v;
END $$;
--> statement-breakpoint

-- Previewing and undoing -------------------------------------------------------

-- Why a record cannot be put back, or null. Signed, locked, submitted or
-- already decided work is never touched.
CREATE FUNCTION internal.ai_record_blocker(p_record api.records) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_record.locked_at IS NOT NULL THEN
    RETURN 'It is locked.';
  END IF;
  IF EXISTS (SELECT 1 FROM api.signatures g WHERE g.record_id = p_record.id) THEN
    RETURN 'It has been signed.';
  END IF;
  IF EXISTS (SELECT 1 FROM api.review_submissions r WHERE r.record_id = p_record.id) THEN
    RETURN 'It has been submitted for review.';
  END IF;
  IF p_record.status IN ('in_review', 'approved', 'returned') THEN
    RETURN 'It has been through review.';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

-- Why something the set touched has changed since, or null: any change to it
-- by someone else, or by the same person outside the set.
CREATE FUNCTION internal.ai_later_change(p_set_id uuid, p_entity uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s api.ai_change_sets;
  v_first bigint;
  v_actor text;
  v_name text;
  v_found boolean := false;
BEGIN
  SELECT * INTO s FROM api.ai_change_sets WHERE id = p_set_id;
  SELECT min((w ->> 'from')::bigint) INTO v_first FROM jsonb_array_elements(s.windows) w;
  SELECT true, e.actor_user_id, u.name INTO v_found, v_actor, v_name
    FROM api.change_events e
    LEFT JOIN internal."user" u ON u.id = e.actor_user_id
   WHERE e.workspace_id = s.workspace_id
     AND e.sequence > coalesce(v_first, 0)
     AND (e.entity_uuid = p_entity OR e.record_id = p_entity
          OR e.payload ->> 'booking_id' = p_entity::text
          OR e.payload ->> 'blockId' = p_entity::text)
     AND NOT EXISTS (SELECT 1 FROM internal.ai_set_events(p_set_id) own WHERE own.id = e.id)
   ORDER BY (e.actor_user_id IS DISTINCT FROM s.user_id) DESC, e.sequence
   LIMIT 1;
  IF NOT coalesce(v_found, false) THEN
    RETURN NULL;
  END IF;
  IF v_actor IS DISTINCT FROM s.user_id THEN
    RETURN coalesce(v_name, 'Someone else') || ' changed it afterwards.';
  END IF;
  RETURN 'It was changed again after this.';
END $$;
--> statement-breakpoint

-- Plain words for a change that cannot be taken back.
CREATE FUNCTION internal.ai_change_words(p_entity_type text, p_operation text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN p_entity_type = 'comment' THEN 'A comment was posted'
    WHEN p_entity_type = 'record_link' THEN 'A record was linked'
    WHEN p_entity_type IN ('storage_position', 'storage_movement', 'sample_event') THEN 'A sample was placed or moved'
    WHEN p_entity_type = 'sample_reservation' THEN 'Sample was set aside'
    WHEN p_entity_type = 'project_access' THEN 'Someone was given access'
    WHEN p_entity_type = 'plate_run' THEN 'A plate was set up'
    WHEN p_entity_type = 'study_task' THEN 'A study task was changed'
    ELSE 'A ' || replace(p_entity_type, '_', ' ') || ' was ' ||
         CASE p_operation WHEN 'create' THEN 'added' WHEN 'delete' THEN 'removed' ELSE 'changed' END
  END
$$;
--> statement-breakpoint

-- What undoing would do. `items` lists each thing with its state: ok (will be
-- undone), already (nothing to do) or blocked (with the reason). `canUndo` is
-- true only when nothing is blocked and there is something to undo.
CREATE FUNCTION api.preview_ai_undo(p_set_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user text := api.current_user_id();
  s api.ai_change_sets;
  items jsonb := '[]'::jsonb;
  r record;
  rec api.records;
  v_reason text;
  v_state text;
  v_created uuid[];
  v_projects uuid[];
  v_bookings uuid[];
  v_blocks uuid[];
  v_edited uuid[];
  v_diff jsonb;
  v_before jsonb;
  v_key text;
  v_old jsonb;
  v_new jsonb;
  v_label text;
  v_blocked int := 0;
  v_ok int := 0;
  v_untracked jsonb;
  b api.calendar_bookings;
  p api.projects;
  blk api.blocks;
  v_other_count int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'preview_ai_undo requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM api.ai_change_sets
   WHERE id = p_set_id AND user_id = v_user AND workspace_id = api.current_workspace_id();
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'change set not found' USING ERRCODE = '42501';
  END IF;

  IF s.status = 'undone' THEN
    RETURN jsonb_build_object('setId', s.id, 'title', s.title, 'kind', s.kind, 'status', s.status,
      'canUndo', false, 'items', '[]'::jsonb, 'blocked', 0, 'toUndo', 0);
  END IF;

  SELECT coalesce(array_agg(DISTINCT e.entity_uuid), '{}') INTO v_created
    FROM internal.ai_set_events(s.id) e WHERE e.entity_type = 'record' AND e.operation = 'create';
  SELECT coalesce(array_agg(DISTINCT e.entity_uuid), '{}') INTO v_projects
    FROM internal.ai_set_events(s.id) e WHERE e.entity_type = 'project' AND e.operation = 'create';
  SELECT coalesce(array_agg(DISTINCT e.entity_uuid), '{}') INTO v_bookings
    FROM internal.ai_set_events(s.id) e WHERE e.entity_type = 'calendar_booking' AND e.operation = 'create';
  -- Blocks the set added to records that already existed.
  SELECT coalesce(array_agg(DISTINCT e.entity_uuid), '{}') INTO v_blocks
    FROM internal.ai_set_events(s.id) e
   WHERE e.entity_type = 'block' AND e.operation = 'create'
     AND NOT (e.record_id = ANY (v_created)) AND NOT (e.project_id = ANY (v_projects));
  -- Existing records whose fields the set edited (there is a before-image).
  SELECT coalesce(array_agg(DISTINCT n.record_id), '{}') INTO v_edited
    FROM internal.ai_change_snapshots n
   WHERE n.set_id = s.id AND NOT (n.record_id = ANY (v_created));

  -- Records the set made: archived (a sample through its own call).
  FOR r IN
    SELECT DISTINCT ON (e.entity_uuid) e.entity_uuid AS id, e.sequence
      FROM internal.ai_set_events(s.id) e
     WHERE e.entity_type = 'record' AND e.operation = 'create'
     ORDER BY e.entity_uuid, e.sequence
  LOOP
    SELECT * INTO rec FROM api.records WHERE id = r.id;
    v_reason := NULL;
    v_state := 'ok';
    IF rec.id IS NULL OR rec.deleted_at IS NOT NULL OR rec.archived_at IS NOT NULL THEN
      v_state := 'already';
    ELSE
      v_reason := coalesce(internal.ai_record_blocker(rec), internal.ai_later_change(s.id, rec.id));
      IF v_reason IS NOT NULL THEN v_state := 'blocked'; END IF;
    END IF;
    items := items || jsonb_build_array(jsonb_build_object(
      'key', 'record:' || r.id, 'kind', 'record',
      'action', CASE WHEN rec.kind = 'sample' THEN 'archive_sample' ELSE 'archive_record' END,
      'verb', 'Archive',
      'label', coalesce(rec.identifier || ' ' || rec.title, 'A record that is gone'),
      'recordKind', rec.kind,
      'href', CASE WHEN rec.id IS NULL THEN NULL ELSE '/records/' || rec.id END,
      'state', v_state, 'reason', v_reason,
      'args', jsonb_build_object('id', r.id, 'version', rec.metadata_version)));
  END LOOP;

  -- Projects the set made: archived.
  FOR r IN SELECT unnest(v_projects) AS id LOOP
    SELECT * INTO p FROM api.projects WHERE id = r.id;
    v_reason := NULL;
    v_state := 'ok';
    IF p.id IS NULL OR p.archived_at IS NOT NULL THEN
      v_state := 'already';
    ELSE
      v_reason := internal.ai_later_change(s.id, p.id);
      IF v_reason IS NULL AND NOT EXISTS (
        SELECT 1 FROM api.workspace_memberships m
        WHERE m.workspace_id = p.workspace_id
          AND m.user_id = api.current_user_id()
          AND m.suspended_at IS NULL
          AND m.role IN ('owner', 'admin')
      ) THEN
        v_reason := 'Archiving a project needs an admin. Ask one to archive it.';
      END IF;
      IF v_reason IS NOT NULL THEN v_state := 'blocked'; END IF;
    END IF;
    items := items || jsonb_build_array(jsonb_build_object(
      'key', 'project:' || r.id, 'kind', 'project', 'action', 'archive_project', 'verb', 'Archive',
      'label', coalesce(p.title, 'A project that is gone'),
      'href', CASE WHEN p.id IS NULL THEN NULL ELSE '/projects/' || p.id END,
      'state', v_state, 'reason', v_reason,
      'args', jsonb_build_object('id', r.id)));
  END LOOP;

  -- Bookings the set made: cancelled.
  FOR r IN SELECT unnest(v_bookings) AS id LOOP
    SELECT * INTO b FROM api.calendar_bookings WHERE id = r.id;
    v_reason := NULL;
    v_state := 'ok';
    IF b.id IS NULL OR b.status = 'cancelled' THEN
      v_state := 'already';
    ELSE
      v_reason := internal.ai_later_change(s.id, b.id);
      IF v_reason IS NOT NULL THEN v_state := 'blocked'; END IF;
    END IF;
    items := items || jsonb_build_array(jsonb_build_object(
      'key', 'booking:' || r.id, 'kind', 'booking', 'action', 'cancel_booking', 'verb', 'Cancel',
      'label', coalesce(b.display_id || ' ' || b.title, 'A booking that is gone'),
      'href', '/schedule',
      'state', v_state, 'reason', v_reason,
      'args', jsonb_build_object('id', r.id, 'version', b.metadata_version)));
  END LOOP;

  -- Blocks the set added to older records: removed.
  FOR r IN SELECT unnest(v_blocks) AS id LOOP
    SELECT * INTO blk FROM api.blocks WHERE id = r.id;
    v_reason := NULL;
    v_state := 'ok';
    IF blk.id IS NULL THEN
      v_state := 'already';
    ELSE
      SELECT * INTO rec FROM api.records WHERE id = blk.record_id;
      v_reason := coalesce(internal.ai_record_blocker(rec), internal.ai_later_change(s.id, blk.id));
      IF v_reason IS NOT NULL THEN v_state := 'blocked'; END IF;
    END IF;
    items := items || jsonb_build_array(jsonb_build_object(
      'key', 'block:' || r.id, 'kind', 'block', 'action', 'delete_block', 'verb', 'Remove',
      'label', coalesce('A ' || replace(blk.type, '_', ' ') || ' block in ' || rec.identifier, 'A block that is gone'),
      'href', CASE WHEN rec.id IS NULL THEN NULL ELSE '/records/' || rec.id END,
      'state', v_state, 'reason', v_reason,
      'args', jsonb_build_object('id', r.id)));
  END LOOP;

  -- Older records whose fields the set edited: put back.
  FOR r IN
    SELECT n.record_id AS id, n.before FROM internal.ai_change_snapshots n
     WHERE n.set_id = s.id AND NOT (n.record_id = ANY (v_created))
  LOOP
    SELECT * INTO rec FROM api.records WHERE id = r.id;
    IF rec.id IS NULL THEN CONTINUE; END IF;
    v_before := r.before;
    v_diff := '[]'::jsonb;
    IF rec.title IS DISTINCT FROM v_before ->> 'title' THEN
      v_diff := v_diff || jsonb_build_array(jsonb_build_object('field', 'Title', 'from', v_before ->> 'title', 'to', rec.title));
    END IF;
    IF to_jsonb(rec.tags) IS DISTINCT FROM v_before -> 'tags' THEN
      v_diff := v_diff || jsonb_build_array(jsonb_build_object('field', 'Tags',
        'from', (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(v_before -> 'tags') x),
        'to', array_to_string(rec.tags, ', ')));
    END IF;
    IF rec.assignee_user_id IS DISTINCT FROM v_before ->> 'assigneeUserId' THEN
      v_diff := v_diff || jsonb_build_array(jsonb_build_object('field', 'Assigned to',
        'from', (SELECT u.name FROM internal."user" u WHERE u.id = v_before ->> 'assigneeUserId'),
        'to', (SELECT u.name FROM internal."user" u WHERE u.id = rec.assignee_user_id)));
    END IF;
    IF rec.folder_id IS DISTINCT FROM nullif(v_before ->> 'folderId', '')::uuid THEN
      v_diff := v_diff || jsonb_build_array(jsonb_build_object('field', 'Folder',
        'from', (SELECT f.name FROM api.folders f WHERE f.id = nullif(v_before ->> 'folderId', '')::uuid),
        'to', (SELECT f.name FROM api.folders f WHERE f.id = rec.folder_id)));
    END IF;
    FOR v_key IN
      SELECT k FROM (SELECT jsonb_object_keys(coalesce(v_before -> 'customFields', '{}'::jsonb)) AS k
                     UNION SELECT jsonb_object_keys(coalesce(rec.custom_fields, '{}'::jsonb))) keys
       ORDER BY k
    LOOP
      v_old := (v_before -> 'customFields') -> v_key;
      v_new := rec.custom_fields -> v_key;
      IF v_old IS DISTINCT FROM v_new THEN
        v_diff := v_diff || jsonb_build_array(jsonb_build_object('field', replace(v_key, '_', ' '),
          'from', v_old #>> '{}', 'to', v_new #>> '{}'));
      END IF;
    END LOOP;
    IF rec.properties IS DISTINCT FROM v_before -> 'properties' THEN
      v_diff := v_diff || jsonb_build_array(jsonb_build_object('field', 'Properties', 'from', NULL, 'to', NULL));
    END IF;
    v_reason := NULL;
    v_state := 'ok';
    IF jsonb_array_length(v_diff) = 0
       AND rec.status IS NOT DISTINCT FROM v_before ->> 'status'
       AND rec.project_id IS NOT DISTINCT FROM nullif(v_before ->> 'projectId', '')::uuid THEN
      CONTINUE;
    END IF;
    IF rec.status IS DISTINCT FROM v_before ->> 'status' THEN
      v_state := 'blocked';
      v_reason := 'Its status was changed, and a status cannot be put back here.';
    ELSIF rec.project_id IS DISTINCT FROM nullif(v_before ->> 'projectId', '')::uuid THEN
      v_state := 'blocked';
      v_reason := 'It was moved to another project.';
    ELSE
      v_reason := coalesce(internal.ai_record_blocker(rec), internal.ai_later_change(s.id, rec.id));
      IF v_reason IS NOT NULL THEN v_state := 'blocked'; END IF;
    END IF;
    items := items || jsonb_build_array(jsonb_build_object(
      'key', 'fields:' || r.id, 'kind', 'fields', 'action', 'restore_fields', 'verb', 'Put back',
      'label', rec.identifier || ' ' || rec.title,
      'href', '/records/' || rec.id,
      'changes', v_diff,
      'state', v_state, 'reason', v_reason,
      'args', jsonb_build_object('id', r.id, 'version', rec.metadata_version, 'before', v_before)));
  END LOOP;

  -- Everything else the set wrote that is not part of the above: it cannot be
  -- taken back, so it stops the undo. Events inside what the set made, and the
  -- bookkeeping that comes with them, are not listed.
  FOR r IN
    SELECT e.entity_type, e.operation, count(*)::int AS n
      FROM internal.ai_set_events(s.id) e
     WHERE NOT (
           e.entity_uuid = ANY (v_created) OR e.record_id = ANY (v_created)
        OR e.entity_uuid = ANY (v_projects) OR e.project_id = ANY (v_projects)
        OR e.entity_uuid = ANY (v_bookings) OR e.payload ->> 'booking_id' = ANY (SELECT x::text FROM unnest(v_bookings) x)
        OR e.entity_uuid = ANY (v_blocks)
        -- The record's own audit line for a structure change that a block
        -- insert made, or an update that changed nothing.
        OR (e.entity_type = 'record' AND e.operation IN ('update', 'move')
            AND (e.entity_uuid = ANY (v_edited)
                 OR e.entity_uuid IN (SELECT blk2.record_id FROM api.blocks blk2 WHERE blk2.id = ANY (v_blocks))
                 OR (e.payload ->> 'changedMetadata' = 'false' AND coalesce(e.payload -> 'changes', '{}'::jsonb) = '{}'::jsonb)))
        OR (e.entity_type = 'record_assignment' AND e.record_id = ANY (v_edited))
     )
     GROUP BY e.entity_type, e.operation
     ORDER BY e.entity_type, e.operation
  LOOP
    items := items || jsonb_build_array(jsonb_build_object(
      'key', 'other:' || r.entity_type || ':' || r.operation, 'kind', 'other', 'action', 'none', 'verb', '',
      'label', internal.ai_change_words(r.entity_type, r.operation) || CASE WHEN r.n > 1 THEN ' (' || r.n || ' times)' ELSE '' END,
      'href', NULL, 'state', 'blocked',
      'reason', 'This kind of change cannot be taken back.',
      'args', '{}'::jsonb));
  END LOOP;

  -- Steps the audit trail does not carry.
  FOR v_untracked IN SELECT value FROM jsonb_array_elements(s.untracked) LOOP
    items := items || jsonb_build_array(jsonb_build_object(
      'key', 'step:' || (v_untracked ->> 'title'), 'kind', 'other', 'action', 'none', 'verb', '',
      'label', left(coalesce(v_untracked ->> 'title', 'A step'), 200), 'href', NULL, 'state', 'blocked',
      'reason', 'This kind of change cannot be taken back.', 'args', '{}'::jsonb));
  END LOOP;

  SELECT count(*) FILTER (WHERE x ->> 'state' = 'blocked'), count(*) FILTER (WHERE x ->> 'state' = 'ok')
    INTO v_blocked, v_ok FROM jsonb_array_elements(items) x;

  RETURN jsonb_build_object('setId', s.id, 'title', s.title, 'kind', s.kind, 'status', s.status,
    'canUndo', v_blocked = 0 AND v_ok > 0, 'items', items, 'blocked', v_blocked, 'toUndo', v_ok);
END $$;
--> statement-breakpoint

-- Undoes the set as the person, all or nothing. If anything is blocked nothing
-- is touched and the preview comes back with `done` false. Each action runs
-- through the ordinary function, so the person's own permissions apply and each
-- one writes its own audit entry.
CREATE FUNCTION api.undo_ai_change_set(p_set_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  s api.ai_change_sets;
  v_preview jsonb;
  it jsonb;
  v_before jsonb;
  v_count int := 0;
  v_rows int;
BEGIN
  IF api.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'undo_ai_change_set requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM api.ai_change_sets WHERE id = p_set_id FOR UPDATE;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'change set not found' USING ERRCODE = '42501';
  END IF;
  v_preview := api.preview_ai_undo(p_set_id);
  IF NOT (v_preview ->> 'canUndo')::boolean THEN
    RETURN jsonb_build_object('done', false, 'preview', v_preview);
  END IF;

  FOR it IN SELECT value FROM jsonb_array_elements(v_preview -> 'items') WHERE value ->> 'state' = 'ok' LOOP
    CASE it ->> 'action'
      WHEN 'archive_record' THEN
        PERFORM api.archive_record((it -> 'args' ->> 'id')::uuid, (it -> 'args' ->> 'version')::integer);
      WHEN 'archive_sample' THEN
        PERFORM api.archive_sample((it -> 'args' ->> 'id')::uuid, (it -> 'args' ->> 'version')::integer,
          'Undone: ' || s.title);
      WHEN 'archive_project' THEN
        PERFORM api.archive_project((it -> 'args' ->> 'id')::uuid);
      WHEN 'cancel_booking' THEN
        PERFORM api.cancel_booking((it -> 'args' ->> 'id')::uuid, (it -> 'args' ->> 'version')::integer);
      WHEN 'delete_block' THEN
        PERFORM api.delete_block((it -> 'args' ->> 'id')::uuid, NULL);
      WHEN 'restore_fields' THEN
        v_before := it -> 'args' -> 'before';
        UPDATE api.records r
           SET title = v_before ->> 'title',
               tags = coalesce(ARRAY(SELECT jsonb_array_elements_text(v_before -> 'tags')), '{}'::text[]),
               custom_fields = coalesce(v_before -> 'customFields', '{}'::jsonb),
               properties = coalesce(v_before -> 'properties', '{}'::jsonb),
               assignee_user_id = v_before ->> 'assigneeUserId',
               folder_id = nullif(v_before ->> 'folderId', '')::uuid,
               metadata_version = r.metadata_version + 1,
               updated_at = now(),
               updated_by_user_id = api.current_user_id()
         WHERE r.id = (it -> 'args' ->> 'id')::uuid
           AND r.metadata_version = (it -> 'args' ->> 'version')::integer;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows = 0 THEN
          RAISE EXCEPTION 'a record changed while undoing, so nothing was undone' USING ERRCODE = 'SB001';
        END IF;
      ELSE
        RAISE EXCEPTION 'unknown undo action %', it ->> 'action' USING ERRCODE = '22023';
    END CASE;
    v_count := v_count + 1;
  END LOOP;

  UPDATE api.ai_change_sets SET status = 'undone', undone_at = now() WHERE id = s.id;
  RETURN jsonb_build_object('done', true, 'undone', v_count, 'preview', api.preview_ai_undo(p_set_id));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.begin_ai_change_set(text, text, uuid) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.finish_ai_change_set(uuid, jsonb) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.preview_ai_undo(uuid) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.undo_ai_change_set(uuid) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION internal.ai_set_events(uuid) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION internal.ai_record_blocker(api.records) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION internal.ai_later_change(uuid, uuid) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION internal.ai_change_words(text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.begin_ai_change_set(text, text, uuid),
  api.finish_ai_change_set(uuid, jsonb),
  api.preview_ai_undo(uuid),
  api.undo_ai_change_set(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.ai_set_events(uuid),
  internal.ai_record_blocker(api.records),
  internal.ai_later_change(uuid, uuid),
  internal.ai_change_words(text, text),
  internal.ai_change_capture(),
  internal.ai_change_set_undone() FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.begin_ai_change_set(text, text, uuid),
  api.finish_ai_change_set(uuid, jsonb),
  api.preview_ai_undo(uuid),
  api.undo_ai_change_set(uuid) TO authenticated;
