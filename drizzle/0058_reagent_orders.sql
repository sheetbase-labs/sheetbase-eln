-- Reagent ordering. From a material that is running low, anyone who can work with
-- materials requests a reorder; the people who run the lab's setup (owner, admin,
-- steward) place the order with the supplier; whoever unpacks it receives it, which
-- registers the delivery as a new lot of the same material.
--
-- requested -> ordered -> received, or cancelled while it is still open. Receiving
-- goes through the same path as "register replacement lot", so the new lot inherits
-- the material's supplier, catalogue number, storage and thresholds and is linked
-- back to the lot it replaces. Each step writes a change event on the material, so
-- the record history shows who asked, ordered and received it.
--
-- Two Inbox kinds: reorder_requested (for the people who place orders) and
-- reorder_incoming (for the person who asked, once it is on order). One
-- notification event, reagent_order, covers the bell, email and the digest.

CREATE TABLE api.reagent_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    number integer NOT NULL,
    material_record_id uuid,
    project_id uuid,
    -- What the material was called when it was requested, so the order still reads
    -- correctly if the lot is archived or renamed afterwards.
    material_title text NOT NULL,
    supplier text,
    catalog_no text,
    quantity numeric(18,6) NOT NULL,
    unit text,
    status text DEFAULT 'requested' NOT NULL,
    note text,
    order_reference text,
    expected_on date,
    cancel_reason text,
    received_record_id uuid,
    received_lot text,
    requested_by text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    ordered_by text,
    ordered_at timestamp with time zone,
    received_by text,
    received_at timestamp with time zone,
    cancelled_by text,
    cancelled_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reagent_orders_pkey PRIMARY KEY (id),
    CONSTRAINT uq_reagent_orders_number UNIQUE (workspace_id, number),
    CONSTRAINT reagent_orders_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT reagent_orders_material_fk FOREIGN KEY (material_record_id) REFERENCES api.records(id) ON DELETE SET NULL,
    CONSTRAINT reagent_orders_received_fk FOREIGN KEY (received_record_id) REFERENCES api.records(id) ON DELETE SET NULL,
    CONSTRAINT chk_reagent_orders_status CHECK (status IN ('requested', 'ordered', 'received', 'cancelled')),
    CONSTRAINT chk_reagent_orders_quantity CHECK (quantity > 0)
);
--> statement-breakpoint
ALTER TABLE api.reagent_orders OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_reagent_orders_workspace_status ON api.reagent_orders (workspace_id, status, requested_at DESC);
--> statement-breakpoint
CREATE INDEX idx_reagent_orders_material ON api.reagent_orders (material_record_id) WHERE status IN ('requested', 'ordered');
--> statement-breakpoint
ALTER TABLE api.reagent_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY reagent_orders_select ON api.reagent_orders FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id)
           AND (project_id IS NULL OR internal.can_view_project(project_id)));
--> statement-breakpoint
GRANT SELECT ON TABLE api.reagent_orders TO authenticated;
--> statement-breakpoint

-- Who is told. The people who place orders are the owner, admins and stewards.
CREATE FUNCTION internal.reagent_order_buyers(p_workspace_id uuid) RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT m.user_id
    FROM api.workspace_memberships m
   WHERE m.workspace_id = p_workspace_id
     AND m.suspended_at IS NULL
     AND m.role IN ('owner', 'admin', 'steward')
