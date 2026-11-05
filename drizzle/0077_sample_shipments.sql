-- Shipments. A shipment is a box leaving the lab or arriving at it, with a
-- manifest of what is in it. Manifest lines name records of any kind (samples,
-- materials, registry entries, whatever the lab models) or free text, so
-- nothing about a shipment is tied to one kind of thing.
--
-- draft -> in_transit -> received, or cancelled before it is received. An
-- outbound shipment is "received" when the other end has confirmed it; an
-- inbound one when it is unpacked here. Receiving ticks the manifest line by
-- line, so a missing or damaged item is written down at the time.
--
-- Each step writes a change event on every record in the manifest, so a
-- record's history shows where it went and when it arrived. One Inbox kind,
-- shipment_incoming, follows an inbound shipment for the person who set it up
-- and flags it as overdue when it is later than expected.

CREATE TABLE api.shipments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    number integer NOT NULL,
    direction text NOT NULL,
    status text DEFAULT 'draft' NOT NULL,
    project_id uuid,
    -- Who it goes to, or who it comes from: a lab, a site, a collaborator.
    counterparty text NOT NULL,
    carrier text,
    tracking_reference text,
    shipped_on date,
    expected_on date,
    received_at timestamp with time zone,
    received_by text,
    -- How it arrived, written when it is received.
    condition_note text,
    notes text,
    cancel_reason text,
    cancelled_at timestamp with time zone,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shipments_pkey PRIMARY KEY (id),
    CONSTRAINT uq_shipments_number UNIQUE (workspace_id, number),
    CONSTRAINT shipments_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_shipments_direction CHECK (direction IN ('outbound', 'inbound')),
    CONSTRAINT chk_shipments_status CHECK (status IN ('draft', 'in_transit', 'received', 'cancelled')),
    CONSTRAINT chk_shipments_counterparty CHECK (length(btrim(counterparty)) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE api.shipments OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_shipments_workspace_status ON api.shipments (workspace_id, status, created_at DESC);
--> statement-breakpoint
CREATE TABLE api.shipment_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    shipment_id uuid NOT NULL,
    position integer NOT NULL,
    record_id uuid,
    -- What the line was called when it was packed, so it still reads correctly if
    -- the record is renamed or archived afterwards.
    identifier text,
    title text NOT NULL,
    kind text,
    quantity numeric(18,6),
    unit text,
    note text,
    -- Filled in on receipt: null until then, then true (arrived) or false (not).
    received boolean,
    received_note text,
    CONSTRAINT shipment_items_pkey PRIMARY KEY (id),
    CONSTRAINT shipment_items_shipment_fk FOREIGN KEY (shipment_id) REFERENCES api.shipments(id) ON DELETE CASCADE,
    CONSTRAINT shipment_items_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE SET NULL,
    CONSTRAINT chk_shipment_items_title CHECK (length(btrim(title)) BETWEEN 1 AND 300),
    CONSTRAINT chk_shipment_items_quantity CHECK (quantity IS NULL OR quantity > 0)
);
--> statement-breakpoint
ALTER TABLE api.shipment_items OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_shipment_items_shipment ON api.shipment_items (shipment_id, position);
--> statement-breakpoint
CREATE INDEX idx_shipment_items_record ON api.shipment_items (record_id) WHERE record_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE api.shipments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shipments_select ON api.shipments FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id)
           AND (project_id IS NULL OR internal.can_view_project(project_id)));
--> statement-breakpoint
ALTER TABLE api.shipment_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shipment_items_select ON api.shipment_items FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM api.shipments s WHERE s.id = shipment_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.shipments TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.shipment_items TO authenticated;
--> statement-breakpoint

