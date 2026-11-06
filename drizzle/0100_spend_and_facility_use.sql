-- Money and facility use.
--
--   * Suppliers. Any record model can be ticked as the lab's supplier list, so a
--     supplier is an ordinary record with whatever fields the lab gives it; there
--     is no fixed supplier table. "Supplier" is offered as a ready-made model.
--     A reagent order can name the supplier record it was placed with.
--   * Prices. What an order cost, and in which currency, is kept apart from the
--     order so only the people who place orders can read it. Spend adds up from
--     those prices by project, supplier and month.
--   * Facility use. An instrument can carry a recharge rate (per hour). Booked
--     hours, utilisation and the recharge for each person and project come from
--     the bookings that already exist.
--   * Scheduled reports. A report (instrument usage, spend or project status) can
--     be emailed to chosen people on a daily, weekly or monthly rhythm. The email
--     worker builds and queues each one when it falls due.

-- ---------------------------------------------------------------------------
-- Supplier lists
-- ---------------------------------------------------------------------------

CREATE TABLE api.supplier_models (
    workspace_id uuid NOT NULL,
    model_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_models_pkey PRIMARY KEY (workspace_id, model_key),
    CONSTRAINT supplier_models_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.supplier_models OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.supplier_models ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY supplier_models_select ON api.supplier_models FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.supplier_models TO authenticated;
--> statement-breakpoint

-- Tick or untick a model as a supplier list.
CREATE FUNCTION api.set_model_supplier_list(p_model_key text, p_enabled boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  IF NOT EXISTS (SELECT 1 FROM api.record_models WHERE workspace_id = v_workspace_id AND key = p_model_key) THEN
    RAISE EXCEPTION 'model not found' USING ERRCODE = 'SB036';
  END IF;
  IF coalesce(p_enabled, false) THEN
    INSERT INTO api.supplier_models (workspace_id, model_key)
    VALUES (v_workspace_id, p_model_key)
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM api.supplier_models WHERE workspace_id = v_workspace_id AND model_key = p_model_key;
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_model_supplier_list(p_model_key text, p_enabled boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_model_supplier_list(p_model_key text, p_enabled boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_model_supplier_list(p_model_key text, p_enabled boolean) TO authenticated;
--> statement-breakpoint

-- The ready-made Supplier model, already ticked as a supplier list.
CREATE FUNCTION api.create_supplier_model(p_key text, p_name text, p_prefix text, p_description text, p_fields jsonb)
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
  INSERT INTO api.supplier_models (workspace_id, model_key) VALUES (v_workspace_id, p_key)
  ON CONFLICT DO NOTHING;
  RETURN v_model;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_supplier_model(p_key text, p_name text, p_prefix text, p_description text, p_fields jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_supplier_model(p_key text, p_name text, p_prefix text, p_description text, p_fields jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_supplier_model(p_key text, p_name text, p_prefix text, p_description text, p_fields jsonb) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Reagent orders: the supplier record and the price
-- ---------------------------------------------------------------------------

ALTER TABLE api.reagent_orders
    ADD COLUMN supplier_record_id uuid,
    ADD CONSTRAINT reagent_orders_supplier_fk FOREIGN KEY (supplier_record_id) REFERENCES api.records(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX idx_reagent_orders_supplier ON api.reagent_orders (supplier_record_id) WHERE supplier_record_id IS NOT NULL;
--> statement-breakpoint

-- What an order cost. One row per order, readable only by the people who place
-- orders (owner, admin, steward), so prices stay out of everyone else's view.
CREATE TABLE api.reagent_order_prices (
    order_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    total_price numeric(14,2) NOT NULL,
    currency text NOT NULL,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reagent_order_prices_pkey PRIMARY KEY (order_id),
    CONSTRAINT reagent_order_prices_order_fk FOREIGN KEY (order_id) REFERENCES api.reagent_orders(id) ON DELETE CASCADE,
    CONSTRAINT chk_reagent_order_prices_total CHECK (total_price >= 0),
    CONSTRAINT chk_reagent_order_prices_currency CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE api.reagent_order_prices OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_reagent_order_prices_workspace ON api.reagent_order_prices (workspace_id);
--> statement-breakpoint
ALTER TABLE api.reagent_order_prices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY reagent_order_prices_select ON api.reagent_order_prices FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.has_capability(workspace_id, 'schema.edit'));
--> statement-breakpoint
GRANT SELECT ON TABLE api.reagent_order_prices TO authenticated;
--> statement-breakpoint

-- Setting a price needs the same standing as placing the order.
CREATE FUNCTION api.set_reagent_order_price(p_order_id uuid, p_total_price numeric, p_currency text) RETURNS api.reagent_order_prices
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_order api.reagent_orders;
  v_price api.reagent_order_prices;
  v_currency text := upper(btrim(coalesce(p_currency, '')));
BEGIN
  IF v_workspace_id IS NULL OR api.has_capability(v_workspace_id, 'schema.edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'only the people who place orders can set a price' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM api.reagent_orders WHERE id = p_order_id AND workspace_id = v_workspace_id;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_total_price IS NULL THEN
    DELETE FROM api.reagent_order_prices WHERE order_id = p_order_id;
    RETURN NULL;
  END IF;
  IF p_total_price < 0 THEN
    RAISE EXCEPTION 'a price cannot be negative' USING ERRCODE = '22023';
  END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'give the currency as a three-letter code, such as GBP' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.reagent_order_prices (order_id, workspace_id, total_price, currency, updated_by)
  VALUES (p_order_id, v_workspace_id, round(p_total_price, 2), v_currency, api.current_user_id())
  ON CONFLICT (order_id) DO UPDATE
     SET total_price = EXCLUDED.total_price, currency = EXCLUDED.currency,
         updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING * INTO v_price;
  RETURN v_price;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_reagent_order_price(p_order_id uuid, p_total_price numeric, p_currency text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_reagent_order_price(p_order_id uuid, p_total_price numeric, p_currency text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_reagent_order_price(p_order_id uuid, p_total_price numeric, p_currency text) TO authenticated;
--> statement-breakpoint

-- Placing an order now also takes the supplier record and the price. The old
-- signature goes so PostgREST never sees two.
DROP FUNCTION api.mark_reagent_ordered(uuid, text, date, text);
--> statement-breakpoint
CREATE FUNCTION api.mark_reagent_ordered(
    p_order_id uuid, p_order_reference text DEFAULT NULL, p_expected_on date DEFAULT NULL,
    p_supplier text DEFAULT NULL, p_supplier_record_id uuid DEFAULT NULL,
    p_total_price numeric DEFAULT NULL, p_currency text DEFAULT NULL) RETURNS api.reagent_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_order api.reagent_orders;
  v_supplier api.records;
  v_supplier_name text := nullif(btrim(coalesce(p_supplier, '')), '');
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
  IF p_supplier_record_id IS NOT NULL THEN
    SELECT * INTO v_supplier FROM api.records
     WHERE id = p_supplier_record_id AND workspace_id = v_workspace_id AND deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM api.supplier_models s
                    WHERE s.workspace_id = v_workspace_id AND s.model_key = api.records.kind);
    IF v_supplier.id IS NULL THEN
      RAISE EXCEPTION 'that supplier is not in the supplier list' USING ERRCODE = '22023';
    END IF;
    v_supplier_name := v_supplier.title;
  END IF;
  UPDATE api.reagent_orders
     SET status = 'ordered',
         order_reference = nullif(btrim(coalesce(p_order_reference, '')), ''),
         expected_on = p_expected_on,
         supplier = coalesce(v_supplier_name, supplier),
         supplier_record_id = CASE WHEN p_supplier_record_id IS NOT NULL THEN p_supplier_record_id
                                   WHEN v_supplier_name IS NOT NULL THEN NULL
                                   ELSE supplier_record_id END,
         ordered_by = api.current_user_id(),
         ordered_at = now(),
         updated_at = now()
   WHERE id = p_order_id
   RETURNING * INTO v_order;

  IF p_total_price IS NOT NULL THEN
    PERFORM api.set_reagent_order_price(p_order_id, p_total_price, p_currency);
  END IF;

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
ALTER FUNCTION api.mark_reagent_ordered(p_order_id uuid, p_order_reference text, p_expected_on date, p_supplier text, p_supplier_record_id uuid, p_total_price numeric, p_currency text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.mark_reagent_ordered(p_order_id uuid, p_order_reference text, p_expected_on date, p_supplier text, p_supplier_record_id uuid, p_total_price numeric, p_currency text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.mark_reagent_ordered(p_order_id uuid, p_order_reference text, p_expected_on date, p_supplier text, p_supplier_record_id uuid, p_total_price numeric, p_currency text) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Instrument recharge rates
-- ---------------------------------------------------------------------------

CREATE TABLE api.instrument_rates (
    instrument_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    rate_per_hour numeric(12,2) NOT NULL,
    currency text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_user_id text,
    CONSTRAINT instrument_rates_pkey PRIMARY KEY (instrument_id),
    CONSTRAINT instrument_rates_instrument_fk FOREIGN KEY (instrument_id) REFERENCES api.instruments(id) ON DELETE CASCADE,
    CONSTRAINT chk_instrument_rates_rate CHECK (rate_per_hour >= 0),
    CONSTRAINT chk_instrument_rates_currency CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE api.instrument_rates OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.instrument_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY instrument_rates_select ON api.instrument_rates FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.instrument_rates TO authenticated;
--> statement-breakpoint

-- Set an instrument's recharge rate; an empty rate clears it.
CREATE FUNCTION api.set_instrument_rate(p_instrument_id uuid, p_rate_per_hour numeric, p_currency text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_instrument api.instruments;
  v_currency text := upper(btrim(coalesce(p_currency, '')));
BEGIN
  SELECT * INTO v_instrument FROM api.instruments
   WHERE id = p_instrument_id AND workspace_id = api.current_workspace_id();
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF api.has_capability(v_instrument.workspace_id, 'instrument.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs instrument.manage' USING ERRCODE = '42501';
  END IF;
  IF p_rate_per_hour IS NULL THEN
    DELETE FROM api.instrument_rates WHERE instrument_id = v_instrument.id;
    RETURN;
  END IF;
  IF p_rate_per_hour < 0 THEN
    RAISE EXCEPTION 'a rate cannot be negative' USING ERRCODE = '22023';
  END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'give the currency as a three-letter code, such as GBP' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.instrument_rates (instrument_id, workspace_id, rate_per_hour, currency, updated_by_user_id)
  VALUES (v_instrument.id, v_instrument.workspace_id, round(p_rate_per_hour, 2), v_currency, api.current_user_id())
  ON CONFLICT (instrument_id) DO UPDATE
     SET rate_per_hour = EXCLUDED.rate_per_hour, currency = EXCLUDED.currency,
         updated_at = now(), updated_by_user_id = EXCLUDED.updated_by_user_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_instrument_rate(p_instrument_id uuid, p_rate_per_hour numeric, p_currency text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_instrument_rate(p_instrument_id uuid, p_rate_per_hour numeric, p_currency text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_instrument_rate(p_instrument_id uuid, p_rate_per_hour numeric, p_currency text) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Report lines
--
-- These run as whoever calls them, so row-level security decides what a person
-- sees on screen; the email worker (which owns the database connection) reads
-- the whole workspace. Hours are clipped to the period asked for.
-- ---------------------------------------------------------------------------

CREATE FUNCTION api.report_usage_lines(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
RETURNS TABLE (
    booking_id uuid, instrument_id uuid, instrument_name text, instrument_display_id text,
    user_id text, project_id uuid, project_title text, title text,
    starts_at timestamp with time zone, ends_at timestamp with time zone,
    hours numeric, rate_per_hour numeric, currency text)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT b.id, i.id, i.name, i.display_id,
         b.created_by_user_id, b.project_id, p.title, b.title,
         b.starts_at, b.ends_at,
         round(extract(epoch FROM (least(b.ends_at, p_to) - greatest(b.starts_at, p_from))) / 3600.0, 2),
         r.rate_per_hour, r.currency
    FROM api.calendar_bookings b
    JOIN api.instruments i ON i.id = b.resource_id AND i.workspace_id = b.workspace_id
    LEFT JOIN api.projects p ON p.id = b.project_id
    LEFT JOIN api.instrument_rates r ON r.instrument_id = i.id
   WHERE b.workspace_id = p_workspace_id
     AND b.status <> 'cancelled'
     AND b.starts_at < p_to
     AND b.ends_at > p_from
   ORDER BY b.starts_at
$$;
--> statement-breakpoint
ALTER FUNCTION api.report_usage_lines(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.report_usage_lines(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.report_usage_lines(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.report_spend_lines(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
RETURNS TABLE (
    order_id uuid, number integer, material_title text, supplier_record_id uuid, supplier text,
    project_id uuid, project_title text, quantity numeric, unit text, status text,
    ordered_at timestamp with time zone, total_price numeric, currency text)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT o.id, o.number, o.material_title, o.supplier_record_id, o.supplier,
         o.project_id, p.title, o.quantity, o.unit, o.status,
         o.ordered_at, pr.total_price, pr.currency
    FROM api.reagent_orders o
    LEFT JOIN api.projects p ON p.id = o.project_id
    LEFT JOIN api.reagent_order_prices pr ON pr.order_id = o.id
   WHERE o.workspace_id = p_workspace_id
     AND o.status IN ('ordered', 'received')
     AND o.ordered_at >= p_from
     AND o.ordered_at < p_to
   ORDER BY o.ordered_at
$$;
--> statement-breakpoint
ALTER FUNCTION api.report_spend_lines(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.report_spend_lines(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.report_spend_lines(p_workspace_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) TO authenticated;
--> statement-breakpoint

-- Where each project stands: experiments by state, what is late, what finished
-- and what was started in the period, and orders still open.
CREATE FUNCTION api.report_project_status(p_workspace_id uuid, p_project_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
RETURNS TABLE (
    project_id uuid, project_title text, project_display_id text, project_status text,
    drafts integer, in_progress integer, on_hold integer, in_review integer, overdue integer,
    completed_in_period integer, started_in_period integer, open_orders integer)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT p.id, p.title, p.display_id, p.status,
         count(*) FILTER (WHERE r.status IN ('draft', 'planned'))::int,
         count(*) FILTER (WHERE r.status = 'in_progress')::int,
         count(*) FILTER (WHERE r.status = 'on_hold')::int,
         count(*) FILTER (WHERE r.status = 'in_review')::int,
         count(*) FILTER (WHERE r.planned_end < (p_to AT TIME ZONE 'UTC')::date
                            AND r.status IN ('draft', 'planned', 'in_progress', 'on_hold'))::int,
         count(*) FILTER (WHERE r.status = 'completed' AND r.updated_at >= p_from AND r.updated_at < p_to)::int,
         count(*) FILTER (WHERE r.created_at >= p_from AND r.created_at < p_to)::int,
         (SELECT count(*)::int FROM api.reagent_orders o
           WHERE o.project_id = p.id AND o.status IN ('requested', 'ordered'))
    FROM api.projects p
    LEFT JOIN api.records r
           ON r.project_id = p.id AND r.kind = 'experiment'
          AND r.deleted_at IS NULL AND r.archived_at IS NULL
   WHERE p.workspace_id = p_workspace_id
     AND p.archived_at IS NULL
     AND p.status <> 'archived'
     AND (p_project_id IS NULL OR p.id = p_project_id)
   GROUP BY p.id
   ORDER BY p.title
$$;
--> statement-breakpoint
ALTER FUNCTION api.report_project_status(p_workspace_id uuid, p_project_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.report_project_status(p_workspace_id uuid, p_project_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.report_project_status(p_workspace_id uuid, p_project_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Scheduled reports
-- ---------------------------------------------------------------------------

CREATE TABLE api.scheduled_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    project_id uuid,
    period text DEFAULT 'previous_week' NOT NULL,
    open_hours numeric(4,1) DEFAULT 10 NOT NULL,
    frequency text NOT NULL,
    weekday smallint DEFAULT 1 NOT NULL,
    month_day smallint DEFAULT 1 NOT NULL,
    send_hour smallint DEFAULT 8 NOT NULL,
    time_zone text DEFAULT 'UTC' NOT NULL,
    recipient_user_ids text[] NOT NULL,
    active boolean DEFAULT true NOT NULL,
    next_run_at timestamp with time zone NOT NULL,
    send_now_requested_at timestamp with time zone,
    last_run_at timestamp with time zone,
    last_result text,
    last_recipient_count integer,
    created_by_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scheduled_reports_pkey PRIMARY KEY (id),
    CONSTRAINT scheduled_reports_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT scheduled_reports_project_fk FOREIGN KEY (project_id) REFERENCES api.projects(id) ON DELETE CASCADE,
    CONSTRAINT chk_scheduled_reports_name CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    CONSTRAINT chk_scheduled_reports_kind CHECK (kind IN ('instrument_usage', 'spend', 'project_status')),
    CONSTRAINT chk_scheduled_reports_period CHECK (period IN ('last_7_days', 'last_30_days', 'previous_week', 'previous_month')),
    CONSTRAINT chk_scheduled_reports_frequency CHECK (frequency IN ('daily', 'weekly', 'monthly')),
    CONSTRAINT chk_scheduled_reports_weekday CHECK (weekday BETWEEN 0 AND 6),
    CONSTRAINT chk_scheduled_reports_month_day CHECK (month_day BETWEEN 1 AND 28),
    CONSTRAINT chk_scheduled_reports_hour CHECK (send_hour BETWEEN 0 AND 23),
    CONSTRAINT chk_scheduled_reports_open_hours CHECK (open_hours > 0 AND open_hours <= 24),
    CONSTRAINT chk_scheduled_reports_recipients CHECK (cardinality(recipient_user_ids) BETWEEN 1 AND 50)
);
--> statement-breakpoint
ALTER TABLE api.scheduled_reports OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_scheduled_reports_due ON api.scheduled_reports (next_run_at) WHERE active;
--> statement-breakpoint
CREATE INDEX idx_scheduled_reports_workspace ON api.scheduled_reports (workspace_id);
--> statement-breakpoint
ALTER TABLE api.scheduled_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scheduled_reports_select ON api.scheduled_reports FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id()
           AND (created_by_user_id = api.current_user_id()
                OR api.has_capability(workspace_id, 'schema.edit')));
--> statement-breakpoint
GRANT SELECT ON TABLE api.scheduled_reports TO authenticated;
--> statement-breakpoint

-- The next time a schedule falls due after a given moment, in its own time zone.
CREATE FUNCTION internal.scheduled_report_next_run(
    p_frequency text, p_weekday integer, p_month_day integer, p_send_hour integer,
    p_time_zone text, p_after timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_day date := (p_after AT TIME ZONE p_time_zone)::date;
  v_candidate timestamp with time zone;
  v_match boolean;
  i integer;
BEGIN
  FOR i IN 0..62 LOOP
    v_match := CASE p_frequency
                 WHEN 'daily' THEN true
                 WHEN 'weekly' THEN extract(dow FROM v_day)::int = p_weekday
                 ELSE extract(day FROM v_day)::int = p_month_day
               END;
    IF v_match THEN
      v_candidate := (v_day + make_interval(hours => p_send_hour)) AT TIME ZONE p_time_zone;
      IF v_candidate > p_after THEN
        RETURN v_candidate;
      END IF;
    END IF;
    v_day := v_day + 1;
  END LOOP;
  RETURN p_after + interval '1 day';
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.scheduled_report_next_run(p_frequency text, p_weekday integer, p_month_day integer, p_send_hour integer, p_time_zone text, p_after timestamp with time zone) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.scheduled_report_next_run(p_frequency text, p_weekday integer, p_month_day integer, p_send_hour integer, p_time_zone text, p_after timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint

-- Who may set up a report: the people who run the lab's set-up for any report,
-- and the people who manage instruments for the instrument usage report.
CREATE FUNCTION internal.can_manage_scheduled_report(p_workspace_id uuid, p_kind text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT api.has_capability(p_workspace_id, 'schema.edit') IS TRUE
      OR (p_kind = 'instrument_usage' AND api.has_capability(p_workspace_id, 'instrument.manage') IS TRUE)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.can_manage_scheduled_report(p_workspace_id uuid, p_kind text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.can_manage_scheduled_report(p_workspace_id uuid, p_kind text) FROM PUBLIC;
--> statement-breakpoint

-- Create a schedule (p_id null) or change one.
CREATE FUNCTION api.save_scheduled_report(
    p_id uuid, p_name text, p_kind text, p_project_id uuid, p_period text, p_open_hours numeric,
    p_frequency text, p_weekday integer, p_month_day integer, p_send_hour integer,
    p_time_zone text, p_recipient_user_ids text[], p_active boolean DEFAULT true) RETURNS api.scheduled_reports
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_existing api.scheduled_reports;
  v_row api.scheduled_reports;
  v_recipients text[];
  v_zone text := coalesce(nullif(btrim(coalesce(p_time_zone, '')), ''), 'UTC');
BEGIN
  IF v_workspace_id IS NULL OR NOT internal.can_manage_scheduled_report(v_workspace_id, p_kind) THEN
    RAISE EXCEPTION 'you cannot schedule this report' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM api.scheduled_reports WHERE id = p_id AND workspace_id = v_workspace_id;
    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION 'scheduled report not found' USING ERRCODE = 'SB036';
    END IF;
    IF NOT internal.can_manage_scheduled_report(v_workspace_id, v_existing.kind) THEN
      RAISE EXCEPTION 'you cannot change this scheduled report' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_zone) THEN
    RAISE EXCEPTION 'unknown time zone' USING ERRCODE = '22023';
  END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = v_workspace_id) THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  -- Only current members can be sent a report.
  SELECT coalesce(array_agg(DISTINCT m.user_id), '{}') INTO v_recipients
    FROM api.workspace_memberships m
   WHERE m.workspace_id = v_workspace_id AND m.suspended_at IS NULL
     AND m.user_id = ANY (coalesce(p_recipient_user_ids, '{}'));
  IF cardinality(v_recipients) = 0 THEN
    RAISE EXCEPTION 'choose at least one person to send the report to' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO api.scheduled_reports
      (workspace_id, name, kind, project_id, period, open_hours, frequency, weekday, month_day,
       send_hour, time_zone, recipient_user_ids, active, next_run_at, created_by_user_id)
    VALUES
      (v_workspace_id, btrim(p_name), p_kind, p_project_id, p_period, coalesce(p_open_hours, 10), p_frequency,
       coalesce(p_weekday, 1), coalesce(p_month_day, 1), coalesce(p_send_hour, 8), v_zone, v_recipients,
       coalesce(p_active, true),
       internal.scheduled_report_next_run(p_frequency, coalesce(p_weekday, 1), coalesce(p_month_day, 1),
                                          coalesce(p_send_hour, 8), v_zone, now()),
       api.current_user_id())
    RETURNING * INTO v_row;
  ELSE
    UPDATE api.scheduled_reports
       SET name = btrim(p_name), kind = p_kind, project_id = p_project_id, period = p_period,
           open_hours = coalesce(p_open_hours, 10), frequency = p_frequency,
           weekday = coalesce(p_weekday, 1), month_day = coalesce(p_month_day, 1),
           send_hour = coalesce(p_send_hour, 8), time_zone = v_zone,
           recipient_user_ids = v_recipients, active = coalesce(p_active, true),
           next_run_at = internal.scheduled_report_next_run(p_frequency, coalesce(p_weekday, 1),
                           coalesce(p_month_day, 1), coalesce(p_send_hour, 8), v_zone, now()),
           updated_at = now()
     WHERE id = p_id
     RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_scheduled_report(p_id uuid, p_name text, p_kind text, p_project_id uuid, p_period text, p_open_hours numeric, p_frequency text, p_weekday integer, p_month_day integer, p_send_hour integer, p_time_zone text, p_recipient_user_ids text[], p_active boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_scheduled_report(p_id uuid, p_name text, p_kind text, p_project_id uuid, p_period text, p_open_hours numeric, p_frequency text, p_weekday integer, p_month_day integer, p_send_hour integer, p_time_zone text, p_recipient_user_ids text[], p_active boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_scheduled_report(p_id uuid, p_name text, p_kind text, p_project_id uuid, p_period text, p_open_hours numeric, p_frequency text, p_weekday integer, p_month_day integer, p_send_hour integer, p_time_zone text, p_recipient_user_ids text[], p_active boolean) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.set_scheduled_report_active(p_id uuid, p_active boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.scheduled_reports;
BEGIN
  SELECT * INTO v_row FROM api.scheduled_reports WHERE id = p_id AND workspace_id = api.current_workspace_id();
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'scheduled report not found' USING ERRCODE = 'SB036';
  END IF;
  IF NOT internal.can_manage_scheduled_report(v_row.workspace_id, v_row.kind) THEN
    RAISE EXCEPTION 'you cannot change this scheduled report' USING ERRCODE = '42501';
  END IF;
  UPDATE api.scheduled_reports
     SET active = coalesce(p_active, true),
         next_run_at = internal.scheduled_report_next_run(frequency, weekday, month_day, send_hour, time_zone, now()),
         updated_at = now()
   WHERE id = p_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_scheduled_report_active(p_id uuid, p_active boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_scheduled_report_active(p_id uuid, p_active boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_scheduled_report_active(p_id uuid, p_active boolean) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.delete_scheduled_report(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.scheduled_reports;
BEGIN
  SELECT * INTO v_row FROM api.scheduled_reports WHERE id = p_id AND workspace_id = api.current_workspace_id();
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'scheduled report not found' USING ERRCODE = 'SB036';
  END IF;
  IF NOT internal.can_manage_scheduled_report(v_row.workspace_id, v_row.kind) THEN
    RAISE EXCEPTION 'you cannot change this scheduled report' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api.scheduled_reports WHERE id = p_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.delete_scheduled_report(p_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_scheduled_report(p_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.delete_scheduled_report(p_id uuid) TO authenticated;
--> statement-breakpoint

-- Send a report now, besides its usual rhythm. The email worker picks it up on
-- its next pass (within a minute).
CREATE FUNCTION api.send_scheduled_report_now(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.scheduled_reports;
BEGIN
  SELECT * INTO v_row FROM api.scheduled_reports WHERE id = p_id AND workspace_id = api.current_workspace_id();
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'scheduled report not found' USING ERRCODE = 'SB036';
  END IF;
  IF NOT internal.can_manage_scheduled_report(v_row.workspace_id, v_row.kind) THEN
    RAISE EXCEPTION 'you cannot change this scheduled report' USING ERRCODE = '42501';
  END IF;
  UPDATE api.scheduled_reports SET send_now_requested_at = now(), updated_at = now() WHERE id = p_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.send_scheduled_report_now(p_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.send_scheduled_report_now(p_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.send_scheduled_report_now(p_id uuid) TO authenticated;
--> statement-breakpoint

-- Email can carry files, such as the CSV of a report.
ALTER TABLE internal.email_deliveries ADD COLUMN attachments jsonb;
--> statement-breakpoint

-- The email worker: claim every report that is due (or was asked for), moving
-- each to its next slot in the same step so two passes never send one twice.
CREATE FUNCTION internal.claim_due_scheduled_reports(p_limit integer DEFAULT 20) RETURNS SETOF api.scheduled_reports
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  RETURN QUERY
  UPDATE api.scheduled_reports s
     SET last_run_at = now(),
         send_now_requested_at = NULL,
         next_run_at = internal.scheduled_report_next_run(s.frequency, s.weekday, s.month_day, s.send_hour, s.time_zone, now())
   WHERE s.id IN (
     SELECT s2.id FROM api.scheduled_reports s2
      WHERE (s2.active AND s2.next_run_at <= now()) OR s2.send_now_requested_at IS NOT NULL
      ORDER BY s2.next_run_at
      LIMIT greatest(1, least(p_limit, 100))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING s.*;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.claim_due_scheduled_reports(p_limit integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.claim_due_scheduled_reports(p_limit integer) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.finish_scheduled_report(p_id uuid, p_result text, p_recipients integer) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  UPDATE api.scheduled_reports
     SET last_result = left(p_result, 500), last_recipient_count = p_recipients
   WHERE id = p_id
$$;
--> statement-breakpoint
ALTER FUNCTION internal.finish_scheduled_report(p_id uuid, p_result text, p_recipients integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.finish_scheduled_report(p_id uuid, p_result text, p_recipients integer) FROM PUBLIC;
--> statement-breakpoint

-- Queue a report email for one person, with its files.
CREATE FUNCTION internal.enqueue_report_email(p_workspace_id uuid, p_user_id text, p_subject text, p_body text, p_attachments jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_email text;
  v_id uuid;
BEGIN
  SELECT email INTO v_email FROM internal."user" WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO internal.email_deliveries
    (workspace_id, user_id, to_email, event_type, subject, body, attachments)
  VALUES (p_workspace_id, p_user_id, v_email, 'scheduled_report', p_subject, p_body, p_attachments)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.enqueue_report_email(p_workspace_id uuid, p_user_id text, p_subject text, p_body text, p_attachments jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.enqueue_report_email(p_workspace_id uuid, p_user_id text, p_subject text, p_body text, p_attachments jsonb) FROM PUBLIC;
