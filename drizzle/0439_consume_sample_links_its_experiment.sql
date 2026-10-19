-- LINK-01 — a direct consume that names an experiment links it.
--
-- 0437 made `withdraw_sample` write the experiment -> sample `record_links` row,
-- but `withdraw_sample` is only one caller of `api.consume_sample`. A direct
-- consume that names an experiment (`p_experiment_id` or `p_purpose_record_id`)
-- recorded it only on the sample event, so the experiment's Samples tab still
-- missed it. Past ones are covered by the 0438 backfill.
--
-- The link is written where the event is, in `consume_sample`, so every caller
-- gets it. `withdraw_sample` reaches the same row first or second;
-- `ON CONFLICT DO NOTHING` makes that harmless.
--
-- Same rules as 0437: a locked experiment is left alone, and if a model's
-- relationship rules forbid the link the consume fails with that rule's message
-- prefixed with what could not be linked.
--
-- The function is patched from its current definition, so anything else in it
-- stays.
DO $$ DECLARE definition text; anchor text; patch text;
BEGIN
  SELECT pg_get_functiondef(
    'api.consume_sample(uuid, numeric, integer, text, uuid, uuid)'::regprocedure
  ) INTO definition;

  anchor := E'  RETURN v_row;\nEND;';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'consume_sample anchor missing; refusing to patch blindly';
  END IF;
  IF strpos(definition, 'LINK-01') > 0 THEN
    RETURN;  -- already patched
  END IF;

  patch := E'  -- LINK-01: the experiment reads the samples it used through record_links.\n'
    || E'  IF COALESCE(p_experiment_id, p_purpose_record_id) IS NOT NULL THEN\n'
    || E'    BEGIN\n'
    || E'      INSERT INTO api.record_links\n'
    || E'        (source_record_id, target_record_id, target_kind, target_identifier, link_type,\n'
    || E'         link_metadata, created_by_user_id)\n'
    || E'      SELECT x.id, v_row.id, ''sample'', v_row.identifier, ''sample'',\n'
    || E'             jsonb_build_object(''origin'', ''consume_sample'', ''quantity'', p_quantity),\n'
    || E'             api.current_user_id()\n'
    || E'        FROM api.records x\n'
    || E'       WHERE x.id = COALESCE(p_experiment_id, p_purpose_record_id)\n'
    || E'         AND x.kind = ''experiment'' AND x.locked_at IS NULL\n'
    || E'      ON CONFLICT (source_record_id, target_identifier, link_type) DO NOTHING;\n'
    || E'    EXCEPTION WHEN SQLSTATE ''SB080'' OR SQLSTATE ''SB081'' THEN\n'
    || E'      RAISE EXCEPTION ''cannot link sample % to the experiment: %'', v_row.identifier, SQLERRM\n'
    || E'        USING ERRCODE = SQLSTATE;\n'
    || E'    END;\n'
    || E'  END IF;\n\n';

  EXECUTE replace(definition, anchor, patch || anchor);
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
