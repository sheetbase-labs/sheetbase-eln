-- DSET-01.4 — request repeat.
--
-- "Request repeat" reacts to a flagged/repeated measurement by creating, in one
-- transaction:
--   * a derived dilution sample — the existing sample model from LAB-01: a
--     `records` row of kind 'sample' with its `sample_events` creation entry;
--     and
--   * the planned Dataset rows that will hold the repeat measurement, through
--     the existing `api.plan_dataset_row` (DSET-01.3).
-- The derived sample is joined to its source sample through the existing
-- `record_links` lineage edge (link_type 'sample'); the source measurement
-- coordinates ride in `link_metadata` so no second lineage model is invented.
--
-- SECURITY DEFINER with the same writer/actor gate as the sibling sample and
-- dataset mutations. A repeat request that would duplicate an existing request
-- for the same source measurement and schedule is rejected with SB075 rather
-- than silently deriving a second dilution.

CREATE OR REPLACE FUNCTION api.request_repeat(
  p_source_record_id uuid,
  p_dataset_id uuid,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_planned_row_count integer DEFAULT 1,
  p_source_row_id uuid DEFAULT NULL,
  p_source_field_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_properties jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_workspace uuid := api.current_workspace_id();
  v_source api.records;
  v_dataset api.datasets;
  v_sample api.records;
  v_row api.dataset_rows;
  v_identifier text;
  v_project uuid;
  v_title text;
  v_metadata jsonb;
  v_row_ids uuid[] := '{}';
  i integer;
BEGIN
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'repeat denied' USING ERRCODE = '42501';
  END IF;
  IF NOT (api.is_workspace_writer(v_workspace) AND api.has_write_actor()) THEN
    RAISE EXCEPTION 'repeat denied' USING ERRCODE = '42501';
  END IF;

  IF p_planned_row_count IS NULL
     OR p_planned_row_count < 1 OR p_planned_row_count > 96 THEN
    RAISE EXCEPTION 'planned row count must be between 1 and 96'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_source FROM api.records
    WHERE id = p_source_record_id AND workspace_id = v_workspace
      AND kind = 'sample'
    FOR UPDATE;
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'source sample not found' USING ERRCODE = '42501';
  END IF;
  IF v_source.archived_at IS NOT NULL OR v_source.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot repeat an archived sample' USING ERRCODE = 'SB004';
  END IF;

  SELECT * INTO v_dataset FROM api.datasets
    WHERE id = p_dataset_id AND workspace_id = v_workspace
      AND api.is_workspace_writer(workspace_id) AND api.has_write_actor()
    FOR UPDATE;
  IF v_dataset.id IS NULL THEN
    RAISE EXCEPTION 'Dataset denied' USING ERRCODE = '42501';
  END IF;
  IF v_dataset.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'cannot request a repeat into an archived Dataset'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_row_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.dataset_rows r
    WHERE r.id = p_source_row_id AND r.dataset_id = v_dataset.id
  ) THEN
    RAISE EXCEPTION 'source measurement row not found in Dataset'
      USING ERRCODE = '22023';
  END IF;
  IF p_source_field_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.dataset_schema_version_fields f
    WHERE f.schema_version_id = v_dataset.schema_version_id
      AND f.field_id = p_source_field_id AND f.lifecycle = 'active'
  ) THEN
    RAISE EXCEPTION 'source measurement field not found in Dataset schema'
      USING ERRCODE = '22023';
  END IF;

  -- Existing lineage model: an outgoing 'sample' link from the source sample.
  -- Metadata identifies the exact measurement + schedule this repeat answers.
  v_metadata := jsonb_build_object(
    'origin', 'request_repeat',
    'sourceDatasetId', v_dataset.id,
    'sourceRowId', p_source_row_id,
    'sourceFieldId', p_source_field_id,
    'scheduledAt', p_scheduled_at
  );

  IF EXISTS (
    SELECT 1 FROM api.record_links l
    WHERE l.source_record_id = v_source.id
      AND l.link_type = 'sample'
      AND l.link_metadata->>'origin' = 'request_repeat'
      AND l.link_metadata->>'sourceDatasetId' = v_dataset.id::text
      AND l.link_metadata->>'sourceRowId'
        IS NOT DISTINCT FROM p_source_row_id::text
      AND l.link_metadata->>'sourceFieldId'
        IS NOT DISTINCT FROM p_source_field_id::text
      AND (l.link_metadata->>'scheduledAt')::timestamptz
        IS NOT DISTINCT FROM p_scheduled_at
  ) THEN
    RAISE EXCEPTION 'a repeat has already been requested for this measurement and schedule'
      USING ERRCODE = 'SB075';
  END IF;

  v_project := coalesce(v_source.project_id, v_dataset.primary_project_id);
  v_identifier := api.next_record_identifier(v_workspace, 'sample');
  v_title := nullif(btrim(coalesce(p_title, '')), '');
  IF v_title IS NULL THEN
    v_title := coalesce(v_source.title, v_source.identifier) || ' repeat';
  END IF;

  -- Derived dilution sample: the canonical sample row. `properties` carries the
  -- caller's quantity/unit/location (validated by the existing sample property
  -- guard); provenance lives on the lineage link instead.
  INSERT INTO api.records
    (workspace_id, project_id, kind, identifier, title, status, properties,
     created_by_user_id)
  VALUES
    (v_workspace, v_project, 'sample', v_identifier, v_title, 'available',
     coalesce(p_properties, '{}'::jsonb), api.current_user_id())
  RETURNING * INTO v_sample;

  INSERT INTO api.sample_events
    (workspace_id, record_id, operation, actor_user_id, notes)
  VALUES
    (v_workspace, v_sample.id, 'create', api.current_user_id(),
     'Repeat requested from ' || v_source.identifier);

  INSERT INTO api.record_links
    (source_record_id, target_record_id, target_kind, target_identifier,
     link_type, link_metadata, created_by_user_id)
  VALUES
    (v_source.id, v_sample.id, 'sample', v_sample.identifier, 'sample',
     v_metadata, api.current_user_id());

  -- Planned rows reuse the canonical planned-row RPC (status 'planned',
  -- scheduled time, no values). Any failure rolls the whole repeat back.
  FOR i IN 1..p_planned_row_count LOOP
    SELECT * INTO v_row FROM api.plan_dataset_row(v_dataset.id, p_scheduled_at);
    v_row_ids := array_append(v_row_ids, v_row.id);
  END LOOP;

  RETURN jsonb_build_object(
    'sample', to_jsonb(v_sample),
    'plannedRowIds', to_jsonb(v_row_ids),
    'idempotent', false
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.request_repeat(uuid, uuid, timestamptz, integer, uuid, uuid, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.request_repeat(uuid, uuid, timestamptz, integer, uuid, uuid, text, jsonb) TO authenticated;
--> statement-breakpoint
COMMENT ON FUNCTION api.request_repeat(uuid, uuid, timestamptz, integer, uuid, uuid, text, jsonb) IS
  'DSET-01.4: atomic request repeat — derive a dilution sample (LAB-01) and plan Dataset rows (DSET-01.3), linked to the source measurement.';
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
