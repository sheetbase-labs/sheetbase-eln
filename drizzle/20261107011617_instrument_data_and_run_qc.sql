-- Instrument data in the Allotrope Simple Model (ASM) and run quality control.
--
--   * api.instrument_run_documents: the ASM document an instrument run was
--     converted to, with the converter, its version and the image that ran it.
--     The usual dataset rows still land beside it; this is the vendor-neutral
--     copy a data team can read.
--   * api.qc_series and api.qc_points: a tracked value (a plate assay's Z'
--     or control mean, or any value sent in) across runs, with its limits and
--     the Westgard rules that judge each new point.
--   * Rule breaches raise qc.violation and qc.back_in_control, and a bell
--     notification for the series' owner.

-- Events -----------------------------------------------------------------------
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
  IF position('''instrument_run_document''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''instrument_run_document''::text]');
  END IF;
  IF position('''qc_series''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''qc_series''::text]');
  END IF;
  IF position('''qc_violation''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''qc_violation''::text]');
  END IF;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint
INSERT INTO internal.webhook_event_names (name) VALUES
  ('instrument.run.converted'), ('qc.violation'), ('qc.back_in_control')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- A notification can point at a page that is not a record.
ALTER TABLE internal.notifications ADD COLUMN IF NOT EXISTS link text;
--> statement-breakpoint
DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_viewdef('api.my_notifications'::regclass);
  IF position('link' IN v_def) = 0 THEN
    IF position('read_at' || chr(10) || '   FROM internal.notifications' IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for api.my_notifications';
    END IF;
    v_def := replace(v_def, 'read_at' || chr(10) || '   FROM internal.notifications',
                     'read_at,' || chr(10) || '    link' || chr(10) || '   FROM internal.notifications');
    EXECUTE 'CREATE OR REPLACE VIEW api.my_notifications AS ' || rtrim(v_def, ';');
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO api.notification_events (event_type, source, inbox_kinds, default_email, default_push)
VALUES ('qc_violation', 'notification', ARRAY[]::text[], true, true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ASM documents ----------------------------------------------------------------
CREATE TABLE api.instrument_run_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    run_id uuid NOT NULL,
    instrument_id uuid,
    format text DEFAULT 'asm' NOT NULL,
    technique text,
    manifest text,
    vendor text,
    converter text NOT NULL,
    converter_version text,
    image_digest text,
    measurements integer DEFAULT 0 NOT NULL,
    device jsonb DEFAULT '{}'::jsonb NOT NULL,
    document jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    CONSTRAINT instrument_run_documents_pkey PRIMARY KEY (id),
    CONSTRAINT uq_instrument_run_documents_run UNIQUE (run_id),
    CONSTRAINT instrument_run_documents_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT instrument_run_documents_run_fk FOREIGN KEY (run_id) REFERENCES api.instrument_runs(id) ON DELETE CASCADE,
    CONSTRAINT instrument_run_documents_instrument_fk FOREIGN KEY (instrument_id) REFERENCES api.instruments(id) ON DELETE SET NULL,
    CONSTRAINT chk_instrument_run_documents_format CHECK (format = 'asm'),
    CONSTRAINT chk_instrument_run_documents_document CHECK (jsonb_typeof(document) = 'object'),
    CONSTRAINT chk_instrument_run_documents_device CHECK (jsonb_typeof(device) = 'object')
);
--> statement-breakpoint
ALTER TABLE api.instrument_run_documents OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_instrument_run_documents_instrument ON api.instrument_run_documents (instrument_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_instrument_run_documents_workspace ON api.instrument_run_documents (workspace_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE api.instrument_run_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY instrument_run_documents_select ON api.instrument_run_documents FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_run_documents_client_select ON api.instrument_run_documents FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY instrument_run_documents_live_read ON api.instrument_run_documents AS RESTRICTIVE FOR SELECT TO authenticated, api_client
    USING (internal.can_access_object('run'::text, run_id, 'view'::text));
--> statement-breakpoint
GRANT SELECT ON TABLE api.instrument_run_documents TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.record_instrument_run_document(
    p_run_id uuid, p_document jsonb, p_converter text,
    p_converter_version text DEFAULT NULL, p_image_digest text DEFAULT NULL,
    p_vendor text DEFAULT NULL, p_technique text DEFAULT NULL, p_manifest text DEFAULT NULL,
    p_measurements integer DEFAULT 0, p_device jsonb DEFAULT '{}'::jsonb)
    RETURNS api.instrument_run_documents
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_run api.instrument_runs;
  r api.instrument_run_documents;
BEGIN
  SELECT * INTO v_run FROM api.instrument_runs WHERE id = p_run_id;
  IF v_run.id IS NULL OR v_run.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB039';
  END IF;
  PERFORM internal.assert_object_access('run', p_run_id, 'edit');
  IF NOT api.is_workspace_writer(v_run.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF p_document IS NULL OR jsonb_typeof(p_document) <> 'object' THEN
    RAISE EXCEPTION 'the document must be an object' USING ERRCODE = '22023';
  END IF;
  IF p_converter IS NULL OR length(btrim(p_converter)) = 0 THEN
    RAISE EXCEPTION 'name the converter' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.instrument_run_documents
    (workspace_id, run_id, instrument_id, technique, manifest, vendor, converter,
     converter_version, image_digest, measurements, device, document, created_by_user_id)
  VALUES
    (v_run.workspace_id, v_run.id, v_run.instrument_id, p_technique, p_manifest, p_vendor,
     btrim(p_converter), p_converter_version, p_image_digest, greatest(coalesce(p_measurements, 0), 0),
     coalesce(p_device, '{}'::jsonb), p_document, api.current_user_id())
  ON CONFLICT (run_id) DO UPDATE SET
     technique = EXCLUDED.technique, manifest = EXCLUDED.manifest, vendor = EXCLUDED.vendor,
     converter = EXCLUDED.converter, converter_version = EXCLUDED.converter_version,
     image_digest = EXCLUDED.image_digest, measurements = EXCLUDED.measurements,
     device = EXCLUDED.device, document = EXCLUDED.document, created_at = now(),
     created_by_user_id = EXCLUDED.created_by_user_id
  RETURNING * INTO r;
  PERFORM internal.emit_change_event(r.workspace_id, 'instrument_run_document', r.id, 'create', NULL, v_run.project_id,
    jsonb_build_object('runId', r.run_id, 'instrumentId', r.instrument_id, 'format', r.format,
                       'technique', r.technique, 'vendor', r.vendor, 'converter', r.converter,
                       'converterVersion', r.converter_version, 'measurements', r.measurements));
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.record_instrument_run_document(uuid, jsonb, text, text, text, text, text, text, integer, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_instrument_run_document(uuid, jsonb, text, text, text, text, text, text, integer, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_instrument_run_document(uuid, jsonb, text, text, text, text, text, text, integer, jsonb) TO authenticated, api_client;
--> statement-breakpoint

-- A parser that is a converter to the Allotrope Simple Model, run in the Python
-- runtime. Choosing how a workspace's files are read is part of setting up an
-- integration, so it needs the same access as one.
CREATE FUNCTION api.create_converter_parser(p_workspace_id uuid, p_key text, p_name text, p_format text, p_version integer, p_vendor text, p_instrument_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB105';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  IF p_vendor IS NULL OR p_vendor !~ '^[A-Z0-9_]{2,80}$' THEN
    RAISE EXCEPTION 'name the converter' USING ERRCODE = '22023';
  END IF;
  RETURN api.create_parser_version(p_workspace_id, p_key, p_name, p_format, p_version,
    jsonb_build_object('converter', jsonb_build_object('kind', 'allotropy', 'vendor', p_vendor)), '{}'::jsonb, p_instrument_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_converter_parser(uuid, text, text, text, integer, text, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_converter_parser(uuid, text, text, text, integer, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_converter_parser(uuid, text, text, text, integer, text, uuid) TO authenticated;
--> statement-breakpoint

-- Run quality control ----------------------------------------------------------
CREATE TABLE api.qc_series (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    -- 'plate_metric': fed by every analysed plate run of an assay design.
    -- 'manual': points are sent in (API, pipeline, instrument files).
    source_kind text NOT NULL,
    design_id uuid,
    metric text,
    instrument_id uuid,
    unit text,
    -- Limits: mean and SD, entered or taken from a baseline period.
    mean double precision,
    sd double precision,
    baseline_n integer,
    baseline_from timestamp with time zone,
    baseline_to timestamp with time zone,
    rules text[] DEFAULT ARRAY['1-3s','2-2s','R-4s','4-1s','10x']::text[] NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    state text DEFAULT 'in_control' NOT NULL,
    state_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT qc_series_pkey PRIMARY KEY (id),
    CONSTRAINT qc_series_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT qc_series_design_fk FOREIGN KEY (design_id) REFERENCES api.plate_designs(id) ON DELETE CASCADE,
    CONSTRAINT qc_series_instrument_fk FOREIGN KEY (instrument_id) REFERENCES api.instruments(id) ON DELETE SET NULL,
    CONSTRAINT chk_qc_series_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT chk_qc_series_source CHECK (source_kind IN ('plate_metric', 'manual')),
    CONSTRAINT chk_qc_series_plate CHECK (source_kind <> 'plate_metric' OR (design_id IS NOT NULL AND metric IS NOT NULL)),
    CONSTRAINT chk_qc_series_metric CHECK (metric IS NULL OR metric IN
        ('z_prime', 'signal_to_background', 'positive_mean', 'negative_mean', 'blank_mean', 'positive_cv', 'negative_cv')),
    CONSTRAINT chk_qc_series_state CHECK (state IN ('in_control', 'out_of_control')),
    CONSTRAINT chk_qc_series_sd CHECK (sd IS NULL OR sd > 0),
    CONSTRAINT chk_qc_series_rules CHECK (rules <@ ARRAY['1-3s','2-2s','R-4s','4-1s','10x']::text[])
);
--> statement-breakpoint
ALTER TABLE api.qc_series OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_qc_series_plate_metric ON api.qc_series (design_id, metric, coalesce(instrument_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE source_kind = 'plate_metric';
--> statement-breakpoint
CREATE INDEX idx_qc_series_workspace ON api.qc_series (workspace_id, name);
--> statement-breakpoint
CREATE INDEX idx_qc_series_instrument ON api.qc_series (instrument_id) WHERE instrument_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_qc_series_design ON api.qc_series (design_id) WHERE design_id IS NOT NULL;
--> statement-breakpoint

CREATE TABLE api.qc_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    series_id uuid NOT NULL,
    plate_run_id uuid,
    instrument_run_id uuid,
    value double precision NOT NULL,
    at timestamp with time zone NOT NULL,
    label text,
    z double precision,
    violations text[] DEFAULT '{}'::text[] NOT NULL,
    excluded boolean DEFAULT false NOT NULL,
    acknowledged_at timestamp with time zone,
    acknowledged_by_user_id text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT qc_points_pkey PRIMARY KEY (id),
    CONSTRAINT qc_points_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT qc_points_series_fk FOREIGN KEY (series_id) REFERENCES api.qc_series(id) ON DELETE CASCADE,
    CONSTRAINT qc_points_plate_run_fk FOREIGN KEY (plate_run_id) REFERENCES api.plate_runs(id) ON DELETE SET NULL,
    CONSTRAINT qc_points_instrument_run_fk FOREIGN KEY (instrument_run_id) REFERENCES api.instrument_runs(id) ON DELETE SET NULL,
    CONSTRAINT chk_qc_points_value CHECK (value <> 'NaN'::double precision AND value NOT IN ('Infinity'::double precision, '-Infinity'::double precision))
);
--> statement-breakpoint
ALTER TABLE api.qc_points OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_qc_points_plate_run ON api.qc_points (series_id, plate_run_id) WHERE plate_run_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_qc_points_series ON api.qc_points (series_id, at, id);
--> statement-breakpoint
CREATE INDEX idx_qc_points_workspace ON api.qc_points (workspace_id, created_at DESC);
--> statement-breakpoint

ALTER TABLE api.qc_series ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.qc_points ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY qc_series_select ON api.qc_series FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY qc_points_select ON api.qc_points FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY qc_series_client_select ON api.qc_series FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY qc_points_client_select ON api.qc_points FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.qc_series, api.qc_points TO authenticated, api_client;
--> statement-breakpoint

-- The Westgard rules a new point breaks, given the series' recent points. The
-- newest point is first. 1-3s: beyond three SD. 2-2s: two in a row beyond two SD
-- on one side. R-4s: two in a row more than four SD apart. 4-1s: four in a row
-- beyond one SD on one side. 10x: ten in a row on one side of the mean.
CREATE FUNCTION internal.qc_rules_broken(p_zs double precision[], p_rules text[]) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_out text[] := ARRAY[]::text[];
  v_n integer := coalesce(array_length(p_zs, 1), 0);
  v_ok boolean;
  i integer;
BEGIN
  IF v_n = 0 THEN RETURN v_out; END IF;
  IF '1-3s' = ANY(p_rules) AND abs(p_zs[1]) > 3 THEN v_out := array_append(v_out, '1-3s'); END IF;
  IF v_n >= 2 THEN
    IF '2-2s' = ANY(p_rules) AND ((p_zs[1] > 2 AND p_zs[2] > 2) OR (p_zs[1] < -2 AND p_zs[2] < -2)) THEN
      v_out := array_append(v_out, '2-2s');
    END IF;
    IF 'R-4s' = ANY(p_rules) AND ((p_zs[1] > 2 AND p_zs[2] < -2) OR (p_zs[1] < -2 AND p_zs[2] > 2)) THEN
      v_out := array_append(v_out, 'R-4s');
    END IF;
  END IF;
  IF v_n >= 4 AND '4-1s' = ANY(p_rules) THEN
    v_ok := true;
    FOR i IN 1..4 LOOP IF NOT (p_zs[i] > 1) THEN v_ok := false; END IF; END LOOP;
    IF NOT v_ok THEN
      v_ok := true;
      FOR i IN 1..4 LOOP IF NOT (p_zs[i] < -1) THEN v_ok := false; END IF; END LOOP;
    END IF;
    IF v_ok THEN v_out := array_append(v_out, '4-1s'); END IF;
  END IF;
  IF v_n >= 10 AND '10x' = ANY(p_rules) THEN
    v_ok := true;
    FOR i IN 1..10 LOOP IF NOT (p_zs[i] > 0) THEN v_ok := false; END IF; END LOOP;
    IF NOT v_ok THEN
      v_ok := true;
      FOR i IN 1..10 LOOP IF NOT (p_zs[i] < 0) THEN v_ok := false; END IF; END LOOP;
    END IF;
    IF v_ok THEN v_out := array_append(v_out, '10x'); END IF;
  END IF;
  RETURN v_out;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.qc_rules_broken(double precision[], text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.qc_rules_broken(double precision[], text[]) FROM PUBLIC;
--> statement-breakpoint

-- Judge one stored point against the series' limits and the points before it.
CREATE FUNCTION internal.qc_judge_point(p_point_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  p api.qc_points;
  s api.qc_series;
  v_z double precision;
  v_zs double precision[];
  v_broken text[];
BEGIN
  SELECT * INTO p FROM api.qc_points WHERE id = p_point_id;
  SELECT * INTO s FROM api.qc_series WHERE id = p.series_id;
  IF s.mean IS NULL OR s.sd IS NULL OR s.sd <= 0 OR p.excluded THEN
    UPDATE api.qc_points SET z = NULL, violations = '{}' WHERE id = p.id;
    RETURN;
  END IF;
  v_z := (p.value - s.mean) / s.sd;
  SELECT array_agg(q.z ORDER BY q.at DESC, q.id DESC) INTO v_zs
    FROM (SELECT (x.value - s.mean) / s.sd AS z, x.at, x.id
            FROM api.qc_points x
           WHERE x.series_id = p.series_id AND NOT x.excluded
             AND (x.at, x.id) <= (p.at, p.id)
           ORDER BY x.at DESC, x.id DESC
           LIMIT 10) q;
  v_broken := internal.qc_rules_broken(v_zs, s.rules);
  UPDATE api.qc_points SET z = v_z, violations = v_broken WHERE id = p.id;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.qc_judge_point(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.qc_judge_point(uuid) FROM PUBLIC;
--> statement-breakpoint

-- Judge every point again, oldest first, after the limits or rules change. The
-- series' state follows its newest point. No events: nothing new happened.
CREATE FUNCTION internal.qc_rejudge_series(p_series_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r record;
  v_last text[];
BEGIN
  FOR r IN SELECT id FROM api.qc_points WHERE series_id = p_series_id ORDER BY at, id LOOP
    PERFORM internal.qc_judge_point(r.id);
  END LOOP;
  SELECT violations INTO v_last FROM api.qc_points
   WHERE series_id = p_series_id AND NOT excluded ORDER BY at DESC, id DESC LIMIT 1;
  UPDATE api.qc_series SET
      state = CASE WHEN coalesce(array_length(v_last, 1), 0) > 0 THEN 'out_of_control' ELSE 'in_control' END,
      state_changed_at = CASE WHEN state IS DISTINCT FROM
        (CASE WHEN coalesce(array_length(v_last, 1), 0) > 0 THEN 'out_of_control' ELSE 'in_control' END)
        THEN now() ELSE state_changed_at END,
      updated_at = now()
    WHERE id = p_series_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.qc_rejudge_series(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.qc_rejudge_series(uuid) FROM PUBLIC;
--> statement-breakpoint

-- Add (or update) a point, judge it, and raise the events when the series goes
-- out of control or comes back.
CREATE FUNCTION internal.qc_add_point(
    p_series_id uuid, p_value double precision, p_at timestamp with time zone,
    p_label text, p_plate_run_id uuid, p_instrument_run_id uuid) RETURNS api.qc_points
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s api.qc_series;
  p api.qc_points;
  v_before text;
  v_recipient text;
  v_owner text;
  v_name text;
  v_link text;
BEGIN
  SELECT * INTO s FROM api.qc_series WHERE id = p_series_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'series not found' USING ERRCODE = 'SB015'; END IF;
  v_before := s.state;
  IF p_plate_run_id IS NOT NULL THEN
    INSERT INTO api.qc_points (workspace_id, series_id, plate_run_id, instrument_run_id, value, at, label)
    VALUES (s.workspace_id, s.id, p_plate_run_id, p_instrument_run_id, p_value, p_at, p_label)
    ON CONFLICT (series_id, plate_run_id) WHERE plate_run_id IS NOT NULL
    DO UPDATE SET value = EXCLUDED.value, at = EXCLUDED.at, label = EXCLUDED.label
    RETURNING * INTO p;
  ELSE
    INSERT INTO api.qc_points (workspace_id, series_id, instrument_run_id, value, at, label)
    VALUES (s.workspace_id, s.id, p_instrument_run_id, p_value, p_at, p_label)
    RETURNING * INTO p;
  END IF;
  IF NOT s.enabled THEN RETURN p; END IF;
  PERFORM internal.qc_judge_point(p.id);
  SELECT * INTO p FROM api.qc_points WHERE id = p.id;
  IF coalesce(array_length(p.violations, 1), 0) > 0 THEN
    UPDATE api.qc_series SET state = 'out_of_control',
        state_changed_at = CASE WHEN v_before = 'out_of_control' THEN state_changed_at ELSE now() END,
        updated_at = now()
      WHERE id = s.id;
    -- Its own entity, so a pipeline can start from a violation alone.
    PERFORM internal.emit_change_event(s.workspace_id, 'qc_violation', p.id, 'create', NULL, NULL,
      jsonb_build_object('seriesId', s.id, 'name', s.name, 'pointId', p.id,
                         'value', p.value, 'z', p.z, 'rules', to_jsonb(p.violations),
                         'instrumentId', s.instrument_id, 'designId', s.design_id,
                         'plateRunId', p.plate_run_id, 'at', p.at));
    IF v_before <> 'out_of_control' THEN
      v_name := s.name;
      v_link := CASE WHEN s.instrument_id IS NOT NULL THEN '/instruments/' || s.instrument_id::text ELSE '/plates' END;
      SELECT i.owner_id INTO v_owner FROM api.instruments i WHERE i.id = s.instrument_id;
      FOR v_recipient IN
        SELECT DISTINCT u FROM unnest(ARRAY[s.created_by_user_id, v_owner]) AS u WHERE u IS NOT NULL
      LOOP
        IF internal.notification_recipient_enabled(v_recipient, 'qc_violation') THEN
          INSERT INTO internal.notifications (workspace_id, user_id, event_type, title, body, link)
          VALUES (s.workspace_id, v_recipient, 'qc_violation', 'Quality control out of range',
                  v_name || ': ' || array_to_string(p.violations, ', '), v_link);
        END IF;
      END LOOP;
    END IF;
  ELSIF v_before = 'out_of_control' AND s.mean IS NOT NULL THEN
    UPDATE api.qc_series SET state = 'in_control', state_changed_at = now(), updated_at = now() WHERE id = s.id;
    PERFORM internal.emit_change_event(s.workspace_id, 'qc_series', s.id, 'update', NULL, NULL,
      jsonb_build_object('change', 'back_in_control', 'seriesId', s.id, 'name', s.name, 'pointId', p.id,
                         'value', p.value, 'z', p.z, 'instrumentId', s.instrument_id, 'designId', s.design_id,
                         'at', p.at));
  END IF;
  RETURN p;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.qc_add_point(uuid, double precision, timestamp with time zone, text, uuid, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.qc_add_point(uuid, double precision, timestamp with time zone, text, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint

-- What a plate run says about one metric, or null when it cannot say.
CREATE FUNCTION internal.qc_plate_metric(p_results jsonb, p_metric text) RETURNS double precision
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN p_results IS NULL THEN NULL
    ELSE nullif(
      CASE p_metric
        WHEN 'z_prime' THEN p_results #>> '{qc,zPrime}'
        WHEN 'signal_to_background' THEN p_results #>> '{qc,signalToBackground}'
        WHEN 'positive_mean' THEN p_results #>> '{qc,positive,mean}'
        WHEN 'negative_mean' THEN p_results #>> '{qc,negative,mean}'
        WHEN 'blank_mean' THEN p_results #>> '{qc,blank,mean}'
        WHEN 'positive_cv' THEN p_results #>> '{qc,positive,cv}'
        WHEN 'negative_cv' THEN p_results #>> '{qc,negative,cv}'
      END, '')::double precision
  END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.qc_plate_metric(jsonb, text) OWNER TO migrator;
--> statement-breakpoint

-- Every analysed plate run of an assay design feeds the series tracking it.
CREATE FUNCTION internal.qc_feed_plate_run() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s record;
  v_value double precision;
BEGIN
  IF NEW.design_id IS NULL OR NEW.results IS NULL OR NEW.status <> 'analysed' THEN RETURN NEW; END IF;
  FOR s IN SELECT id, metric FROM api.qc_series
            WHERE source_kind = 'plate_metric' AND design_id = NEW.design_id AND enabled LOOP
    v_value := internal.qc_plate_metric(NEW.results, s.metric);
    IF v_value IS NOT NULL THEN
      PERFORM internal.qc_add_point(s.id, v_value, coalesce(NEW.analysed_at, now()),
        'PLR-' || lpad(NEW.number::text, 4, '0'), NEW.id, NULL);
    END IF;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Quality control is derived; it must never block the analysis it watches.
  RAISE WARNING 'quality control feed failed for plate run %: %', NEW.id, SQLERRM;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.qc_feed_plate_run() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.qc_feed_plate_run() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER qc_feed_plate_run AFTER UPDATE OF results ON api.plate_runs
  FOR EACH ROW WHEN (NEW.results IS NOT NULL AND NEW.status = 'analysed')
  EXECUTE FUNCTION internal.qc_feed_plate_run();
--> statement-breakpoint

-- Can the caller change quality control here?
CREATE FUNCTION internal.qc_assert_writer(p_workspace_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.qc_assert_writer(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.qc_assert_writer(uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION api.create_qc_series(
    p_workspace_id uuid, p_name text, p_source_kind text DEFAULT 'manual',
    p_metric text DEFAULT NULL, p_design_id uuid DEFAULT NULL, p_instrument_id uuid DEFAULT NULL,
    p_unit text DEFAULT NULL, p_mean double precision DEFAULT NULL, p_sd double precision DEFAULT NULL,
    p_rules text[] DEFAULT NULL)
    RETURNS api.qc_series
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s api.qc_series;
  r record;
  v_value double precision;
BEGIN
  PERFORM internal.qc_assert_writer(p_workspace_id);
  IF p_design_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM api.plate_designs d WHERE d.id = p_design_id AND d.workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'assay design not found' USING ERRCODE = 'SB015';
  END IF;
  IF p_instrument_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM api.instruments i WHERE i.id = p_instrument_id AND i.workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'instrument not found' USING ERRCODE = 'SB015';
  END IF;
  INSERT INTO api.qc_series (workspace_id, name, source_kind, metric, design_id, instrument_id, unit, mean, sd, rules,
                             created_by_user_id)
  VALUES (p_workspace_id, btrim(p_name), p_source_kind, p_metric, p_design_id, p_instrument_id, p_unit, p_mean, p_sd,
          coalesce(p_rules, ARRAY['1-3s','2-2s','R-4s','4-1s','10x']::text[]), api.current_user_id())
  RETURNING * INTO s;
  -- A series for an assay starts with the runs that are already analysed.
  IF s.source_kind = 'plate_metric' THEN
    FOR r IN SELECT pr.id, pr.number, pr.results, pr.analysed_at FROM api.plate_runs pr
              WHERE pr.design_id = s.design_id AND pr.workspace_id = s.workspace_id
                AND pr.status = 'analysed' AND pr.results IS NOT NULL
              ORDER BY pr.analysed_at, pr.id LOOP
      v_value := internal.qc_plate_metric(r.results, s.metric);
      IF v_value IS NOT NULL THEN
        INSERT INTO api.qc_points (workspace_id, series_id, plate_run_id, value, at, label)
        VALUES (s.workspace_id, s.id, r.id, v_value, coalesce(r.analysed_at, now()),
                'PLR-' || lpad(r.number::text, 4, '0'));
      END IF;
    END LOOP;
  END IF;
  PERFORM internal.qc_rejudge_series(s.id);
  SELECT * INTO s FROM api.qc_series WHERE id = s.id;
  RETURN s;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_qc_series(uuid, text, text, text, uuid, uuid, text, double precision, double precision, text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_qc_series(uuid, text, text, text, uuid, uuid, text, double precision, double precision, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_qc_series(uuid, text, text, text, uuid, uuid, text, double precision, double precision, text[]) TO authenticated, api_client;
--> statement-breakpoint

-- Track an assay design's controls in one go: Z', signal to background, and the
-- two control means.
CREATE FUNCTION api.track_plate_assay_qc(p_design_id uuid, p_instrument_id uuid DEFAULT NULL)
    RETURNS SETOF api.qc_series
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  d api.plate_designs;
  m record;
  s api.qc_series;
BEGIN
  SELECT * INTO d FROM api.plate_designs WHERE id = p_design_id;
  IF d.id IS NULL THEN RAISE EXCEPTION 'assay design not found' USING ERRCODE = 'SB015'; END IF;
  PERFORM internal.qc_assert_writer(d.workspace_id);
  FOR m IN SELECT * FROM (VALUES
      ('z_prime', 'Z′'), ('signal_to_background', 'Signal to background'),
      ('positive_mean', 'Positive control mean'), ('negative_mean', 'Negative control mean')) AS t(metric, label) LOOP
    IF NOT EXISTS (SELECT 1 FROM api.qc_series x
                    WHERE x.source_kind = 'plate_metric' AND x.design_id = d.id AND x.metric = m.metric
                      AND x.instrument_id IS NOT DISTINCT FROM p_instrument_id) THEN
      s := api.create_qc_series(d.workspace_id, d.name || ' · ' || m.label, 'plate_metric', m.metric, d.id, p_instrument_id);
      RETURN NEXT s;
    END IF;
  END LOOP;
  RETURN;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.track_plate_assay_qc(uuid, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.track_plate_assay_qc(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.track_plate_assay_qc(uuid, uuid) TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.update_qc_series(
    p_series_id uuid, p_name text DEFAULT NULL, p_rules text[] DEFAULT NULL, p_enabled boolean DEFAULT NULL,
    p_unit text DEFAULT NULL)
    RETURNS api.qc_series
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s api.qc_series;
BEGIN
  SELECT * INTO s FROM api.qc_series WHERE id = p_series_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'series not found' USING ERRCODE = 'SB015'; END IF;
  PERFORM internal.qc_assert_writer(s.workspace_id);
  UPDATE api.qc_series SET
      name = coalesce(nullif(btrim(p_name), ''), name),
      rules = coalesce(p_rules, rules),
      enabled = coalesce(p_enabled, enabled),
      unit = coalesce(p_unit, unit),
      updated_at = now()
    WHERE id = s.id RETURNING * INTO s;
  IF p_rules IS NOT NULL THEN PERFORM internal.qc_rejudge_series(s.id); END IF;
  SELECT * INTO s FROM api.qc_series WHERE id = s.id;
  RETURN s;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.update_qc_series(uuid, text, text[], boolean, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_qc_series(uuid, text, text[], boolean, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.update_qc_series(uuid, text, text[], boolean, text) TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.delete_qc_series(p_series_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s api.qc_series;
BEGIN
  SELECT * INTO s FROM api.qc_series WHERE id = p_series_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'series not found' USING ERRCODE = 'SB015'; END IF;
  PERFORM internal.qc_assert_writer(s.workspace_id);
  DELETE FROM api.qc_series WHERE id = s.id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.delete_qc_series(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_qc_series(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.delete_qc_series(uuid) TO authenticated, api_client;
--> statement-breakpoint

-- Enter the limits, or take them from the first points. Every point is judged
-- again against the new limits.
CREATE FUNCTION api.set_qc_baseline(
    p_series_id uuid, p_mean double precision DEFAULT NULL, p_sd double precision DEFAULT NULL,
    p_first_n integer DEFAULT NULL)
    RETURNS api.qc_series
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s api.qc_series;
  v_n integer;
  v_mean double precision;
  v_sd double precision;
  v_from timestamp with time zone;
  v_to timestamp with time zone;
BEGIN
  SELECT * INTO s FROM api.qc_series WHERE id = p_series_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'series not found' USING ERRCODE = 'SB015'; END IF;
  PERFORM internal.qc_assert_writer(s.workspace_id);
  IF p_first_n IS NOT NULL THEN
    IF p_first_n < 5 OR p_first_n > 1000 THEN
      RAISE EXCEPTION 'use between 5 and 1000 points for a baseline' USING ERRCODE = '22023';
    END IF;
    SELECT count(*), avg(q.value), stddev_samp(q.value), min(q.at), max(q.at)
      INTO v_n, v_mean, v_sd, v_from, v_to
      FROM (SELECT value, at FROM api.qc_points
             WHERE series_id = s.id AND NOT excluded ORDER BY at, id LIMIT p_first_n) q;
    IF v_n < 5 THEN
      RAISE EXCEPTION 'a baseline needs at least 5 points; this series has %', v_n USING ERRCODE = '22023';
    END IF;
    IF v_sd IS NULL OR v_sd <= 0 THEN
      RAISE EXCEPTION 'the first points do not vary, so there is no spread to judge against' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_mean IS NULL OR p_sd IS NULL OR p_sd <= 0 THEN
      RAISE EXCEPTION 'enter a mean and a standard deviation above zero' USING ERRCODE = '22023';
    END IF;
    v_mean := p_mean; v_sd := p_sd; v_n := NULL; v_from := NULL; v_to := NULL;
  END IF;
  UPDATE api.qc_series SET mean = v_mean, sd = v_sd, baseline_n = v_n, baseline_from = v_from,
      baseline_to = v_to, updated_at = now()
    WHERE id = s.id;
  PERFORM internal.qc_rejudge_series(s.id);
  SELECT * INTO s FROM api.qc_series WHERE id = s.id;
  RETURN s;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_qc_baseline(uuid, double precision, double precision, integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_qc_baseline(uuid, double precision, double precision, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_qc_baseline(uuid, double precision, double precision, integer) TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.record_qc_point(
    p_series_id uuid, p_value double precision, p_at timestamp with time zone DEFAULT NULL,
    p_label text DEFAULT NULL, p_instrument_run_id uuid DEFAULT NULL)
    RETURNS api.qc_points
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s api.qc_series;
BEGIN
  SELECT * INTO s FROM api.qc_series WHERE id = p_series_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'series not found' USING ERRCODE = 'SB015'; END IF;
  PERFORM internal.qc_assert_writer(s.workspace_id);
  IF s.source_kind <> 'manual' THEN
    RAISE EXCEPTION 'this series is fed by plate runs; add points by analysing a plate' USING ERRCODE = '22023';
  END IF;
  IF p_value IS NULL OR p_value = 'NaN'::double precision OR p_value IN ('Infinity'::double precision, '-Infinity'::double precision) THEN
    RAISE EXCEPTION 'give a finite number' USING ERRCODE = '22023';
  END IF;
  IF p_instrument_run_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM api.instrument_runs r WHERE r.id = p_instrument_run_id AND r.workspace_id = s.workspace_id) THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB039';
  END IF;
  RETURN internal.qc_add_point(s.id, p_value, coalesce(p_at, now()), p_label, NULL, p_instrument_run_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.record_qc_point(uuid, double precision, timestamp with time zone, text, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_qc_point(uuid, double precision, timestamp with time zone, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_qc_point(uuid, double precision, timestamp with time zone, text, uuid) TO authenticated, api_client;
--> statement-breakpoint

-- Note a breach (what was done about it), and optionally leave the point out of
-- the limits and the rules from now on.
CREATE FUNCTION api.acknowledge_qc_point(p_point_id uuid, p_note text DEFAULT NULL, p_exclude boolean DEFAULT false)
    RETURNS api.qc_points
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  p api.qc_points;
BEGIN
  SELECT * INTO p FROM api.qc_points WHERE id = p_point_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'point not found' USING ERRCODE = 'SB015'; END IF;
  PERFORM internal.qc_assert_writer(p.workspace_id);
  UPDATE api.qc_points SET acknowledged_at = now(), acknowledged_by_user_id = api.current_user_id(),
      note = nullif(btrim(p_note), ''), excluded = excluded OR coalesce(p_exclude, false)
    WHERE id = p.id;
  IF p_exclude THEN PERFORM internal.qc_rejudge_series(p.series_id); END IF;
  SELECT * INTO p FROM api.qc_points WHERE id = p.id;
  RETURN p;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.acknowledge_qc_point(uuid, text, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.acknowledge_qc_point(uuid, text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.acknowledge_qc_point(uuid, text, boolean) TO authenticated, api_client;
--> statement-breakpoint

-- A pipeline can store a converted ASM document, send in a QC point and
-- acknowledge a breach.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"record_instrument_run_document","rpc":"record_instrument_run_document","label":"Keep the ASM document of a run","description":"Store the Allotrope (ASM) document a Python step converted from an instrument file against its instrument run.","arguments":[{"name":"p_run_id","type":"uuid","required":true,"nullable":false},{"name":"p_document","type":"jsonb","required":true,"nullable":false},{"name":"p_converter","type":"text","required":true,"nullable":false},{"name":"p_converter_version","type":"text","required":false,"nullable":true},{"name":"p_image_digest","type":"text","required":false,"nullable":true},{"name":"p_vendor","type":"text","required":false,"nullable":true},{"name":"p_technique","type":"text","required":false,"nullable":true},{"name":"p_manifest","type":"text","required":false,"nullable":true},{"name":"p_measurements","type":"integer","required":false,"nullable":false},{"name":"p_device","type":"jsonb","required":false,"nullable":false}]},{"operation":"record_qc_point","rpc":"record_qc_point","label":"Add a quality control point","description":"Add a value to a tracked quality control series; it is judged against the series' limits and rules.","arguments":[{"name":"p_series_id","type":"uuid","required":true,"nullable":false},{"name":"p_value","type":"numeric","required":true,"nullable":false},{"name":"p_at","type":"text","required":false,"nullable":true},{"name":"p_label","type":"text","required":false,"nullable":true},{"name":"p_instrument_run_id","type":"uuid","required":false,"nullable":true}]},{"operation":"acknowledge_qc_point","rpc":"acknowledge_qc_point","label":"Acknowledge a quality control breach","description":"Note what was done about a point that broke a rule, optionally leaving it out of the limits.","arguments":[{"name":"p_point_id","type":"uuid","required":true,"nullable":false},{"name":"p_note","type":"text","required":false,"nullable":true},{"name":"p_exclude","type":"boolean","required":false,"nullable":false}]}$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || ']$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
