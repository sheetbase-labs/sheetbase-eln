-- An analysis carries its charts in one column. `charts` is an ordered list of
-- full ChartSpecs on the same source; the first is the primary chart. It
-- replaces `spec`, so there is a single place a view's charts live.
ALTER TABLE api.analysis_views ADD COLUMN charts jsonb;
--> statement-breakpoint
ALTER TABLE api.analysis_views DISABLE TRIGGER trg_analysis_view_version;
--> statement-breakpoint
UPDATE api.analysis_views SET charts = jsonb_build_array(spec);
--> statement-breakpoint
ALTER TABLE api.analysis_views ENABLE TRIGGER trg_analysis_view_version;
--> statement-breakpoint
ALTER TABLE api.analysis_views ALTER COLUMN charts SET NOT NULL;
--> statement-breakpoint
ALTER TABLE api.analysis_views
  ADD CONSTRAINT chk_analysis_views_charts
  CHECK (jsonb_typeof(charts) = 'array' AND jsonb_array_length(charts) BETWEEN 1 AND 8);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.compose_analysis_definition(p_chart_view_id uuid, p_statistic_definition_id uuid, p_name text) RETURNS api.analysis_definitions
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_view api.analysis_views;
  v_statistic api.analysis_definitions;
  v_dataset text;
  v_version text;
  v_reference jsonb;
  v_definition jsonb;
  v_revisions jsonb;
  v_name text := btrim(coalesce(p_name, ''));
  v_result api.analysis_definitions;
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'a name is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_view FROM api.analysis_views WHERE id = p_chart_view_id;
  IF v_view.id IS NULL OR v_view.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'chart view not found' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof((v_view.charts->0)->'datasets') IS DISTINCT FROM 'array'
     OR jsonb_array_length((v_view.charts->0)->'datasets') <> 1 THEN
    RAISE EXCEPTION 'a chart that reads more than one dataset cannot be part of an analysis block'
      USING ERRCODE = '22023';
  END IF;
  v_dataset := (v_view.charts->0)#>>'{datasets,0,datasetId}';
  v_version := (v_view.charts->0)#>>'{datasets,0,datasetVersionId}';
  v_reference := jsonb_build_object('datasetId', v_dataset);
  IF v_version IS NOT NULL THEN
    v_reference := v_reference || jsonb_build_object('datasetVersionId', v_version);
  END IF;
  v_revisions := v_view.source_revisions;

  IF p_statistic_definition_id IS NULL THEN
    v_definition := jsonb_build_object(
      'definitionVersion', 1,
      'kind', 'chart',
      'datasets', jsonb_build_array(v_reference),
      'chart', v_view.charts->0
    );
  ELSE
    SELECT * INTO v_statistic FROM api.analysis_definitions WHERE id = p_statistic_definition_id;
    IF v_statistic.id IS NULL OR v_statistic.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
      RAISE EXCEPTION 'analysis not found' USING ERRCODE = '42501';
    END IF;
    IF v_statistic.definition#>>'{datasets,0,datasetId}' IS DISTINCT FROM v_dataset
       OR v_statistic.definition#>>'{datasets,0,datasetVersionId}' IS DISTINCT FROM v_version THEN
      RAISE EXCEPTION 'the chart must read the dataset the analysis reads' USING ERRCODE = '23514';
    END IF;
    v_definition := v_statistic.definition || jsonb_build_object('chart', v_view.charts->0);
    v_revisions := v_statistic.source_revisions;
  END IF;

  INSERT INTO api.analysis_definitions (workspace_id, owner_user_id, name, definition, source_revisions)
  VALUES (api.current_workspace_id(), api.current_user_id(), v_name, v_definition, v_revisions)
  RETURNING * INTO v_result;
  RETURN v_result;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.guard_analysis_view_cited_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE cited integer;
BEGIN
  IF NEW.charts IS NOT DISTINCT FROM OLD.charts
     AND NEW.source_revisions IS NOT DISTINCT FROM OLD.source_revisions THEN
    RETURN NEW;
  END IF;
  -- Request-role gate: this rule exists for browser and API-client writes,
  -- which are the only writers that carry request claims. The trigger is
  -- SECURITY DEFINER so its citation count reads every citing record
  -- authoritatively, which means `current_user` is the definer here — the
  -- request role has to come from the claims (`api.claim_probe`), the same
  -- marker `internal.can_read_record_link_target` uses. Seed and migration
  -- connections carry no claims and maintain this data directly;
  -- `api.resolve_analysis_view_sources` also runs as its definer and performs
  -- the identical citation check itself before re-pinning.
  IF coalesce(api.claim_probe()->>'role','') NOT IN ('authenticated', 'api_client') THEN
    RETURN NEW;
  END IF;
  IF OLD.display_id IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO cited
    FROM internal.analysis_view_citations(OLD.workspace_id, OLD.display_id);
  IF cited > 0 THEN
    RAISE EXCEPTION 'analysis is cited by % record(s); a cited analysis keeps the sources it cited — save it under a new name', cited
      USING ERRCODE = 'SB078';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.can_read_record_link_target(p_source_record_id uuid, p_target_kind text, p_target_identifier text, p_target_record_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT CASE WHEN p_target_kind='dataset' THEN
    p_target_record_id IS NULL AND EXISTS(
      SELECT 1 FROM api.datasets d JOIN api.records s ON s.workspace_id=d.workspace_id
      WHERE s.id=p_source_record_id AND d.display_id=p_target_identifier
        AND internal.can_access_object('dataset',d.id,'view'))
  WHEN p_target_kind='analysis' THEN
    p_target_record_id IS NULL AND EXISTS(
      SELECT 1 FROM api.analysis_views a JOIN api.records s ON s.workspace_id=a.workspace_id
      WHERE s.id=p_source_record_id AND a.display_id=p_target_identifier
        AND a.workspace_id=api.current_workspace_id()
        AND (api.claim_probe()->>'role'='api_client' OR
          (api.claim_probe()->>'role'='authenticated' AND api.is_workspace_member(a.workspace_id)))
        AND internal.sources_readable(a.charts) AND internal.sources_readable(a.source_revisions))
  ELSE EXISTS(
    SELECT 1 FROM api.records t JOIN api.records s ON s.workspace_id=t.workspace_id
    WHERE s.id=p_source_record_id AND t.kind=p_target_kind AND t.identifier=p_target_identifier
      AND (p_target_record_id IS NULL OR t.id=p_target_record_id)
      AND internal.can_access_object('record',t.id,'view')) END
$$;
--> statement-breakpoint
ALTER TABLE api.analysis_views DROP COLUMN spec;
