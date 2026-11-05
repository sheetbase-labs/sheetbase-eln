-- Requests. Any record model can take requests: tick "Take requests" on the
-- model and people in the lab can ask for that kind of work (an assay run, a
-- sample prep, an analysis) through a form generated from the model's own
-- fields. There are no fixed request types; a request is an ordinary record of
-- the model, so it is numbered, searchable, linkable and listed like any other.
--
-- A request starts as status "requested". The people who handle that model's
-- requests (named on the model, or the owner, admins and stewards when none are
-- named) see it in their Inbox and accept, decline or complete it, with a note.
-- The person who asked sees the outcome in their Inbox.
--
-- requested -> accepted -> completed, or declined while it is still open.
--
-- Two Inbox kinds: request_submitted (for the people who handle it) and
-- request_update (for the person who asked, once it is decided). One
-- notification event, request, covers the bell, email and the digest.

CREATE TABLE api.request_forms (
    workspace_id uuid NOT NULL,
    model_key text NOT NULL,
    -- A line or two shown above the form: what to put in, how long it takes.
    intro text,
    handler_user_ids text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_user_id text,
    CONSTRAINT request_forms_pkey PRIMARY KEY (workspace_id, model_key),
    CONSTRAINT request_forms_model_fk FOREIGN KEY (workspace_id, model_key)
        REFERENCES api.record_models (workspace_id, key) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_request_forms_intro CHECK (intro IS NULL OR length(intro) <= 1000)
);
--> statement-breakpoint
ALTER TABLE api.request_forms OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.request_forms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY request_forms_select ON api.request_forms FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.request_forms TO authenticated;
--> statement-breakpoint

-- The people who handle a model's requests: the ones named on the form, or the
-- owner, admins and stewards when nobody is named.
CREATE FUNCTION internal.request_handlers(p_workspace_id uuid, p_model_key text) RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT m.user_id
    FROM api.request_forms f
    JOIN api.workspace_memberships m ON m.workspace_id = f.workspace_id
   WHERE f.workspace_id = p_workspace_id AND f.model_key = p_model_key
     AND m.suspended_at IS NULL
     AND (m.user_id = ANY (f.handler_user_ids)
          OR (cardinality(f.handler_user_ids) = 0 AND m.role IN ('owner', 'admin', 'steward')))