-- Lay a manifest down. p_items is a list of
-- {record_id?, title?, quantity?, unit?, note?}. A line that names a record takes
-- its number, name and kind from it.
CREATE FUNCTION internal.write_shipment_items(p_shipment api.shipments, p_items jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_item jsonb;
  v_record api.records;
  v_record_id uuid;
  v_position integer := 0;
  v_title text;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'the manifest must be a list' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'a manifest holds at most 500 lines' USING ERRCODE = '22023';
  END IF;
  DELETE FROM api.shipment_items WHERE shipment_id = p_shipment.id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_record := NULL;
    v_record_id := nullif(v_item ->> 'record_id', '')::uuid;
    IF v_record_id IS NOT NULL THEN
      SELECT * INTO v_record FROM api.records
       WHERE id = v_record_id AND workspace_id = p_shipment.workspace_id AND deleted_at IS NULL;
      IF v_record.id IS NULL THEN
        RAISE EXCEPTION 'a record on the manifest was not found' USING ERRCODE = 'SB036';
      END IF;
      PERFORM internal.assert_object_access('record', v_record_id, 'view');
    END IF;
    v_title := coalesce(nullif(btrim(v_item ->> 'title'), ''), v_record.title);
    IF v_title IS NULL THEN
      RAISE EXCEPTION 'every manifest line needs a name or a record' USING ERRCODE = '22023';
    END IF;
    v_position := v_position + 1;
    INSERT INTO api.shipment_items
      (workspace_id, shipment_id, position, record_id, identifier, title, kind, quantity, unit, note)
    VALUES
      (p_shipment.workspace_id, p_shipment.id, v_position, v_record.id, v_record.identifier, v_title,
       v_record.kind, nullif(v_item ->> 'quantity', '')::numeric,
       nullif(btrim(coalesce(v_item ->> 'unit', '')), ''), nullif(btrim(coalesce(v_item ->> 'note', '')), ''));
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.write_shipment_items(p_shipment api.shipments, p_items jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.write_shipment_items(p_shipment api.shipments, p_items jsonb) FROM PUBLIC;
--> statement-breakpoint

-- Tell each record on the manifest what happened to it.
CREATE FUNCTION internal.shipment_record_events(p_shipment api.shipments, p_action text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT i.record_id, rec.project_id
             FROM api.shipment_items i JOIN api.records rec ON rec.id = i.record_id
            WHERE i.shipment_id = p_shipment.id LOOP
    PERFORM internal.emit_change_event(p_shipment.workspace_id, 'record', r.record_id, 'update',
      r.record_id, r.project_id,
      jsonb_build_object('action', p_action, 'shipmentId', p_shipment.id,
                         'reference', 'SHP-' || lpad(p_shipment.number::text, 4, '0'),
                         'direction', p_shipment.direction, 'counterparty', p_shipment.counterparty));
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.shipment_record_events(p_shipment api.shipments, p_action text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.shipment_record_events(p_shipment api.shipments, p_action text) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION api.create_shipment(
    p_direction text, p_counterparty text, p_items jsonb DEFAULT '[]'::jsonb,
    p_carrier text DEFAULT NULL, p_tracking_reference text DEFAULT NULL,
    p_expected_on date DEFAULT NULL, p_notes text DEFAULT NULL, p_project_id uuid DEFAULT NULL)
RETURNS api.shipments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_shipment api.shipments;
BEGIN
  IF v_workspace_id IS NULL OR api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501';
  END IF;
  IF p_direction NOT IN ('outbound', 'inbound') THEN
    RAISE EXCEPTION 'a shipment is outbound or inbound' USING ERRCODE = '22023';
  END IF;
  IF p_project_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = v_workspace_id) THEN
      RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
    END IF;
    PERFORM internal.assert_object_access('project', p_project_id, 'view');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('shipments:' || v_workspace_id::text, 0));
  INSERT INTO api.shipments
    (workspace_id, number, direction, project_id, counterparty, carrier, tracking_reference,
     expected_on, notes, created_by)
  VALUES
    (v_workspace_id, (SELECT coalesce(max(number), 0) + 1 FROM api.shipments WHERE workspace_id = v_workspace_id),
     p_direction, p_project_id, btrim(coalesce(p_counterparty, '')),
     nullif(btrim(coalesce(p_carrier, '')), ''), nullif(btrim(coalesce(p_tracking_reference, '')), ''),
     p_expected_on, nullif(btrim(coalesce(p_notes, '')), ''), api.current_user_id())
  RETURNING * INTO v_shipment;
  PERFORM internal.write_shipment_items(v_shipment, p_items);
  RETURN v_shipment;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_shipment(p_direction text, p_counterparty text, p_items jsonb, p_carrier text, p_tracking_reference text, p_expected_on date, p_notes text, p_project_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_shipment(p_direction text, p_counterparty text, p_items jsonb, p_carrier text, p_tracking_reference text, p_expected_on date, p_notes text, p_project_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_shipment(p_direction text, p_counterparty text, p_items jsonb, p_carrier text, p_tracking_reference text, p_expected_on date, p_notes text, p_project_id uuid) TO authenticated;
--> statement-breakpoint

-- Change a shipment's details, and its manifest while it is still a draft.
CREATE FUNCTION api.update_shipment(
    p_shipment_id uuid, p_counterparty text DEFAULT NULL, p_carrier text DEFAULT NULL,
    p_tracking_reference text DEFAULT NULL, p_expected_on date DEFAULT NULL, p_notes text DEFAULT NULL,
    p_items jsonb DEFAULT NULL)
RETURNS api.shipments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_shipment api.shipments;
BEGIN
  IF v_workspace_id IS NULL OR api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_shipment FROM api.shipments WHERE id = p_shipment_id AND workspace_id = v_workspace_id FOR UPDATE;
  IF v_shipment.id IS NULL THEN
    RAISE EXCEPTION 'shipment not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_shipment.status NOT IN ('draft', 'in_transit') THEN
    RAISE EXCEPTION 'a % shipment can no longer be changed', v_shipment.status USING ERRCODE = '22023';
  END IF;
  IF p_items IS NOT NULL AND v_shipment.status <> 'draft' THEN
    RAISE EXCEPTION 'the manifest is fixed once the shipment has left' USING ERRCODE = '22023';
  END IF;
  UPDATE api.shipments
     SET counterparty = coalesce(nullif(btrim(coalesce(p_counterparty, '')), ''), counterparty),
         carrier = coalesce(nullif(btrim(coalesce(p_carrier, '')), ''), carrier),
         tracking_reference = coalesce(nullif(btrim(coalesce(p_tracking_reference, '')), ''), tracking_reference),
         expected_on = coalesce(p_expected_on, expected_on),
         notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes),
         updated_at = now()
   WHERE id = v_shipment.id
  RETURNING * INTO v_shipment;
  IF p_items IS NOT NULL THEN
    PERFORM internal.write_shipment_items(v_shipment, p_items);
  END IF;
  RETURN v_shipment;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.update_shipment(p_shipment_id uuid, p_counterparty text, p_carrier text, p_tracking_reference text, p_expected_on date, p_notes text, p_items jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_shipment(p_shipment_id uuid, p_counterparty text, p_carrier text, p_tracking_reference text, p_expected_on date, p_notes text, p_items jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.update_shipment(p_shipment_id uuid, p_counterparty text, p_carrier text, p_tracking_reference text, p_expected_on date, p_notes text, p_items jsonb) TO authenticated;
--> statement-breakpoint

-- It has left (outbound) or is on its way (inbound).
CREATE FUNCTION api.mark_shipment_in_transit(p_shipment_id uuid, p_shipped_on date DEFAULT NULL, p_carrier text DEFAULT NULL, p_tracking_reference text DEFAULT NULL, p_expected_on date DEFAULT NULL)
RETURNS api.shipments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_shipment api.shipments;
BEGIN
  IF v_workspace_id IS NULL OR api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_shipment FROM api.shipments WHERE id = p_shipment_id AND workspace_id = v_workspace_id FOR UPDATE;
  IF v_shipment.id IS NULL THEN
    RAISE EXCEPTION 'shipment not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_shipment.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft shipment can be sent' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.shipment_items WHERE shipment_id = v_shipment.id) THEN
    RAISE EXCEPTION 'add something to the manifest first' USING ERRCODE = '22023';
  END IF;
  UPDATE api.shipments
     SET status = 'in_transit',
         shipped_on = coalesce(p_shipped_on, current_date),
         carrier = coalesce(nullif(btrim(coalesce(p_carrier, '')), ''), carrier),
         tracking_reference = coalesce(nullif(btrim(coalesce(p_tracking_reference, '')), ''), tracking_reference),
         expected_on = coalesce(p_expected_on, expected_on),
         updated_at = now()
   WHERE id = v_shipment.id
  RETURNING * INTO v_shipment;
  PERFORM internal.shipment_record_events(v_shipment,
    CASE v_shipment.direction WHEN 'outbound' THEN 'shipment-sent' ELSE 'shipment-on-its-way' END);
  RETURN v_shipment;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.mark_shipment_in_transit(p_shipment_id uuid, p_shipped_on date, p_carrier text, p_tracking_reference text, p_expected_on date) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.mark_shipment_in_transit(p_shipment_id uuid, p_shipped_on date, p_carrier text, p_tracking_reference text, p_expected_on date) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.mark_shipment_in_transit(p_shipment_id uuid, p_shipped_on date, p_carrier text, p_tracking_reference text, p_expected_on date) TO authenticated;
--> statement-breakpoint

-- It arrived. p_results is a list of {item_id, received, note}; a line left out
-- counts as received.
CREATE FUNCTION api.receive_shipment(p_shipment_id uuid, p_results jsonb DEFAULT '[]'::jsonb, p_condition_note text DEFAULT NULL)
RETURNS api.shipments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_shipment api.shipments;
  v_result jsonb;
BEGIN
  IF v_workspace_id IS NULL OR api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501';
  END IF;
  IF p_results IS NULL OR jsonb_typeof(p_results) <> 'array' THEN
    RAISE EXCEPTION 'the results must be a list' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_shipment FROM api.shipments WHERE id = p_shipment_id AND workspace_id = v_workspace_id FOR UPDATE;
  IF v_shipment.id IS NULL THEN
    RAISE EXCEPTION 'shipment not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_shipment.status <> 'in_transit' THEN
    RAISE EXCEPTION 'only a shipment in transit can be received' USING ERRCODE = '22023';
  END IF;
  UPDATE api.shipment_items SET received = true WHERE shipment_id = v_shipment.id;
  FOR v_result IN SELECT * FROM jsonb_array_elements(p_results) LOOP
    UPDATE api.shipment_items
       SET received = coalesce((v_result ->> 'received')::boolean, true),
           received_note = nullif(btrim(coalesce(v_result ->> 'note', '')), '')
     WHERE shipment_id = v_shipment.id AND id = (v_result ->> 'item_id')::uuid;
  END LOOP;
  UPDATE api.shipments
     SET status = 'received', received_at = now(), received_by = api.current_user_id(),
         condition_note = nullif(btrim(coalesce(p_condition_note, '')), ''), updated_at = now()
   WHERE id = v_shipment.id
  RETURNING * INTO v_shipment;
  PERFORM internal.shipment_record_events(v_shipment,
    CASE v_shipment.direction WHEN 'outbound' THEN 'shipment-delivered' ELSE 'shipment-received' END);
  RETURN v_shipment;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.receive_shipment(p_shipment_id uuid, p_results jsonb, p_condition_note text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.receive_shipment(p_shipment_id uuid, p_results jsonb, p_condition_note text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.receive_shipment(p_shipment_id uuid, p_results jsonb, p_condition_note text) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.cancel_shipment(p_shipment_id uuid, p_reason text DEFAULT NULL)
RETURNS api.shipments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_shipment api.shipments;
BEGIN
  IF v_workspace_id IS NULL OR api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_shipment FROM api.shipments WHERE id = p_shipment_id AND workspace_id = v_workspace_id FOR UPDATE;
  IF v_shipment.id IS NULL THEN
    RAISE EXCEPTION 'shipment not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_shipment.status NOT IN ('draft', 'in_transit') THEN
    RAISE EXCEPTION 'a % shipment cannot be cancelled', v_shipment.status USING ERRCODE = '22023';
  END IF;
  UPDATE api.shipments
     SET status = 'cancelled', cancelled_at = now(),
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   WHERE id = v_shipment.id
  RETURNING * INTO v_shipment;
  IF v_shipment.shipped_on IS NOT NULL THEN
    PERFORM internal.shipment_record_events(v_shipment, 'shipment-cancelled');
  END IF;
  RETURN v_shipment;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.cancel_shipment(p_shipment_id uuid, p_reason text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.cancel_shipment(p_shipment_id uuid, p_reason text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.cancel_shipment(p_shipment_id uuid, p_reason text) TO authenticated;
--> statement-breakpoint

-- Inbox: an inbound shipment on its way, for the person who set it up, overdue
-- when it is later than expected. The existing work-item view keeps its
-- definition under a new name and the new kind is added on top of it.
ALTER VIEW internal.my_work_items_all RENAME TO my_work_items_pre_shipments;
--> statement-breakpoint
CREATE VIEW internal.my_work_items_all AS
 SELECT kind, record_id, identifier, title, project_id, reason, due_at, state, created_at,
        source_type, source_id, parser_version_id, connector_id, revision_id,
        dataset_id, row_id, field_id
   FROM internal.my_work_items_pre_shipments
UNION ALL
 SELECT 'shipment_incoming'::text AS kind,
        NULL::uuid AS record_id,
        ('SHP-' || lpad(s.number::text, 4, '0')) AS identifier,
        s.counterparty AS title,
        s.project_id,
        CASE WHEN s.expected_on IS NOT NULL
             THEN 'In transit, expected ' || to_char(s.expected_on, 'YYYY-MM-DD')
             ELSE 'In transit' END AS reason,
        s.expected_on::timestamp with time zone AS due_at,
        CASE WHEN s.expected_on IS NOT NULL AND s.expected_on < current_date
             THEN 'overdue' ELSE 'following' END AS state,
        coalesce(s.shipped_on::timestamp with time zone, s.created_at) AS created_at,
        'shipment'::text AS source_type,
        s.id AS source_id,
        NULL::uuid AS parser_version_id, NULL::uuid AS connector_id, NULL::uuid AS revision_id,
        NULL::uuid AS dataset_id, NULL::uuid AS row_id, NULL::uuid AS field_id
   FROM api.shipments s
  WHERE s.workspace_id = api.current_workspace_id()
    AND s.direction = 'inbound'
    AND s.status = 'in_transit'
    AND s.created_by = api.current_user_id();
--> statement-breakpoint
ALTER VIEW internal.my_work_items_all OWNER TO migrator;
--> statement-breakpoint
GRANT SELECT ON TABLE internal.my_work_items_all TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE internal.my_work_items_pre_shipments TO authenticated;
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
            WHEN (kind = ANY (ARRAY['sample_awaiting_release'::text, 'sample_hold_exceeded'::text, 'calibration_overdue'::text, 'qualification_granted'::text, 'request_submitted'::text, 'request_update'::text, 'shipment_incoming'::text])) THEN 'lab'::text
            WHEN (kind = ANY (ARRAY['access_requested'::text, 'access_decided'::text, 'invitation_accepted'::text, 'verification_requested'::text, 'verification_granted'::text, 'qualification_requested'::text])) THEN 'admin'::text
            WHEN (kind = 'agent_proposal'::text) THEN 'agents'::text
            ELSE 'following'::text
        END AS inbox_type
   FROM api.my_work_items i
  WHERE ((kind <> 'agent_proposal'::text) OR (EXISTS ( SELECT 1
           FROM api.agent_operation_proposals ap
          WHERE ((ap.id = i.source_id) AND ((ap.approver_user_id IS NULL) OR ((ap.approver_user_id)::text = (api.current_user_id())::text))))));
