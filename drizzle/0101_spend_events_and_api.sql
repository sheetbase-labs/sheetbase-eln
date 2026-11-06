-- Spend and facility use on the change feed and the external API.
--
-- Webhooks, live updates and pipeline triggers hear about a price being set or
-- removed, about an instrument's recharge rate, and about scheduled reports.
-- Event bodies are summaries: they never carry a price or a rate amount, so
-- someone who may hear that an order was priced still has to be allowed to
-- read the price. Service credentials can read the supplier list and the
-- rates; prices and scheduled reports stay with people.

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
  v_def := replace(
    v_def,
    '::text]',
    '::text, ''reagent_order_price''::text, ''instrument_rate''::text, ''scheduled_report''::text]'
  );
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('order.priced'), ('order.price_removed'),
  ('instrument.rate_set'), ('instrument.rate_removed'),
  ('report.schedule.created'), ('report.schedule.updated'), ('report.schedule.deleted');
--> statement-breakpoint

CREATE FUNCTION internal.trg_change_event_reagent_order_price() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_order_id uuid := COALESCE(NEW.order_id, OLD.order_id);
  v_project uuid;
BEGIN
  SELECT project_id INTO v_project FROM api.reagent_orders WHERE id = v_order_id;
  PERFORM internal.emit_change_event(
    COALESCE(NEW.workspace_id, OLD.workspace_id),
    'reagent_order_price',
    v_order_id,
    CASE TG_OP WHEN 'DELETE' THEN 'delete' ELSE 'update' END,
    NULL,
    v_project,
    jsonb_build_object('orderId', v_order_id, 'currency', COALESCE(NEW.currency, OLD.currency))
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_reagent_order_price() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_reagent_order_prices AFTER INSERT OR UPDATE OR DELETE ON api.reagent_order_prices
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_reagent_order_price();
--> statement-breakpoint

CREATE FUNCTION internal.trg_change_event_instrument_rate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_instrument_id uuid := COALESCE(NEW.instrument_id, OLD.instrument_id);
BEGIN
  PERFORM internal.emit_change_event(
    COALESCE(NEW.workspace_id, OLD.workspace_id),
    'instrument_rate',
    v_instrument_id,
    CASE TG_OP WHEN 'DELETE' THEN 'delete' ELSE 'update' END,
    NULL,
    NULL,
    jsonb_build_object('instrumentId', v_instrument_id, 'currency', COALESCE(NEW.currency, OLD.currency))
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_instrument_rate() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_instrument_rates AFTER INSERT OR UPDATE OR DELETE ON api.instrument_rates
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument_rate();
--> statement-breakpoint

-- A schedule's own bookkeeping (next run, last result) changes on every send;
-- only changes to what the person set up are announced.
CREATE FUNCTION internal.trg_change_event_scheduled_report() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW.name, NEW.kind, NEW.project_id, NEW.period, NEW.open_hours, NEW.frequency,
       NEW.weekday, NEW.month_day, NEW.send_hour, NEW.time_zone, NEW.recipient_user_ids, NEW.active
     ) IS NOT DISTINCT FROM (
       OLD.name, OLD.kind, OLD.project_id, OLD.period, OLD.open_hours, OLD.frequency,
       OLD.weekday, OLD.month_day, OLD.send_hour, OLD.time_zone, OLD.recipient_user_ids, OLD.active
     ) THEN
    RETURN NULL;
  END IF;
  PERFORM internal.emit_change_event(
    COALESCE(NEW.workspace_id, OLD.workspace_id),
    'scheduled_report',
    COALESCE(NEW.id, OLD.id),
    CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,
    NULL,
    COALESCE(NEW.project_id, OLD.project_id),
    jsonb_build_object(
      'name', COALESCE(NEW.name, OLD.name),
      'kind', COALESCE(NEW.kind, OLD.kind),
      'active', COALESCE(NEW.active, OLD.active)
    )
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_scheduled_report() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_scheduled_reports AFTER INSERT OR UPDATE OR DELETE ON api.scheduled_reports
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_scheduled_report();
--> statement-breakpoint

-- Service credentials read the supplier list and the rates.
CREATE POLICY supplier_models_client_select ON api.supplier_models FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.supplier_models TO api_client;
--> statement-breakpoint
CREATE POLICY instrument_rates_client_select ON api.instrument_rates FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.instrument_rates TO api_client;
--> statement-breakpoint

-- Credentials may carry the facility scopes.
ALTER TABLE internal.api_credentials
  DROP CONSTRAINT chk_api_credentials_scopes;
--> statement-breakpoint
ALTER TABLE internal.api_credentials
  ADD CONSTRAINT chk_api_credentials_scopes CHECK (
    cardinality(scopes) > 0
    AND scopes <@ ARRAY[
      'projects:read','projects:write','datasets:read','datasets:write',
      'schema:read','schema:write','schema:publish','sheets:read','sheets:write',
      'models:read','models:write','templates:read','templates:write',
      'reviews:read','reviews:write','files:read','files:write',
      'webhooks:read','webhooks:write','agent_operations:read',
      'agent_operations:write','pipelines:read','pipelines:write',
      'lab:read','lab:write','admin:read','admin:write','people:read','people:write','facility:read','facility:write'
    ]::text[]
  );