$$;
--> statement-breakpoint
ALTER FUNCTION internal.reagent_order_buyers(p_workspace_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.reagent_order_buyers(p_workspace_id uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.notify_reagent_order(p_order api.reagent_orders, p_recipient text, p_title text, p_body text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_recipient IS NULL
     OR p_recipient IS NOT DISTINCT FROM api.current_user_id()
     OR NOT internal.notification_recipient_enabled(p_recipient, 'reagent_order') THEN
    RETURN;
  END IF;
  INSERT INTO internal.notifications
    (workspace_id, user_id, event_type, title, body, record_id, project_id)
  VALUES (p_order.workspace_id, p_recipient, 'reagent_order', p_title, p_body,
          p_order.material_record_id, p_order.project_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.notify_reagent_order(p_order api.reagent_orders, p_recipient text, p_title text, p_body text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.notify_reagent_order(p_order api.reagent_orders, p_recipient text, p_title text, p_body text) FROM PUBLIC;
--> statement-breakpoint

-- Request a reorder of a material.
CREATE FUNCTION api.request_reagent_order(p_material_record_id uuid, p_quantity numeric, p_unit text DEFAULT NULL, p_note text DEFAULT NULL) RETURNS api.reagent_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_source api.records;
  v_order api.reagent_orders;
  v_unit text;
  v_buyer text;
  v_body text;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_source FROM api.records
   WHERE id = p_material_record_id AND workspace_id = v_workspace_id AND deleted_at IS NULL;
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'material not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_source.kind <> 'material' THEN
    RAISE EXCEPTION 'only a material can be reordered' USING ERRCODE = '22023';
  END IF;
  PERFORM internal.assert_object_access('record', p_material_record_id, 'view');
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'a positive quantity is required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM api.reagent_orders o
              WHERE o.material_record_id = p_material_record_id
                AND o.status IN ('requested', 'ordered')) THEN
    RAISE EXCEPTION 'a reorder is already open for this material' USING ERRCODE = '23505';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('reagent_orders:' || v_workspace_id::text, 0));
  v_unit := coalesce(nullif(btrim(coalesce(p_unit, '')), ''), v_source.properties->>'unit');

  INSERT INTO api.reagent_orders
    (workspace_id, number, material_record_id, project_id, material_title, supplier, catalog_no,
     quantity, unit, note, requested_by)
  VALUES
    (v_workspace_id,
     (SELECT coalesce(max(number), 0) + 1 FROM api.reagent_orders WHERE workspace_id = v_workspace_id),
     v_source.id, v_source.project_id, v_source.title,
     nullif(btrim(coalesce(v_source.properties->>'supplier', '')), ''),
     nullif(btrim(coalesce(v_source.properties->>'catalog_no', '')), ''),
     p_quantity, v_unit, nullif(btrim(coalesce(p_note, '')), ''), api.current_user_id())
  RETURNING * INTO v_order;

  PERFORM internal.emit_change_event(v_workspace_id, 'material', v_source.id, 'update',
    v_source.id, v_source.project_id,
    jsonb_build_object('action', 'reorder-requested', 'orderId', v_order.id,
                       'quantity', p_quantity, 'unit', v_unit));

  v_body := concat_ws(' · ', v_order.material_title,
    trim(both ' ' from concat(p_quantity::text, ' ', coalesce(v_unit, ''))));
  FOR v_buyer IN SELECT * FROM internal.reagent_order_buyers(v_workspace_id) LOOP
    PERFORM internal.notify_reagent_order(v_order, v_buyer, 'Reorder requested', v_body);
  END LOOP;
  RETURN v_order;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.request_reagent_order(p_material_record_id uuid, p_quantity numeric, p_unit text, p_note text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.request_reagent_order(p_material_record_id uuid, p_quantity numeric, p_unit text, p_note text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.request_reagent_order(p_material_record_id uuid, p_quantity numeric, p_unit text, p_note text) TO authenticated;
--> statement-breakpoint

-- Record that the order has been placed with the supplier.
CREATE FUNCTION api.mark_reagent_ordered(p_order_id uuid, p_order_reference text DEFAULT NULL, p_expected_on date DEFAULT NULL, p_supplier text DEFAULT NULL) RETURNS api.reagent_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_order api.reagent_orders;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.has_capability(v_workspace_id, 'schema.edit') THEN
    RAISE EXCEPTION 'only the people who place orders can mark one as ordered' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM api.reagent_orders
   WHERE id = p_order_id AND workspace_id = v_workspace_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_order.status <> 'requested' THEN
    RAISE EXCEPTION 'only a requested order can be marked as ordered' USING ERRCODE = '22023';
  END IF;
  UPDATE api.reagent_orders
     SET status = 'ordered',
         order_reference = nullif(btrim(coalesce(p_order_reference, '')), ''),
         expected_on = p_expected_on,
         supplier = coalesce(nullif(btrim(coalesce(p_supplier, '')), ''), supplier),
         ordered_by = api.current_user_id(),
         ordered_at = now(),
         updated_at = now()
   WHERE id = p_order_id
   RETURNING * INTO v_order;

  PERFORM internal.emit_change_event(v_workspace_id, 'material', v_order.material_record_id, 'update',
    v_order.material_record_id, v_order.project_id,
    jsonb_build_object('action', 'reorder-ordered', 'orderId', v_order.id,
                       'reference', v_order.order_reference));
  PERFORM internal.notify_reagent_order(v_order, v_order.requested_by, 'Reorder placed',
    concat_ws(' · ', v_order.material_title,
      CASE WHEN v_order.expected_on IS NOT NULL
           THEN 'expected ' || to_char(v_order.expected_on, 'YYYY-MM-DD') END));
  RETURN v_order;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.mark_reagent_ordered(p_order_id uuid, p_order_reference text, p_expected_on date, p_supplier text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.mark_reagent_ordered(p_order_id uuid, p_order_reference text, p_expected_on date, p_supplier text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.mark_reagent_ordered(p_order_id uuid, p_order_reference text, p_expected_on date, p_supplier text) TO authenticated;
--> statement-breakpoint

-- Receive an order: the delivery becomes a new lot of the same material.
CREATE FUNCTION api.receive_reagent_order(p_order_id uuid, p_lot text, p_expiry date, p_quantity numeric DEFAULT NULL) RETURNS api.reagent_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_order api.reagent_orders;
  v_lot jsonb;
  v_quantity numeric;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM api.reagent_orders
   WHERE id = p_order_id AND workspace_id = v_workspace_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_order.status NOT IN ('requested', 'ordered') THEN
    RAISE EXCEPTION 'this order is already % and cannot be received', v_order.status USING ERRCODE = '22023';
  END IF;
  IF v_order.material_record_id IS NULL THEN
    RAISE EXCEPTION 'the material this order was for no longer exists' USING ERRCODE = '22023';
  END IF;
  v_quantity := coalesce(p_quantity, v_order.quantity);
  v_lot := api.register_replacement_lot(
    v_order.material_record_id, p_lot, p_expiry, v_quantity, v_order.unit,
    'Reorder RO-' || lpad(v_order.number::text, 4, '0'));

  UPDATE api.reagent_orders
     SET status = 'received',
         received_record_id = (v_lot->>'id')::uuid,
         received_lot = v_lot->>'lot',
         received_by = api.current_user_id(),
         received_at = now(),
         updated_at = now()
   WHERE id = p_order_id
   RETURNING * INTO v_order;

  PERFORM internal.emit_change_event(v_workspace_id, 'material', v_order.material_record_id, 'update',
    v_order.material_record_id, v_order.project_id,
    jsonb_build_object('action', 'reorder-received', 'orderId', v_order.id,
                       'lot', v_order.received_lot, 'newRecordId', v_order.received_record_id));
  PERFORM internal.notify_reagent_order(v_order, v_order.requested_by, 'Reorder received',
    concat_ws(' · ', v_order.material_title, 'lot ' || v_order.received_lot));
  RETURN v_order;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.receive_reagent_order(p_order_id uuid, p_lot text, p_expiry date, p_quantity numeric) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.receive_reagent_order(p_order_id uuid, p_lot text, p_expiry date, p_quantity numeric) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.receive_reagent_order(p_order_id uuid, p_lot text, p_expiry date, p_quantity numeric) TO authenticated;
--> statement-breakpoint

-- Cancel an order that is still open. The person who asked can withdraw it; so can
-- the people who place orders.
CREATE FUNCTION api.cancel_reagent_order(p_order_id uuid, p_reason text DEFAULT NULL) RETURNS api.reagent_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_order api.reagent_orders;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM api.reagent_orders
   WHERE id = p_order_id AND workspace_id = v_workspace_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_order.status NOT IN ('requested', 'ordered') THEN
    RAISE EXCEPTION 'this order is already % and cannot be cancelled', v_order.status USING ERRCODE = '22023';
  END IF;
  IF v_order.requested_by IS DISTINCT FROM api.current_user_id()
     AND NOT api.has_capability(v_workspace_id, 'schema.edit') THEN
    RAISE EXCEPTION 'only the person who asked, or someone who places orders, can cancel it' USING ERRCODE = '42501';
  END IF;
  UPDATE api.reagent_orders
     SET status = 'cancelled',
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         cancelled_by = api.current_user_id(),
         cancelled_at = now(),
         updated_at = now()
   WHERE id = p_order_id
   RETURNING * INTO v_order;

  PERFORM internal.emit_change_event(v_workspace_id, 'material', v_order.material_record_id, 'update',
    v_order.material_record_id, v_order.project_id,
    jsonb_build_object('action', 'reorder-cancelled', 'orderId', v_order.id));
  PERFORM internal.notify_reagent_order(v_order, v_order.requested_by, 'Reorder cancelled',
    concat_ws(' · ', v_order.material_title, v_order.cancel_reason));
  RETURN v_order;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.cancel_reagent_order(p_order_id uuid, p_reason text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.cancel_reagent_order(p_order_id uuid, p_reason text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.cancel_reagent_order(p_order_id uuid, p_reason text) TO authenticated;
--> statement-breakpoint

-- One notification event covers the bell, email and the digest for every step.
INSERT INTO api.notification_events (event_type, source, inbox_kinds, default_email)
VALUES ('reagent_order', 'notification', ARRAY['reorder_requested', 'reorder_incoming'], true);
--> statement-breakpoint

-- Inbox: open requests for the people who place orders, and orders on their way
-- for the person who asked. The existing work-item view keeps its definition under
-- a new name and the two new kinds are added on top of it.
ALTER VIEW internal.my_work_items_all RENAME TO my_work_items_core;
--> statement-breakpoint
CREATE VIEW internal.my_work_items_all AS
 SELECT kind, record_id, identifier, title, project_id, reason, due_at, state, created_at,
        source_type, source_id, parser_version_id, connector_id, revision_id,
        dataset_id, row_id, field_id
   FROM internal.my_work_items_core
UNION ALL
 SELECT 'reorder_requested'::text AS kind,
        o.material_record_id AS record_id,
        ('RO-' || lpad(o.number::text, 4, '0')) AS identifier,
        o.material_title AS title,
        o.project_id,
        concat_ws(' · ',
          'Requested by ' || coalesce(api.workspace_member_label(o.requested_by), 'a colleague'),
          trim(both ' ' from concat(trim_scale(o.quantity)::text, ' ', coalesce(o.unit, '')))) AS reason,
        NULL::timestamp with time zone AS due_at,
        'needs_action'::text AS state,
        o.requested_at AS created_at,
        'reagent_order'::text AS source_type,
        o.id AS source_id,
        NULL::uuid AS parser_version_id, NULL::uuid AS connector_id, NULL::uuid AS revision_id,
        NULL::uuid AS dataset_id, NULL::uuid AS row_id, NULL::uuid AS field_id
   FROM api.reagent_orders o
  WHERE o.workspace_id = api.current_workspace_id()
    AND o.status = 'requested'
    AND api.has_capability(o.workspace_id, 'schema.edit')
UNION ALL
 SELECT 'reorder_incoming'::text AS kind,
        o.material_record_id AS record_id,
        ('RO-' || lpad(o.number::text, 4, '0')) AS identifier,
        o.material_title AS title,
        o.project_id,
        CASE WHEN o.expected_on IS NOT NULL
             THEN 'On order, expected ' || to_char(o.expected_on, 'YYYY-MM-DD')
             ELSE 'On order' END AS reason,
        o.expected_on::timestamp with time zone AS due_at,
        CASE WHEN o.expected_on IS NOT NULL AND o.expected_on < current_date
             THEN 'overdue' ELSE 'following' END AS state,
        o.ordered_at AS created_at,
        'reagent_order'::text AS source_type,
        o.id AS source_id,
        NULL::uuid AS parser_version_id, NULL::uuid AS connector_id, NULL::uuid AS revision_id,
        NULL::uuid AS dataset_id, NULL::uuid AS row_id, NULL::uuid AS field_id
   FROM api.reagent_orders o
  WHERE o.workspace_id = api.current_workspace_id()
    AND o.status = 'ordered'
    AND o.requested_by = api.current_user_id();
--> statement-breakpoint
ALTER VIEW internal.my_work_items_all OWNER TO migrator;
--> statement-breakpoint
GRANT SELECT ON TABLE internal.my_work_items_all TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE internal.my_work_items_core TO authenticated;
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
            WHEN (kind = ANY (ARRAY['sample_awaiting_release'::text, 'sample_hold_exceeded'::text, 'calibration_overdue'::text, 'qualification_granted'::text])) THEN 'lab'::text
            WHEN (kind = ANY (ARRAY['access_requested'::text, 'access_decided'::text, 'invitation_accepted'::text, 'verification_requested'::text, 'verification_granted'::text, 'qualification_requested'::text])) THEN 'admin'::text
            WHEN (kind = 'agent_proposal'::text) THEN 'agents'::text
            ELSE 'following'::text
        END AS inbox_type
   FROM api.my_work_items i
  WHERE ((kind <> 'agent_proposal'::text) OR (EXISTS ( SELECT 1
           FROM api.agent_operation_proposals ap
          WHERE ((ap.id = i.source_id) AND ((ap.approver_user_id IS NULL) OR ((ap.approver_user_id)::text = (api.current_user_id())::text))))));
