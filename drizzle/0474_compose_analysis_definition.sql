-- Put a saved chart into an analysis block's definition.
--
-- A notebook analysis block holds a chart, a statistic or both (migration 0473).
-- The chart comes from a saved chart view in the Analysis studio; the statistic,
-- if any, from a saved analysis definition. This composes them into a new saved
-- definition owned by the caller: the statistic's body with the view's ChartSpec
-- beside it, or, with no statistic, a chart-only definition. The view and the
-- statistic stay as they were.
--
-- The chart must read the single dataset the statistic reads, and a view that
-- reads several datasets cannot be merged, because a block pins one Dataset
-- Version. Both are refused with the cause. Row-level security decides what the
-- caller may read and insert, so this is SECURITY INVOKER.
CREATE OR REPLACE FUNCTION "api"."compose_analysis_definition"(
  p_chart_view_id uuid,
  p_statistic_definition_id uuid,
  p_name text
) RETURNS "api"."analysis_definitions"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_view api.analysis_views;
  v_statistic api.analysis_definitions;
  v_dataset text;
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
  IF jsonb_typeof(v_view.spec->'datasets') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_view.spec->'datasets') <> 1 THEN
    RAISE EXCEPTION 'a chart that reads more than one dataset cannot be part of an analysis block'
      USING ERRCODE = '22023';
  END IF;
  v_dataset := v_view.spec#>>'{datasets,0,datasetId}';
  v_revisions := v_view.source_revisions;

  IF p_statistic_definition_id IS NULL THEN
    v_definition := jsonb_build_object(
      'definitionVersion', 1,
      'kind', 'chart',
      'datasets', jsonb_build_array(jsonb_build_object('datasetId', v_dataset)),
      'chart', v_view.spec
    );
  ELSE
    SELECT * INTO v_statistic FROM api.analysis_definitions WHERE id = p_statistic_definition_id;
    IF v_statistic.id IS NULL OR v_statistic.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
      RAISE EXCEPTION 'analysis not found' USING ERRCODE = '42501';
    END IF;
    IF v_statistic.definition#>>'{datasets,0,datasetId}' IS DISTINCT FROM v_dataset THEN
      RAISE EXCEPTION 'the chart must read the dataset the analysis reads' USING ERRCODE = '23514';
    END IF;
    v_definition := v_statistic.definition || jsonb_build_object('chart', v_view.spec);
    v_revisions := v_statistic.source_revisions;
  END IF;

  INSERT INTO api.analysis_definitions (workspace_id, owner_user_id, name, definition, source_revisions)
  VALUES (api.current_workspace_id(), api.current_user_id(), v_name, v_definition, v_revisions)
  RETURNING * INTO v_result;
  RETURN v_result;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."compose_analysis_definition"(uuid, uuid, text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."compose_analysis_definition"(uuid, uuid, text) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