$$;
--> statement-breakpoint
ALTER FUNCTION internal.request_handlers(p_workspace_id uuid, p_model_key text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.request_handlers(p_workspace_id uuid, p_model_key text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.request_handlers(p_workspace_id uuid, p_model_key text) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION internal.is_request_handler(p_workspace_id uuid, p_model_key text, p_user_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p_user_id IN (SELECT internal.request_handlers(p_workspace_id, p_model_key))
$$;
--> statement-breakpoint
ALTER FUNCTION internal.is_request_handler(p_workspace_id uuid, p_model_key text, p_user_id text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.is_request_handler(p_workspace_id uuid, p_model_key text, p_user_id text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.is_request_handler(p_workspace_id uuid, p_model_key text, p_user_id text) TO authenticated;
--> statement-breakpoint

-- What was said on the way in and on the way out. The request itself is the
-- record; this holds the requester's note and the handler's decision.
CREATE TABLE api.request_details (
    record_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    note text,
    decided_by text,
    decided_at timestamp with time zone,
    decision_note text,
    CONSTRAINT request_details_pkey PRIMARY KEY (record_id),
    CONSTRAINT request_details_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT chk_request_details_note CHECK (note IS NULL OR length(note) <= 4000),
    CONSTRAINT chk_request_details_decision_note CHECK (decision_note IS NULL OR length(decision_note) <= 4000)
);
--> statement-breakpoint
ALTER TABLE api.request_details OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.request_details ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY request_details_select ON api.request_details FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.request_details TO authenticated;
--> statement-breakpoint

INSERT INTO api.notification_events (event_type, source, inbox_kinds, default_email)
VALUES ('request', 'notification', ARRAY['request_submitted', 'request_update'], true);
--> statement-breakpoint

CREATE FUNCTION internal.notify_request(p_record api.records, p_recipient text, p_title text, p_body text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_recipient IS NULL
     OR p_recipient IS NOT DISTINCT FROM api.current_user_id()
     OR NOT internal.notification_recipient_enabled(p_recipient, 'request') THEN
    RETURN;
  END IF;
  INSERT INTO internal.notifications
    (workspace_id, user_id, event_type, title, body, record_id, project_id)
  VALUES (p_record.workspace_id, p_recipient, 'request', p_title, p_body, p_record.id, p_record.project_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.notify_request(p_record api.records, p_recipient text, p_title text, p_body text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.notify_request(p_record api.records, p_recipient text, p_title text, p_body text) FROM PUBLIC;
--> statement-breakpoint

-- Take requests on a model, or stop. Only people who can edit models.
CREATE FUNCTION api.set_request_form(p_model_key text, p_accepts boolean, p_intro text DEFAULT NULL, p_handler_user_ids text[] DEFAULT '{}')
RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_handlers text[] := coalesce(p_handler_user_ids, '{}');
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  IF NOT EXISTS (SELECT 1 FROM api.record_models WHERE workspace_id = v_workspace_id AND key = p_model_key) THEN
    RAISE EXCEPTION 'model not found' USING ERRCODE = 'SB036';
  END IF;
  IF NOT coalesce(p_accepts, false) THEN
    DELETE FROM api.request_forms WHERE workspace_id = v_workspace_id AND model_key = p_model_key;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_handlers) h
     WHERE NOT EXISTS (SELECT 1 FROM api.workspace_memberships m
                        WHERE m.workspace_id = v_workspace_id AND m.user_id = h AND m.suspended_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'handlers must be active members of the workspace' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.request_forms (workspace_id, model_key, intro, handler_user_ids, updated_by_user_id)
  VALUES (v_workspace_id, p_model_key, nullif(btrim(p_intro), ''), v_handlers, api.current_user_id())
  ON CONFLICT (workspace_id, model_key) DO UPDATE
     SET intro = EXCLUDED.intro, handler_user_ids = EXCLUDED.handler_user_ids,
         updated_at = now(), updated_by_user_id = EXCLUDED.updated_by_user_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_request_form(p_model_key text, p_accepts boolean, p_intro text, p_handler_user_ids text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_request_form(p_model_key text, p_accepts boolean, p_intro text, p_handler_user_ids text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_request_form(p_model_key text, p_accepts boolean, p_intro text, p_handler_user_ids text[]) TO authenticated;
--> statement-breakpoint

-- Ask for something. The request is a record of the model, filed under a project
-- when the person names one. It starts as "requested" and the handlers are told.
CREATE FUNCTION api.submit_request(
    p_model_key text, p_title text, p_custom_fields jsonb DEFAULT '{}'::jsonb,
    p_project_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS api.records
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_user text := api.current_user_id();
  v_model api.record_models;
  v_version api.record_model_versions;
  v_defaults jsonb := '{}'::jsonb;
  v_record api.records;
  v_handler text;
BEGIN
  IF v_workspace_id IS NULL OR api.has_capability(v_workspace_id, 'work.records') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs work.records' USING ERRCODE = '42501';
  END IF;
  SELECT m.* INTO v_model FROM api.record_models m
    JOIN api.request_forms f ON f.workspace_id = m.workspace_id AND f.model_key = m.key
   WHERE m.workspace_id = v_workspace_id AND m.key = p_model_key;
  IF v_model.id IS NULL THEN
    RAISE EXCEPTION 'that form is not taking requests' USING ERRCODE = '22023';
  END IF;
  IF p_project_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = v_workspace_id) THEN
      RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
    END IF;
    PERFORM internal.assert_object_access('project', p_project_id, 'view');
  END IF;
  SELECT * INTO v_version FROM api.record_model_versions
   WHERE model_id = v_model.id AND lifecycle = 'published' ORDER BY version DESC LIMIT 1;
  IF v_version.id IS NULL THEN
    RAISE EXCEPTION 'Record Model % has no published version', p_model_key USING ERRCODE = 'SB108';
  END IF;
  SELECT coalesce(jsonb_object_agg(f->>'field_name', f->'default_value'), '{}'::jsonb)
    INTO v_defaults
    FROM jsonb_array_elements(coalesce(v_version.definition->'fields', '[]'::jsonb)) f
   WHERE f ? 'default_value' AND f->'default_value' IS NOT NULL AND f->'default_value' <> 'null'::jsonb;

  INSERT INTO api.records(
    workspace_id, project_id, kind, identifier, title, status,
    custom_fields, model_version_id, created_by_user_id)
  VALUES (
    v_workspace_id, p_project_id, p_model_key, api.next_record_model_identifier(v_model.id),
    coalesce(nullif(btrim(p_title), ''), v_model.name || ' request'), 'requested',
    v_defaults || coalesce(p_custom_fields, '{}'), v_version.id, v_user)
  RETURNING * INTO v_record;
  INSERT INTO api.request_details (record_id, workspace_id, note)
  VALUES (v_record.id, v_workspace_id, nullif(btrim(p_note), ''));

  FOR v_handler IN SELECT internal.request_handlers(v_workspace_id, p_model_key) LOOP
    PERFORM internal.notify_request(v_record, v_handler,
      v_model.name || ' request ' || v_record.identifier,
      coalesce(api.workspace_member_label(v_user), 'A colleague') || ' asked: ' || v_record.title);
  END LOOP;
  RETURN v_record;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.submit_request(p_model_key text, p_title text, p_custom_fields jsonb, p_project_id uuid, p_note text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.submit_request(p_model_key text, p_title text, p_custom_fields jsonb, p_project_id uuid, p_note text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.submit_request(p_model_key text, p_title text, p_custom_fields jsonb, p_project_id uuid, p_note text) TO authenticated;
--> statement-breakpoint

-- Decide a request: accept it, decline it, or mark it completed.
CREATE FUNCTION api.decide_request(p_record_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS api.records
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_user text := api.current_user_id();
  v_record api.records;
  v_requester text;
BEGIN
  IF v_workspace_id IS NULL OR api.has_capability(v_workspace_id, 'work.records') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs work.records' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('accepted', 'declined', 'completed') THEN
    RAISE EXCEPTION 'a request is accepted, declined or completed' USING ERRCODE = '22023';
  END IF;
  SELECT r.* INTO v_record FROM api.records r
   WHERE r.id = p_record_id AND r.workspace_id = v_workspace_id AND r.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM api.request_forms f WHERE f.workspace_id = r.workspace_id AND f.model_key = r.kind)
   FOR UPDATE;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'request not found' USING ERRCODE = 'SB036';
  END IF;
  IF NOT internal.is_request_handler(v_workspace_id, v_record.kind, v_user) THEN
    RAISE EXCEPTION 'only the people who handle these requests can decide them' USING ERRCODE = '42501';
  END IF;
  IF v_record.status NOT IN ('requested', 'accepted')
     OR (v_record.status = 'accepted' AND p_decision = 'accepted') THEN
    RAISE EXCEPTION 'this request is already %', v_record.status USING ERRCODE = '22023';
  END IF;
  UPDATE api.records
     SET status = p_decision,
         metadata_version = metadata_version + 1,
         updated_at = now(), updated_by_user_id = v_user
   WHERE id = v_record.id
  RETURNING * INTO v_record;
  INSERT INTO api.request_details (record_id, workspace_id, decided_by, decided_at, decision_note)
  VALUES (v_record.id, v_workspace_id, v_user, now(), nullif(btrim(p_note), ''))
  ON CONFLICT (record_id) DO UPDATE
     SET decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at,
         decision_note = EXCLUDED.decision_note;
  v_requester := v_record.created_by_user_id;
  PERFORM internal.notify_request(v_record, v_requester,
    'Request ' || v_record.identifier || ' ' || p_decision,
    coalesce(api.workspace_member_label(v_user), 'A colleague') || ' ' || p_decision || ' your request: ' || v_record.title);
  RETURN v_record;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.decide_request(p_record_id uuid, p_decision text, p_note text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.decide_request(p_record_id uuid, p_decision text, p_note text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.decide_request(p_record_id uuid, p_decision text, p_note text) TO authenticated;
--> statement-breakpoint

-- Inbox: new requests for the people who handle them, and the outcome for the
-- person who asked. The existing work-item view keeps its definition under a new
-- name and the two new kinds are added on top of it.
ALTER VIEW internal.my_work_items_all RENAME TO my_work_items_pre_requests;
--> statement-breakpoint
CREATE VIEW internal.my_work_items_all AS
 SELECT kind, record_id, identifier, title, project_id, reason, due_at, state, created_at,
        source_type, source_id, parser_version_id, connector_id, revision_id,
        dataset_id, row_id, field_id
   FROM internal.my_work_items_pre_requests
UNION ALL
 SELECT 'request_submitted'::text AS kind,
        r.id AS record_id,
        r.identifier,
        r.title,
        r.project_id,
        concat_ws(' · ',
          m.name,
          'Asked by ' || coalesce(api.workspace_member_label(r.created_by_user_id), 'a colleague')) AS reason,
        NULL::timestamp with time zone AS due_at,
        'needs_action'::text AS state,
        r.created_at AS created_at,
        'request'::text AS source_type,
        r.id AS source_id,
        NULL::uuid AS parser_version_id, NULL::uuid AS connector_id, NULL::uuid AS revision_id,
        NULL::uuid AS dataset_id, NULL::uuid AS row_id, NULL::uuid AS field_id
   FROM api.records r
   JOIN api.record_models m ON m.workspace_id = r.workspace_id AND m.key = r.kind
  WHERE r.workspace_id = api.current_workspace_id()
    AND r.status = 'requested'
    AND r.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM api.request_forms f WHERE f.workspace_id = r.workspace_id AND f.model_key = r.kind)
    AND internal.is_request_handler(r.workspace_id, r.kind, api.current_user_id())
UNION ALL
 SELECT 'request_update'::text AS kind,
        r.id AS record_id,
        r.identifier,
        r.title,
        r.project_id,
        concat_ws(' · ',
          initcap(r.status) || ' by ' || coalesce(api.workspace_member_label(d.decided_by), 'a colleague'),
          d.decision_note) AS reason,
        NULL::timestamp with time zone AS due_at,
        CASE WHEN r.status = 'accepted' THEN 'following' ELSE 'needs_action' END AS state,
        coalesce(d.decided_at, r.updated_at) AS created_at,
        'request'::text AS source_type,
        r.id AS source_id,
        NULL::uuid AS parser_version_id, NULL::uuid AS connector_id, NULL::uuid AS revision_id,
        NULL::uuid AS dataset_id, NULL::uuid AS row_id, NULL::uuid AS field_id
   FROM api.records r
   LEFT JOIN api.request_details d ON d.record_id = r.id
  WHERE r.workspace_id = api.current_workspace_id()
    AND r.status IN ('accepted', 'declined', 'completed')
    AND r.deleted_at IS NULL
    AND r.created_by_user_id = api.current_user_id()
    AND coalesce(d.decided_at, r.updated_at) > now() - interval '30 days'
    AND EXISTS (SELECT 1 FROM api.request_forms f WHERE f.workspace_id = r.workspace_id AND f.model_key = r.kind);
--> statement-breakpoint
ALTER VIEW internal.my_work_items_all OWNER TO migrator;
--> statement-breakpoint
GRANT SELECT ON TABLE internal.my_work_items_all TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE internal.my_work_items_pre_requests TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE VIEW api.my_work_items WITH (security_invoker='true') AS
 SELECT kind, record_id, identifier, title, project_id, reason, due_at, state, created_at,
        source_type, source_id, parser_version_id, connector_id, revision_id,
        dataset_id, row_id, field_id
   FROM internal.my_work_items_all
  WHERE NOT internal.inbox_kind_muted(kind);
--> statement-breakpoint
CREATE OR REPLACE VIEW api.inbox_work_items WITH (security_invoker='true') AS
 SELECT kind,
    record_id,
    identifier,
    title,
    project_id,
    reason,
    due_at,
    state,
    created_at,
    source_type,
    source_id,
    parser_version_id,
    connector_id,
    revision_id,
    dataset_id,
    row_id,
    field_id,
    ((kind || ':'::text) || COALESCE((source_id)::text, (record_id)::text, identifier, title, 'Untitled'::text)) AS item_key,
        CASE
            WHEN ((state = 'following'::text) OR (kind = 'following'::text)) THEN 'following'::text
            WHEN ((state = 'done_today'::text) OR (EXISTS ( SELECT 1
               FROM api.work_item_views v
              WHERE ((v.item_key = ((i.kind || ':'::text) || COALESCE((i.source_id)::text, (i.record_id)::text, i.identifier, i.title, 'Untitled'::text))) AND (v.workspace_id = api.current_workspace_id()) AND (v.user_id = api.current_user_id()))))) THEN 'done-today'::text
            ELSE 'needs-action'::text
        END AS inbox_tab,
        CASE
            WHEN (kind = ANY (ARRAY['review_requested'::text, 'witness_requested'::text, 'review_returned'::text, 'approval_unsigned'::text, 'witness_signed'::text])) THEN 'reviews'::text
            WHEN (kind = ANY (ARRAY['data_issue'::text, 'cell_conflict'::text])) THEN 'data'::text
            WHEN (kind = ANY (ARRAY['run_failed'::text, 'run_waiting'::text])) THEN 'runs'::text
            WHEN (kind = ANY (ARRAY['material_expiring'::text, 'reorder_requested'::text, 'reorder_incoming'::text])) THEN 'materials'::text
            WHEN (kind = ANY (ARRAY['sample_awaiting_release'::text, 'sample_hold_exceeded'::text, 'calibration_overdue'::text, 'qualification_granted'::text, 'request_submitted'::text, 'request_update'::text])) THEN 'lab'::text
            WHEN (kind = ANY (ARRAY['access_requested'::text, 'access_decided'::text, 'invitation_accepted'::text, 'verification_requested'::text, 'verification_granted'::text, 'qualification_requested'::text])) THEN 'admin'::text
            WHEN (kind = 'agent_proposal'::text) THEN 'agents'::text
            ELSE 'following'::text
        END AS inbox_type
   FROM api.my_work_items i
  WHERE ((kind <> 'agent_proposal'::text) OR (EXISTS ( SELECT 1
           FROM api.agent_operation_proposals ap
          WHERE ((ap.id = i.source_id) AND ((ap.approver_user_id IS NULL) OR ((ap.approver_user_id)::text = (api.current_user_id())::text))))));
--> statement-breakpoint

-- A ready-made request form: a published model with its fields, already taking
-- requests. The lab can add fields to it afterwards like any other model.
-- `p_fields` is a list of {field_name, label, logical_type}.
CREATE FUNCTION api.create_request_model(
    p_key text, p_name text, p_prefix text, p_description text, p_fields jsonb,
    p_intro text DEFAULT NULL)
RETURNS api.record_models
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_model api.record_models;
  v_field jsonb;
  v_order integer := 0;
  v_fields jsonb := '[]'::jsonb;
  v_def api.record_field_definitions;
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  PERFORM api.require_capability(v_workspace_id, 'schema.publish');
  v_model := api.create_workspace_model(v_workspace_id, p_key, p_name, p_prefix, p_description);
  FOR v_field IN SELECT * FROM jsonb_array_elements(p_fields) LOOP
    v_order := v_order + 1;
    INSERT INTO api.record_field_definitions
      (workspace_id, kind, field_name, label, display_order, logical_type, nullable,
       validation, lifecycle, created_by_user_id, section, show_in_list, ask_on_create)
    VALUES (v_workspace_id, p_key, v_field ->> 'field_name', v_field ->> 'label', v_order,
            coalesce(v_field ->> 'logical_type', 'text'), true, '{}'::jsonb, 'active',
            api.current_user_id(), nullif(v_field ->> 'section', ''),
            coalesce((v_field ->> 'show_in_list')::boolean, false), true)
    RETURNING * INTO v_def;
    v_fields := v_fields || (to_jsonb(v_def) || '{"options":[]}'::jsonb);
  END LOOP;
  INSERT INTO api.record_model_versions
    (workspace_id, model_id, version, revision, lifecycle, definition, published_at,
     created_by_user_id, updated_by_user_id)
  VALUES (v_workspace_id, v_model.id, 1, 1, 'published', jsonb_build_object('fields', v_fields), now(),
          api.current_user_id(), api.current_user_id());
  UPDATE api.record_models SET lifecycle = 'published' WHERE id = v_model.id
  RETURNING * INTO v_model;
  PERFORM api.set_request_form(p_key, true, p_intro, '{}'::text[]);
  RETURN v_model;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_request_model(p_key text, p_name text, p_prefix text, p_description text, p_fields jsonb, p_intro text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_request_model(p_key text, p_name text, p_prefix text, p_description text, p_fields jsonb, p_intro text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_request_model(p_key text, p_name text, p_prefix text, p_description text, p_fields jsonb, p_intro text) TO authenticated;

--> statement-breakpoint
-- Which forms the caller handles, so the page can show them their queue.
CREATE FUNCTION api.my_request_forms() RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT f.model_key
    FROM api.request_forms f
   WHERE f.workspace_id = api.current_workspace_id()
     AND internal.is_request_handler(f.workspace_id, f.model_key, api.current_user_id())
$$;
--> statement-breakpoint
ALTER FUNCTION api.my_request_forms() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.my_request_forms() FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.my_request_forms() TO authenticated;
