-- ANALYSIS-002: immutable, authoritative analysis execution/result snapshots.
-- The existing analysis_views row remains the mutable identity and draft.
-- Drop the stale PostgreSQL-incompatible Unicode escape check left by 0047;
-- current Drizzle schema validation intentionally does not declare it.

ALTER TABLE api.analysis_views DROP CONSTRAINT IF EXISTS chk_analysis_views_name;
ALTER TABLE api.analysis_views ADD CONSTRAINT chk_analysis_views_name
  CHECK (length(btrim(name)) BETWEEN 1 AND 100);
--> statement-breakpoint

CREATE TABLE "api"."analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"analysis_view_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"actor_user_id" text NOT NULL,
	"status" text NOT NULL,
	"spec_snapshot" jsonb NOT NULL,
	"source_observations" jsonb NOT NULL,
	"result_snapshot" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"engine_version" text NOT NULL,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_analysis_runs_view_sequence" UNIQUE("analysis_view_id","sequence"),
	CONSTRAINT "chk_analysis_runs_sequence" CHECK ("api"."analysis_runs"."sequence" > 0),
	CONSTRAINT "chk_analysis_runs_status" CHECK ("api"."analysis_runs"."status" IN ('completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "api"."analysis_runs" ADD CONSTRAINT "analysis_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api"."analysis_runs" ADD CONSTRAINT "analysis_runs_analysis_view_id_analysis_views_id_fk" FOREIGN KEY ("analysis_view_id") REFERENCES "api"."analysis_views"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api"."analysis_views" ADD CONSTRAINT "uq_analysis_views_workspace_id" UNIQUE("workspace_id","id");
--> statement-breakpoint
ALTER TABLE "api"."analysis_runs" ADD CONSTRAINT "analysis_runs_workspace_view_fk" FOREIGN KEY ("workspace_id","analysis_view_id") REFERENCES "api"."analysis_views"("workspace_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api"."analysis_runs" ADD CONSTRAINT "analysis_runs_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "internal"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_analysis_runs_workspace" ON "api"."analysis_runs" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_analysis_runs_view_sequence" ON "api"."analysis_runs" USING btree ("analysis_view_id","sequence");
--> statement-breakpoint

ALTER TABLE api.analysis_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON api.analysis_runs TO authenticated;
--> statement-breakpoint
GRANT SELECT ON api.analysis_runs TO api_client;
--> statement-breakpoint
CREATE POLICY analysis_runs_select ON api.analysis_runs FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY analysis_runs_client_select ON api.analysis_runs FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.reject_analysis_run_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'analysis runs are immutable' USING ERRCODE = '55000';
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_analysis_runs_immutable
  BEFORE UPDATE OR DELETE ON api.analysis_runs
  FOR EACH ROW EXECUTE FUNCTION internal.reject_analysis_run_mutation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.analysis_chart_spec_v1_valid(p_spec jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_binding_name text;
  v_binding jsonb;
  v_item jsonb;
  v_error_bars jsonb;
BEGIN
  IF jsonb_typeof(p_spec) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_spec->'specVersion') IS DISTINCT FROM 'number'
     OR (p_spec->>'specVersion')::numeric <> 1
     OR coalesce(p_spec->>'type', '') NOT IN ('line', 'scatter', 'bar')
     OR jsonb_typeof(p_spec->'datasets') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_spec->'datasets') <> 1
     OR (p_spec#>>'{datasets,0,tableId}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR jsonb_typeof(p_spec->'fields') IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  FOREACH v_binding_name IN ARRAY ARRAY['x', 'y', 'series', 'color', 'size'] LOOP
    v_binding := p_spec->'fields'->v_binding_name;
    IF v_binding_name = 'y'
       OR (v_binding_name = 'x' AND p_spec->>'type' IN ('line', 'bar')) THEN
      IF jsonb_typeof(v_binding) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    ELSIF jsonb_typeof(v_binding) NOT IN ('object', 'null')
          OR jsonb_typeof(v_binding) IS NULL THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(v_binding) = 'object'
       AND ((v_binding->>'columnId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            OR length(btrim(coalesce(v_binding->>'fieldName', ''))) = 0) THEN
      RETURN false;
    END IF;
  END LOOP;
  IF jsonb_typeof(p_spec->'filters') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_spec->'filters') LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR (v_item->>'columnId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR length(btrim(coalesce(v_item->>'fieldName', ''))) = 0
       OR coalesce(v_item->>'op', '') NOT IN ('eq','ne','gt','gte','lt','lte','in','between')
       OR NOT (v_item ? 'value') THEN RETURN false;
    END IF;
  END LOOP;
  IF jsonb_typeof(p_spec->'transformations') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_spec->'transformations') LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR coalesce(v_item->>'kind', '') NOT IN ('aggregate','bin','normalise')
       OR jsonb_typeof(v_item->'params') IS DISTINCT FROM 'object' THEN RETURN false;
    END IF;
  END LOOP;
  IF jsonb_typeof(p_spec->'display') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_spec#>'{display,axes,x}') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_spec#>'{display,axes,y}') IS DISTINCT FROM 'object'
     OR coalesce(p_spec#>>'{display,axes,x,scale}', '') NOT IN ('linear','log')
     OR coalesce(p_spec#>>'{display,axes,y,scale}', '') NOT IN ('linear','log')
     OR (p_spec#>'{display,axes,x}' ? 'label' AND jsonb_typeof(p_spec#>'{display,axes,x,label}') NOT IN ('string','null'))
     OR (p_spec#>'{display,axes,y}' ? 'label' AND jsonb_typeof(p_spec#>'{display,axes,y,label}') NOT IN ('string','null'))
     OR (p_spec#>'{display,axes,x}' ? 'unit' AND jsonb_typeof(p_spec#>'{display,axes,x,unit}') IS DISTINCT FROM 'string')
     OR (p_spec#>'{display,axes,y}' ? 'unit' AND jsonb_typeof(p_spec#>'{display,axes,y,unit}') IS DISTINCT FROM 'string')
     OR jsonb_typeof(p_spec#>'{display,series}') IS DISTINCT FROM 'array' THEN RETURN false;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_spec#>'{display,series}') LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR length(btrim(coalesce(v_item->>'identifier', ''))) = 0
       OR length(btrim(coalesce(v_item->>'label', ''))) = 0
       OR coalesce(lower(v_item->>'color'), '') NOT IN (
         '#006edc','#00a659','#9b61ea','#00a3bb','#e8a200'
       ) THEN RETURN false;
    END IF;
  END LOOP;
  IF jsonb_typeof(p_spec->'overlays') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  v_error_bars := p_spec#>'{overlays,errorBars}';
  IF jsonb_typeof(v_error_bars) NOT IN ('object', 'null') OR jsonb_typeof(v_error_bars) IS NULL THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(v_error_bars) = 'object'
     AND ((v_error_bars->>'columnId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR length(btrim(coalesce(v_error_bars->>'fieldName', ''))) = 0
          OR coalesce(v_error_bars->>'basis', '') NOT IN ('sd','se','range','custom')
          OR (v_error_bars ? 'multiplier'
              AND (jsonb_typeof(v_error_bars->'multiplier') IS DISTINCT FROM 'number'
                   OR (v_error_bars->>'multiplier')::numeric <= 0))) THEN
    RETURN false;
  END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_analysis_run(
  p_analysis_view_id uuid,
  p_status text,
  p_spec_snapshot jsonb,
  p_result_snapshot jsonb,
  p_warnings jsonb,
  p_engine_version text
) RETURNS api.analysis_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_user_id text := api.current_user_id();
  v_view api.analysis_views;
  v_source api.scientific_tables;
  v_run api.analysis_runs;
  v_sequence integer;
  v_digest_payload jsonb;
  v_source_observations jsonb;
  v_item jsonb;
  v_point jsonb;
  v_row_count bigint;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user required' USING ERRCODE = '42501';
  END IF;

  -- Locking the stable analysis identity serialises sequence allocation for
  -- this analysis without trusting a caller-supplied workspace or actor.
  SELECT * INTO v_view FROM api.analysis_views
    WHERE id = p_analysis_view_id FOR UPDATE;
  IF v_view.id IS NULL
     OR v_view.owner_user_id IS DISTINCT FROM v_actor_user_id
     OR NOT api.is_workspace_member(v_view.workspace_id)
     OR v_view.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'analysis run target denied' USING ERRCODE = '42501';
  END IF;

  -- The MVP records successful evidence only. Failed calculations remain
  -- transient until a durable diagnostic snapshot contract is defined.
  IF p_status IS DISTINCT FROM 'completed'
     OR NOT internal.analysis_chart_spec_v1_valid(p_spec_snapshot)
     OR jsonb_typeof(p_result_snapshot) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_result_snapshot->'state') IS DISTINCT FROM 'object'
     OR p_result_snapshot#>>'{state,kind}' IS DISTINCT FROM 'ok'
     OR jsonb_typeof(p_result_snapshot->'columns') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_result_snapshot->'rows') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_result_snapshot->'series') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_result_snapshot->'xLabel') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_result_snapshot->'yLabel') IS DISTINCT FROM 'string'
     OR (p_result_snapshot ? 'xUnit' AND jsonb_typeof(p_result_snapshot->'xUnit') IS DISTINCT FROM 'string')
     OR (p_result_snapshot ? 'yUnit' AND jsonb_typeof(p_result_snapshot->'yUnit') IS DISTINCT FROM 'string')
     OR jsonb_typeof(p_warnings) IS DISTINCT FROM 'array'
     OR length(btrim(coalesce(p_engine_version, ''))) = 0 THEN
    RAISE EXCEPTION 'invalid analysis run snapshot' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_result_snapshot->'columns') LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_item->'id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'fieldName') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'label') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'logicalType') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid analysis result column' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_result_snapshot->'rows') LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid analysis result row' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_result_snapshot->'series') LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_item->'identifier') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'label') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'color') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'points') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid analysis result series' USING ERRCODE = '22023';
    END IF;
    FOR v_point IN SELECT value FROM jsonb_array_elements(v_item->'points') LOOP
      IF jsonb_typeof(v_point) IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_point->'x') IS NULL
         OR jsonb_typeof(v_point->'x') NOT IN ('number', 'null')
         OR jsonb_typeof(v_point->'y') IS NULL
         OR jsonb_typeof(v_point->'y') NOT IN ('number', 'null')
         OR (v_point ? 'yError' AND jsonb_typeof(v_point->'yError') NOT IN ('number', 'null'))
         OR (v_point ? 'label' AND jsonb_typeof(v_point->'label') IS DISTINCT FROM 'string') THEN
        RAISE EXCEPTION 'invalid analysis result point' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;

  SELECT * INTO v_source FROM api.scientific_tables t
    WHERE t.id::text = p_spec_snapshot#>>'{datasets,0,tableId}'
      AND t.workspace_id = v_view.workspace_id;
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'analysis run source denied' USING ERRCODE = '22023';
  END IF;
  EXECUTE format('SELECT count(*) FROM api.%I', v_source.resource_name) INTO v_row_count;
  v_source_observations := jsonb_build_object(
    'tableId', v_source.id,
    'sourceName', v_source.name,
    'schemaVersion', v_source.schema_version,
    'datasetSchemaId', v_source.dataset_schema_id,
    'datasetSchemaRevision', v_source.dataset_schema_revision,
    'observedAt', clock_timestamp(),
    'rowCount', v_row_count
  );

  SELECT coalesce(max(sequence), 0) + 1 INTO v_sequence
    FROM api.analysis_runs WHERE analysis_view_id = v_view.id;
  v_digest_payload := jsonb_build_object(
    'analysisViewId', v_view.id,
    'sequence', v_sequence,
    'status', p_status,
    'specSnapshot', p_spec_snapshot,
    'sourceObservations', v_source_observations,
    'resultSnapshot', p_result_snapshot,
    'warnings', p_warnings,
    'engineVersion', btrim(p_engine_version)
  );

  INSERT INTO api.analysis_runs (
    workspace_id, analysis_view_id, sequence, actor_user_id, status,
    spec_snapshot, source_observations, result_snapshot, warnings,
    engine_version, digest
  ) VALUES (
    v_view.workspace_id, v_view.id, v_sequence, v_actor_user_id, p_status,
    p_spec_snapshot, v_source_observations, p_result_snapshot, p_warnings,
    btrim(p_engine_version),
    encode(sha256(convert_to(v_digest_payload::text, 'UTF8')), 'hex')
  ) RETURNING * INTO v_run;
  RETURN v_run;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_analysis_run(uuid,text,jsonb,jsonb,jsonb,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_analysis_run(uuid,text,jsonb,jsonb,jsonb,text) TO authenticated;
--> statement-breakpoint
ALTER TABLE api.blocks DROP CONSTRAINT IF EXISTS chk_blocks_type;
--> statement-breakpoint
ALTER TABLE api.blocks ADD CONSTRAINT chk_blocks_type CHECK (type IN ('rich_text', 'checklist', 'linked_record', 'callout', 'table', 'sheet', 'chart', 'analysis_reference', 'plate_map', 'file', 'metric', 'procedure_step', 'protocol_reference', 'materials'));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.validate_analysis_reference_block()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_owner api.records;
  v_run api.analysis_runs;
  v_key_count integer;
BEGIN
  IF NEW.type <> 'analysis_reference' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.type IS NOT DISTINCT FROM OLD.type
     AND NEW.payload_schema_version IS NOT DISTINCT FROM OLD.payload_schema_version
     AND NEW.payload IS NOT DISTINCT FROM OLD.payload THEN RETURN NEW; END IF;
  IF NEW.payload_schema_version <> 1 OR jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid analysis reference payload' USING ERRCODE = '23514';
  END IF;
  IF NEW.payload = '{}'::jsonb THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_key_count FROM jsonb_object_keys(NEW.payload);
  IF v_key_count <> 3
     OR NOT (NEW.payload ?& ARRAY['analysisId', 'runId', 'title'])
     OR jsonb_typeof(NEW.payload->'analysisId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW.payload->'runId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW.payload->'title') IS DISTINCT FROM 'string'
     OR length(btrim(NEW.payload->>'title')) = 0 THEN
    RAISE EXCEPTION 'invalid analysis reference payload' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_owner FROM api.records WHERE id = NEW.record_id;
  BEGIN
    SELECT r.* INTO v_run
      FROM api.analysis_runs r
      JOIN api.analysis_views v ON v.id = r.analysis_view_id
      WHERE r.id = (NEW.payload->>'runId')::uuid
        AND v.id = (NEW.payload->>'analysisId')::uuid
        AND r.workspace_id = v_owner.workspace_id
        AND v.workspace_id = v_owner.workspace_id
        AND r.status = 'completed'
        AND r.result_snapshot#>>'{state,kind}' = 'ok';
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid analysis reference UUID' USING ERRCODE = '23514';
  END;
  IF v_owner.id IS NULL OR v_run.id IS NULL THEN
    RAISE EXCEPTION 'invalid analysis reference target' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.validate_analysis_reference_block() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER validate_analysis_reference_block
  BEFORE INSERT OR UPDATE ON api.blocks
  FOR EACH ROW EXECUTE FUNCTION api.validate_analysis_reference_block();
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
