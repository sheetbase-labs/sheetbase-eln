-- LINK-02 backfill — link past sample reservations to the experiments they were
-- made for.
--
-- 0530 makes `create_sample_reservation` write the experiment -> sample
-- `record_links` row from now on. Reservations made before it recorded the
-- experiment only on `sample_reservations.experiment_record_id`, so those
-- experiments still show no Samples. This migration writes the links they would
-- have got. Same discipline as 0438, because it touches regulated history:
--
--   ADDITIVE   Only inserts. `ON CONFLICT DO NOTHING` means a link someone made
--              by hand, or one 0438 / 0437 already wrote, is never replaced or
--              edited, and re-running adds nothing.
--   LIVE ONLY  Active and fulfilled reservations link; a cancelled reservation
--              never held the sample for the experiment, so it is skipped.
--   LOCKED     An experiment with `locked_at` set is skipped: its record is
--              signed evidence and a link cannot be added to it.
--   AUDITED    Migrations carry no request identity, so the `record_links`
--              trigger emits no change event here. Each link gets an explicit
--              `record_link` / `link` change event (hash-chained like any other)
--              attributed to the person who made the reservation, with
--              `backfill` in its payload.
--   REVERSIBLE Every row carries `link_metadata.backfill = '0531_backfill_reservation_links'`
--              and the id of the reservation it came from. To undo:
--                DELETE FROM api.record_links
--                 WHERE link_metadata ->> 'backfill' = '0531_backfill_reservation_links';
--              (run with a request identity so the unlinks are audited too).
--
-- Rows are skipped, never guessed, when the original actor no longer exists
-- (the audit event needs a real user), when the experiment or sample is deleted,
-- or when the model's relationship rules forbid the link (SB080/SB081). A
-- forbidden link must not abort the migration run, so it is reported as a
-- WARNING and counted.

DO $$
DECLARE
  tag constant text := '0531_backfill_reservation_links';
  r record;
  v_link uuid;
  v_linked int := 0;
  v_existing int := 0;
  v_locked int := 0;
  v_no_actor int := 0;
  v_forbidden int := 0;
BEGIN
  -- One link per (experiment, sample), however many reservations there were; the
  -- first reservation is the one cited and the quantity is the total held.
  FOR r IN
    SELECT v.experiment_record_id AS experiment_id, v.sample_record_id AS sample_id,
           s.identifier AS sample_identifier, x.workspace_id, x.project_id, x.locked_at,
           (array_agg(v.id ORDER BY v.created_at, v.id))[1] AS first_reservation_id,
           (array_agg(v.created_by_user_id ORDER BY v.created_at, v.id))[1] AS actor,
           min(v.created_at) AS first_at,
           sum(v.quantity) AS quantity
      FROM api.sample_reservations v
      JOIN api.records s ON s.id = v.sample_record_id AND s.kind = 'sample' AND s.deleted_at IS NULL
      JOIN api.records x ON x.id = v.experiment_record_id AND x.kind = 'experiment'
                        AND x.deleted_at IS NULL AND x.workspace_id = s.workspace_id
     WHERE v.state IN ('active', 'fulfilled')
     GROUP BY v.experiment_record_id, v.sample_record_id, s.identifier,
              x.workspace_id, x.project_id, x.locked_at
     ORDER BY min(v.created_at), v.experiment_record_id, v.sample_record_id
  LOOP
    IF r.locked_at IS NOT NULL THEN v_locked := v_locked + 1; CONTINUE; END IF;
    IF r.actor IS NULL OR NOT EXISTS (SELECT 1 FROM internal."user" u WHERE u.id = r.actor) THEN
      v_no_actor := v_no_actor + 1; CONTINUE;
    END IF;
    BEGIN
      INSERT INTO api.record_links
        (source_record_id, target_record_id, target_kind, target_identifier, link_type,
         link_metadata, created_by_user_id)
      VALUES (r.experiment_id, r.sample_id, 'sample', r.sample_identifier, 'sample',
              jsonb_build_object('origin', 'create_sample_reservation', 'backfill', tag,
                                 'reservationId', r.first_reservation_id,
                                 'reservedAt', r.first_at, 'quantity', r.quantity),
              r.actor)
      ON CONFLICT (source_record_id, target_identifier, link_type) DO NOTHING
      RETURNING id INTO v_link;
    EXCEPTION WHEN SQLSTATE 'SB080' OR SQLSTATE 'SB081' THEN
      v_forbidden := v_forbidden + 1;
      RAISE WARNING '% skipped: sample % -> experiment %: %', tag, r.sample_identifier, r.experiment_id, SQLERRM;
      CONTINUE;
    END;
    IF v_link IS NULL THEN v_existing := v_existing + 1; CONTINUE; END IF;
    PERFORM internal.emit_change_event_as_actor(
      r.actor, r.workspace_id, 'record_link', v_link, 'link', r.experiment_id, r.project_id,
      jsonb_build_object('linkId', v_link, 'targetKind', 'sample',
        'targetIdentifier', r.sample_identifier, 'linkType', 'sample',
        'backfill', tag, 'reservationId', r.first_reservation_id));
    v_linked := v_linked + 1;
    v_link := NULL;
  END LOOP;

  RAISE NOTICE '% linked % sample(s); already linked %, locked experiment %, no original actor %, forbidden by rules %',
    tag, v_linked, v_existing, v_locked, v_no_actor, v_forbidden;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
