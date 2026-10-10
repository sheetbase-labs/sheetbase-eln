-- SHEET-02.2 — applying a promotion on a Sheet that has no dataset composition.
--
-- The owner decided this case should create a new dataset. api.materialize_sheet_instance
-- cannot do it: it sources a snapshot from the Sheet's dataset bindings and refuses a Sheet
-- with none ("materialization requires Dataset composition sources"). So the applied path had
-- nothing to run for a local-only Sheet and the promotion could never be applied.
--
-- The branch below does what materialization does, minus the composition: it creates the
-- dataset from the promotion's draft schema version, writes the Sheet's own local values as
-- its rows, and snapshots the result. It reuses the same canonical helpers in the same order -
-- api.commit_dataset_row_batch then api.snapshot_dataset - so the row write and the version are
-- the proven ones, not a second implementation of them.
--
-- The retire of the local column that follows is shared by both paths: whichever way the
-- values got into a dataset, the column stops being local.

DO $$
DECLARE
  def text;
  marker text := '  v_preview := api.preview_sheet_materialization(';
  branch text;
BEGIN
  def := pg_get_functiondef('api.apply_column_promotion(uuid,uuid)'::regprocedure);
  IF position('local-only' in def) > 0 THEN RETURN; END IF;
  IF position(marker in def) = 0 THEN
    RAISE EXCEPTION 'apply patch marker not found';
  END IF;

  branch := E'  -- SHEET-02.2: a Sheet with no dataset composition cannot be materialized, so its\n'
    || E'  -- own local values become a new dataset instead.\n'
    || E'  IF jsonb_array_length(coalesce(v_instance.state->''bindings'',''[]''::jsonb)) = 0 THEN\n'
    || E'    INSERT INTO api.datasets(workspace_id, schema_version_id, name, created_by_user_id)\n'
    || E'    VALUES (v_instance.workspace_id, v_promotion.schema_version_id,\n'
    || E'            btrim(coalesce(v_instance.name,''Promoted column'')), api.current_user_id())\n'
    || E'    RETURNING * INTO v_output;\n'
    || E'\n'
    || E'    SELECT coalesce(jsonb_agg(jsonb_build_object(\n'
    || E'             ''operation'',''create'',\n'
    || E'             ''rowId'',gen_random_uuid(),\n'
    || E'             ''values'',jsonb_build_object(v_promotion.field_id::text, cell.value)\n'
    || E'           )), ''[]''::jsonb) INTO v_rows\n'
    || E'      FROM jsonb_each(coalesce(v_instance.state->''localValues'',''{}''::jsonb)) row_item,\n'
    || E'           LATERAL jsonb_each(row_item.value) cell\n'
    || E'     WHERE cell.key = v_promotion.field_id::text;\n'
    || E'\n'
    || E'    IF jsonb_array_length(v_rows) > 0 THEN\n'
    || E'      SELECT api.commit_dataset_row_batch(\n'
    || E'        v_output.id, v_output.revision, v_rows,\n'
    || E'        ''column-promotion:'' || p_promotion_id::text\n'
    || E'      ) INTO v_batch;\n'
    || E'      IF (v_batch->>''ok'')::boolean IS NOT TRUE THEN\n'
    || E'        RAISE EXCEPTION ''the promoted values failed Dataset validation: %'', v_batch\n'
    || E'          USING ERRCODE = ''SB089'';\n'
    || E'      END IF;\n'
    || E'    END IF;\n'
    || E'\n'
    || E'    SELECT * INTO v_snapshot FROM api.snapshot_dataset(\n'
    || E'      v_output.id, (SELECT revision FROM api.datasets WHERE id = v_output.id),\n'
    || E'      ''Column promotion output''\n'
    || E'    );\n'
    || E'    v_materialized := jsonb_build_object(\n'
    || E'      ''datasetId'',v_output.id,''datasetVersionId'',v_snapshot.id\n'
    || E'    );\n'
    || E'  ELSE\n'
    || E'  v_preview := api.preview_sheet_materialization(';

  def := replace(def, marker, branch);

  -- ...and the IF the branch opens has to be closed after the materialization it guards.
  def := replace(def,
    E'    p_idempotency_key\n  );\n\n  -- The values now live in the dataset',
    E'    p_idempotency_key\n  );\n  END IF;\n\n  -- The values now live in the dataset');

  -- The branch needs variables the function did not declare.
  def := replace(def,
    E'  v_materialized jsonb;\n',
    E'  v_materialized jsonb;\n'
    || E'  v_output api.datasets;\n'
    || E'  v_snapshot api.dataset_versions;\n'
    || E'  v_batch jsonb;\n'
    || E'  v_rows jsonb;\n');

  EXECUTE def;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
