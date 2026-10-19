-- LINK-01 — importing into, or withdrawing for, an experiment links it.
--
-- `commit_dataset_import` stored the experiment only on the import receipt
-- (`dataset_imports.experiment_record_id`) and `withdraw_sample` only on the
-- sample event (`sample_events.purpose_record_id`). Everything that shows an
-- experiment's data reads `record_links`: its Datasets, Samples and Results tabs,
-- Overview "Key results", and the dataset list's Experiment column
-- (`target_kind`/`link_type` = 'dataset' on `display_id`, drizzle/0431). So the
-- work was recorded and the experiment never showed it.
--
-- Both functions are patched from their current definitions, so nothing else in
-- them changes. Each now also writes the experiment's link. This migration is
-- additive: it writes no row for past imports or withdrawals. Backfilling those
-- touches regulated history and is a separate, audited, reversible migration.
--
-- An experiment that is already locked is left alone: its record is signed
-- evidence and a link cannot be added to it. The receipt or sample event still
-- carries the experiment.

DO $$ DECLARE definition text; anchor text; patch text;
BEGIN
  SELECT pg_get_functiondef(
    'api.commit_dataset_import(uuid, bigint, jsonb, text, uuid, jsonb, jsonb, uuid, uuid, uuid, uuid, uuid, jsonb)'::regprocedure
  ) INTO definition;

  anchor := E'  IF f.id IS NOT NULL THEN\n    UPDATE api.dataset_import_files';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'commit_dataset_import anchor missing; refusing to patch blindly';
  END IF;
  IF strpos(definition, 'LINK-01') > 0 THEN
    RETURN;  -- already patched
  END IF;

  patch := E'  -- LINK-01: the experiment reads its data through record_links.\n'
    || E'  IF p_experiment_record_id IS NOT NULL AND d.display_id IS NOT NULL THEN\n'
    || E'    INSERT INTO api.record_links\n'
    || E'      (source_record_id, target_kind, target_identifier, link_type, link_metadata, created_by_user_id)\n'
    || E'    SELECT x.id, ''dataset'', d.display_id, ''dataset'',\n'
    || E'           jsonb_build_object(''origin'', ''commit_dataset_import'', ''importId'', receipt.id),\n'
    || E'           api.current_user_id()\n'
    || E'      FROM api.records x\n'
    || E'     WHERE x.id = p_experiment_record_id AND x.kind = ''experiment'' AND x.locked_at IS NULL\n'
    || E'    ON CONFLICT (source_record_id, target_identifier, link_type) DO NOTHING;\n'
    || E'  END IF;\n';

  EXECUTE replace(definition, anchor, patch || anchor);
END $$;
--> statement-breakpoint

DO $$ DECLARE definition text; anchor text; patch text;
BEGIN
  SELECT pg_get_functiondef(
    'api.withdraw_sample(uuid, numeric, integer, uuid, text, text, jsonb)'::regprocedure
  ) INTO definition;

  anchor := E'  IF p_new_container IS NULL OR p_new_container = ''null''::jsonb THEN';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'withdraw_sample anchor missing; refusing to patch blindly';
  END IF;
  IF strpos(definition, 'LINK-01') > 0 THEN
    RETURN;  -- already patched
  END IF;

  patch := E'  -- LINK-01: the experiment reads the samples it used through record_links.\n'
    || E'  IF v_purpose.locked_at IS NULL THEN\n'
    || E'    INSERT INTO api.record_links\n'
    || E'      (source_record_id, target_record_id, target_kind, target_identifier, link_type,\n'
    || E'       link_metadata, created_by_user_id)\n'
    || E'    VALUES (v_purpose.id, v_source.id, ''sample'', v_source.identifier, ''sample'',\n'
    || E'            jsonb_build_object(''origin'', ''withdraw_sample'', ''quantity'', p_quantity),\n'
    || E'            api.current_user_id())\n'
    || E'    ON CONFLICT (source_record_id, target_identifier, link_type) DO NOTHING;\n'
    || E'  END IF;\n\n';

  EXECUTE replace(definition, anchor, patch || anchor);
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
