-- LINK-01 backfill — link past dataset imports and sample withdrawals to the
-- experiments they were made for.
--
-- 0437 makes `commit_dataset_import` and `withdraw_sample` write the experiment's
-- `record_links` row from now on. Imports and withdrawals made before it recorded
-- the experiment only on the receipt (`dataset_imports.experiment_record_id`) or
-- the event (`sample_events.purpose_record_id`), so those experiments still show
-- no Datasets, Samples or Results. This migration writes the links they would
-- have got.
--
-- This touches regulated history, so it is deliberately conservative:
--
--   ADDITIVE   Only inserts. `ON CONFLICT DO NOTHING` means a link someone made by
--              hand is never replaced or edited, and re-running adds nothing.
--   LOCKED     An experiment with `locked_at` set is skipped: its record is signed
--              evidence and a link cannot be added to it.
--   AUDITED    Migrations carry no request identity, so the `record_links` trigger
--              emits no change event here. Each link instead gets an explicit
--              `record_link` / `link` change event (hash-chained like any other)
--              attributed to the person who made the original import or
--              withdrawal, with `backfill` in its payload.
--   REVERSIBLE Every row carries `link_metadata.backfill = '0438_backfill_record_links'`
--              and the id of the receipt or event it came from. To undo:
--                DELETE FROM api.record_links
--                 WHERE link_metadata ->> 'backfill' = '0438_backfill_record_links';
--              (run with a request identity so the unlinks are audited too).
--
-- Rows are skipped, never guessed, when the original actor no longer exists
-- (`created_by_user_id` is NOT NULL and the audit event needs a real user), when
-- the experiment or dataset is deleted, or when the model's relationship rules
-- forbid the link (SB080/SB081). A forbidden link must not abort the whole
-- migration run, so it is reported as a WARNING instead; the same rows can be
-- listed at any time:
--   imports:     dataset_imports (status 'committed') with an experiment and no
--                experiment -> dataset link;
--   withdrawals: 'consume' sample_events with a purpose and no
--                experiment -> sample link.
--
-- Citations are not backfilled: before 0437 nothing recorded an analysis
-- citation as a link, and Cite still fails before inserting the notebook block
-- (ANA-05), so there is no past citation to reconstruct.

DO $$
DECLARE
  tag constant text := '0438_backfill_record_links';
  r record;
  v_link uuid;
  v_linked_imports int := 0;
  v_linked_samples int := 0;
  v_existing int := 0;
  v_locked int := 0;
  v_no_actor int := 0;
  v_forbidden int := 0;
BEGIN
  -- Dataset imports, oldest first so any per-experiment maximum fills in the
  -- order it was originally reached.
  FOR r IN
    SELECT i.id AS import_id, i.created_at AS made_at, i.created_by_user_id AS actor,
           x.id AS experiment_id, x.workspace_id, x.project_id, x.locked_at,
           d.display_id AS dataset_display_id, d.id AS dataset_id
      FROM api.dataset_imports i
      JOIN api.datasets d ON d.id = i.dataset_id AND d.display_id IS NOT NULL
      JOIN api.records x ON x.id = i.experiment_record_id AND x.kind = 'experiment'
                        AND x.deleted_at IS NULL AND x.workspace_id = d.workspace_id
     WHERE i.status = 'committed'
     ORDER BY i.created_at, i.id
  LOOP
    IF r.locked_at IS NOT NULL THEN v_locked := v_locked + 1; CONTINUE; END IF;
    IF r.actor IS NULL OR NOT EXISTS (SELECT 1 FROM internal."user" u WHERE u.id = r.actor) THEN
      v_no_actor := v_no_actor + 1; CONTINUE;
    END IF;
    BEGIN
      INSERT INTO api.record_links
        (source_record_id, target_kind, target_identifier, link_type, link_metadata, created_by_user_id)
      VALUES (r.experiment_id, 'dataset', r.dataset_display_id, 'dataset',
              jsonb_build_object('origin', 'commit_dataset_import', 'backfill', tag,
                                 'importId', r.import_id, 'importedAt', r.made_at),
              r.actor)
      ON CONFLICT (source_record_id, target_identifier, link_type) DO NOTHING
      RETURNING id INTO v_link;
    EXCEPTION WHEN SQLSTATE 'SB080' OR SQLSTATE 'SB081' THEN
      v_forbidden := v_forbidden + 1;
      RAISE WARNING '% skipped: dataset % -> experiment %: %', tag, r.dataset_display_id, r.experiment_id, SQLERRM;
      CONTINUE;
    END;
    IF v_link IS NULL THEN v_existing := v_existing + 1; CONTINUE; END IF;
    PERFORM internal.emit_change_event_as_actor(
      r.actor, r.workspace_id, 'record_link', v_link, 'link', r.experiment_id, r.project_id,
      jsonb_build_object('linkId', v_link, 'targetKind', 'dataset',
        'targetIdentifier', r.dataset_display_id, 'linkType', 'dataset',
        'backfill', tag, 'importId', r.import_id));
    v_linked_imports := v_linked_imports + 1;
    v_link := NULL;
  END LOOP;

  -- Sample withdrawals: one link per (experiment, sample), however many times
  -- that sample was drawn on, as `withdraw_sample` writes it. The first event
  -- is the one cited; the quantity is the total drawn so far.
  FOR r IN
    SELECT e.purpose_record_id AS experiment_id, e.record_id AS sample_id,
           s.identifier AS sample_identifier, x.workspace_id, x.project_id, x.locked_at,
           (array_agg(e.id ORDER BY e.created_at, e.id))[1] AS first_event_id,
           (array_agg(e.actor_user_id ORDER BY e.created_at, e.id))[1] AS actor,
           min(e.created_at) AS first_at,
           sum(-e.quantity_delta) AS quantity
      FROM api.sample_events e
      JOIN api.records s ON s.id = e.record_id AND s.kind = 'sample' AND s.deleted_at IS NULL
      JOIN api.records x ON x.id = e.purpose_record_id AND x.kind = 'experiment'
                        AND x.deleted_at IS NULL AND x.workspace_id = s.workspace_id
     WHERE e.operation = 'consume'
     GROUP BY e.purpose_record_id, e.record_id, s.identifier, x.workspace_id, x.project_id, x.locked_at
     ORDER BY min(e.created_at), e.purpose_record_id, e.record_id
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
              jsonb_build_object('origin', 'withdraw_sample', 'backfill', tag,
                                 'sampleEventId', r.first_event_id, 'withdrawnAt', r.first_at,
                                 'quantity', r.quantity),
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
        'backfill', tag, 'sampleEventId', r.first_event_id));
    v_linked_samples := v_linked_samples + 1;
    v_link := NULL;
  END LOOP;

  RAISE NOTICE '% linked % dataset(s) and % sample(s); already linked %, locked experiment %, no original actor %, forbidden by rules %',
    tag, v_linked_imports, v_linked_samples, v_existing, v_locked, v_no_actor, v_forbidden;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
