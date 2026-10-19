-- LINK-02 — reserving a sample for an experiment links it.
--
-- `create_sample_reservation` stored the experiment only on the reservation row
-- (`sample_reservations.experiment_record_id`). Everything that shows an
-- experiment's samples reads `record_links` (its Samples tab, Overview and
-- Results), so a sample reserved for an experiment never appeared there. 0437
-- and 0439 closed the same gap for withdrawing and consuming; this closes it for
-- reserving.
--
-- The function is patched from its current definition, so nothing else in it
-- changes. It now also writes the experiment -> sample link, with
-- `ON CONFLICT DO NOTHING`: the link is one row however many times the sample is
-- reserved, withdrawn or consumed for that experiment, whichever came first.
--
-- Same rules as 0437: a locked experiment is left alone (its record is signed
-- evidence; the reservation row still carries the experiment), and when a
-- model's relationship rules forbid the link the reservation fails with that
-- rule's message prefixed with what could not be linked. A link that silently
-- goes missing is worse in a regulated record.
--
-- Additive: this writes no row for past reservations. 0531 backfills those.

DO $$ DECLARE definition text; anchor text; patch text;
BEGIN
  SELECT pg_get_functiondef(
    'api.create_sample_reservation(uuid, uuid, numeric, text, boolean, text)'::regprocedure
  ) INTO definition;

  anchor := E'  RETURN v_reservation;\nEND;';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'create_sample_reservation anchor missing; refusing to patch blindly';
  END IF;
  IF strpos(definition, 'LINK-02') > 0 THEN
    RETURN;  -- already patched
  END IF;

  patch := E'  -- LINK-02: the experiment reads the samples it holds through record_links.\n'
    || E'  IF v_experiment.locked_at IS NULL THEN\n'
    || E'    BEGIN\n'
    || E'      INSERT INTO api.record_links\n'
    || E'        (source_record_id, target_record_id, target_kind, target_identifier, link_type,\n'
    || E'         link_metadata, created_by_user_id)\n'
    || E'      VALUES (v_experiment.id, v_sample.id, ''sample'', v_sample.identifier, ''sample'',\n'
    || E'              jsonb_build_object(''origin'', ''create_sample_reservation'',\n'
    || E'                                 ''reservationId'', v_reservation.id, ''quantity'', p_quantity),\n'
    || E'              api.current_user_id())\n'
    || E'      ON CONFLICT (source_record_id, target_identifier, link_type) DO NOTHING;\n'
    || E'    EXCEPTION WHEN SQLSTATE ''SB080'' OR SQLSTATE ''SB081'' THEN\n'
    || E'      RAISE EXCEPTION ''cannot link sample % to the experiment: %'', v_sample.identifier, SQLERRM\n'
    || E'        USING ERRCODE = SQLSTATE;\n'
    || E'    END;\n'
    || E'  END IF;\n\n';

  EXECUTE replace(definition, anchor, patch || anchor);
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
