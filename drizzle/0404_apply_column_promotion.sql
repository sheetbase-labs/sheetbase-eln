-- SHEET-02.2 — settling a promotion: applying it, or recording a return.
--
-- SHEET-02.1 makes a promotion a *request*: a draft Dataset Schema Version held against
-- an MDL-03 approval, with nothing written to the dataset. This is what happens when the
-- approval is decided.
--
-- Approved: the sheet's values are written as a new snapshot and the local column is
-- retired, so the column is now dataset-backed. Both in one transaction, so a sheet
-- cannot end up with its values in a dataset while its column is still local.
--
-- Returned: nothing moves. The reason the approver gave is recorded on the promotion and
-- the columns stay local, which is the point of a return.
--
-- It adds no new writing path: the snapshot goes through the canonical
-- api.materialize_sheet_instance and the column switch through the canonical
-- api.mutate_sheet_instance_local_state.

CREATE OR REPLACE FUNCTION api.apply_column_promotion(
  p_promotion_id uuid,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_promotion api.column_promotions;
  v_approval api.approval_requests;
  v_instance api.sheet_instances;
  v_preview jsonb;
  v_materialized jsonb;
  v_result jsonb;
BEGIN
  SELECT * INTO v_promotion FROM api.column_promotions WHERE id = p_promotion_id FOR UPDATE;
  IF v_promotion.id IS NULL
     OR v_promotion.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'Unknown promotion' USING ERRCODE = '22023';
  END IF;
  IF v_promotion.state <> 'pending' THEN
    RAISE EXCEPTION 'This promotion is already settled' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_instance FROM api.sheet_instances WHERE id = v_promotion.sheet_instance_id FOR UPDATE;
  PERFORM internal.assert_object_access('instance', v_promotion.sheet_instance_id, 'edit');
  PERFORM api.require_capability(v_promotion.workspace_id, 'schema.edit');

  SELECT * INTO v_approval FROM api.approval_requests WHERE id = v_promotion.approval_request_id;
  IF v_approval.id IS NULL OR v_approval.state = 'pending' THEN
    RAISE EXCEPTION 'This promotion has not been decided' USING ERRCODE = 'SB086';
  END IF;

  IF v_approval.state <> 'approved' THEN
    -- Returned or withdrawn: the reason is recorded and nothing moves.
    UPDATE api.column_promotions
       SET state = CASE WHEN v_approval.state = 'withdrawn' THEN 'withdrawn' ELSE 'returned' END,
           decided_at = now(),
           reason = coalesce(nullif(btrim(coalesce(v_approval.decision_reason, '')), ''), reason),
           updated_at = now()
     WHERE id = v_promotion.id
    RETURNING * INTO v_promotion;
    RETURN jsonb_build_object(
      'ok', true,
      'state', v_promotion.state,
      'applied', false,
      'reason', v_promotion.reason
    );
  END IF;

  IF v_promotion.target <> 'dataset_schema' OR v_promotion.schema_version_id IS NULL THEN
    RAISE EXCEPTION 'Only a Dataset Schema promotion can be applied' USING ERRCODE = '22023';
  END IF;

  -- The preview and its digest are the canonical materialization contract; passing the
  -- digest is what stops a stale preview from writing a snapshot of data that moved.
  v_preview := api.preview_sheet_materialization(
    v_promotion.sheet_instance_id, v_instance.revision, v_promotion.schema_version_id
  );
  v_materialized := api.materialize_sheet_instance(
    v_promotion.sheet_instance_id,
    v_instance.revision,
    coalesce(v_instance.name, 'Promoted column'),
    v_promotion.schema_version_id,
    v_preview->>'previewDigest',
    p_idempotency_key
  );

  -- The values now live in the dataset, so the column stops being local. Retiring it is
  -- the switch; the materialization above did not change the instance revision.
  PERFORM api.mutate_sheet_instance_local_state(
    v_promotion.sheet_instance_id,
    v_instance.revision,
    p_idempotency_key,
    jsonb_build_array(jsonb_build_object(
      'operation', 'retire',
      'fieldId', v_promotion.field_id
    )),
    '[]'::jsonb,
    '[]'::jsonb
  );

  UPDATE api.column_promotions
     SET state = 'applied', decided_at = now(), updated_at = now()
   WHERE id = v_promotion.id;

  v_result := jsonb_build_object(
    'ok', true,
    'state', 'applied',
    'applied', true,
    'datasetId', v_materialized->>'datasetId',
    'datasetVersionId', v_materialized->>'datasetVersionId'
  );
  RETURN v_result;
END $function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.apply_column_promotion(uuid, uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.apply_column_promotion(uuid, uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
