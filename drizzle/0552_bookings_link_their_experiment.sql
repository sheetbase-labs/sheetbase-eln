-- LINK-03 — a booking is a link on its experiment.
--
-- A booking names its experiment on the booking row alone
-- (`calendar_bookings.linked_experiment_record_id`). Everything that shows what
-- an experiment is connected to reads `record_links`, so a booked instrument
-- never appeared in the experiment's related work. This writes the link:
-- experiment -> booking, `link_type = 'booking'`, addressed by the booking's
-- display id (CAL-0913), with the booking id, instrument resource and time in
-- `link_metadata`.
--
-- The link follows the booking:
--   * booking inserted or its experiment set      -> link written
--   * booking moved to a different experiment     -> old link removed, new one written
--   * booking cancelled, experiment cleared or booking deleted -> link removed
--   * booking rescheduled or retitled             -> link metadata refreshed
--
-- Rules shared with 0437/0530:
--   * A locked experiment is left alone: its record is signed evidence, so a
--     link is neither added nor removed there. The booking row still carries it.
--   * `ON CONFLICT DO NOTHING`: one link per booking however often it is edited.
--   * A booking must not fail because of a link. When the workspace's model
--     relationship rules forbid the link (SB080/SB081) the booking is kept and a
--     WARNING is raised; the booking row still names its experiment.
--
-- Additive: past bookings are backfilled below under the 0531 discipline (only
-- inserts, live bookings only, locked experiments skipped, a tag on every row
-- for reversal).

ALTER TABLE api.record_links DROP CONSTRAINT chk_record_links_link_type;
--> statement-breakpoint
ALTER TABLE api.record_links ADD CONSTRAINT chk_record_links_link_type
  CHECK (link_type IN (
    'sample', 'protocol', 'dataset', 'material', 'analysis', 'file', 'general',
    'template', 'follows', 'upstream', 'booking'
  ));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.sync_booking_record_link()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_experiment api.records;
  v_identifier text;
  v_actor text;
  v_live boolean;
BEGIN
  -- Remove the link this booking held on the experiment it no longer names.
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.linked_experiment_record_id IS NOT NULL
     AND (TG_OP = 'DELETE'
          OR OLD.linked_experiment_record_id IS DISTINCT FROM NEW.linked_experiment_record_id
          OR (OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL)) THEN
    DELETE FROM api.record_links l
     USING api.records x
     WHERE x.id = OLD.linked_experiment_record_id
       AND x.locked_at IS NULL
       AND l.source_record_id = x.id
       AND l.link_type = 'booking'
       AND l.link_metadata ->> 'bookingId' = OLD.id::text;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  v_live := NEW.cancelled_at IS NULL AND NEW.linked_experiment_record_id IS NOT NULL;
  IF NOT v_live THEN RETURN NEW; END IF;

  SELECT * INTO v_experiment FROM api.records
   WHERE id = NEW.linked_experiment_record_id
     AND kind = 'experiment' AND deleted_at IS NULL
     AND workspace_id = NEW.workspace_id;
  IF v_experiment.id IS NULL OR v_experiment.locked_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_identifier := coalesce(NEW.display_id, NEW.id::text);
  v_actor := coalesce(NEW.updated_by_user_id, NEW.created_by_user_id, api.current_user_id());
  IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM internal."user" u WHERE u.id = v_actor) THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO api.record_links
      (source_record_id, target_record_id, target_kind, target_identifier, link_type,
       link_metadata, created_by_user_id)
    VALUES (v_experiment.id, NULL, 'booking', v_identifier, 'booking',
            jsonb_build_object('origin', 'calendar_bookings', 'bookingId', NEW.id,
                               'resourceId', NEW.resource_id, 'title', NEW.title,
                               'startsAt', NEW.starts_at, 'endsAt', NEW.ends_at),
            v_actor)
    ON CONFLICT (source_record_id, target_identifier, link_type)
    DO UPDATE SET link_metadata = EXCLUDED.link_metadata;
  EXCEPTION WHEN SQLSTATE 'SB080' OR SQLSTATE 'SB081' THEN
    RAISE WARNING 'booking % not linked to experiment %: %', v_identifier, v_experiment.identifier, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.sync_booking_record_link() FROM PUBLIC;
--> statement-breakpoint

DROP TRIGGER IF EXISTS sync_booking_record_link ON api.calendar_bookings;
--> statement-breakpoint
CREATE TRIGGER sync_booking_record_link
  AFTER INSERT OR DELETE OR UPDATE OF linked_experiment_record_id, cancelled_at, title, starts_at, ends_at
  ON api.calendar_bookings
  FOR EACH ROW EXECUTE FUNCTION internal.sync_booking_record_link();
--> statement-breakpoint

-- Backfill: past live bookings that name an experiment. A tagged, additive,
-- audited insert; undo with
--   DELETE FROM api.record_links WHERE link_metadata ->> 'backfill' = '0552_bookings_link_their_experiment';
DO $$
DECLARE
  tag constant text := '0552_bookings_link_their_experiment';
  r record;
  v_link uuid;
  v_linked int := 0;
  v_forbidden int := 0;
BEGIN
  FOR r IN
    SELECT b.id, b.display_id, b.resource_id, b.title, b.starts_at, b.workspace_id,
           x.project_id,
           b.linked_experiment_record_id AS experiment_id,
           coalesce(b.updated_by_user_id, b.created_by_user_id) AS actor
      FROM api.calendar_bookings b
      JOIN api.records x ON x.id = b.linked_experiment_record_id
                        AND x.kind = 'experiment' AND x.deleted_at IS NULL
                        AND x.locked_at IS NULL AND x.workspace_id = b.workspace_id
     WHERE b.cancelled_at IS NULL
       AND coalesce(b.updated_by_user_id, b.created_by_user_id) IS NOT NULL
       AND EXISTS (SELECT 1 FROM internal."user" u
                    WHERE u.id = coalesce(b.updated_by_user_id, b.created_by_user_id))
     ORDER BY b.created_at, b.id
  LOOP
    BEGIN
      INSERT INTO api.record_links
        (source_record_id, target_record_id, target_kind, target_identifier, link_type,
         link_metadata, created_by_user_id)
      VALUES (r.experiment_id, NULL, 'booking', coalesce(r.display_id, r.id::text), 'booking',
              jsonb_build_object('origin', 'calendar_bookings', 'bookingId', r.id,
                                 'resourceId', r.resource_id, 'title', r.title,
                                 'startsAt', r.starts_at, 'backfill', tag),
              r.actor)
      ON CONFLICT (source_record_id, target_identifier, link_type) DO NOTHING
      RETURNING id INTO v_link;
    EXCEPTION WHEN SQLSTATE 'SB080' OR SQLSTATE 'SB081' THEN
      v_forbidden := v_forbidden + 1;
      RAISE WARNING '% skipped: booking % -> experiment %: %', tag, r.id, r.experiment_id, SQLERRM;
      CONTINUE;
    END;
    IF v_link IS NULL THEN CONTINUE; END IF;
    -- Migrations carry no request identity, so the record_links trigger emits
    -- no change event: write the audit event explicitly, as the 0531 backfill does.
    PERFORM internal.emit_change_event_as_actor(
      r.actor, r.workspace_id, 'record_link', v_link, 'link', r.experiment_id, r.project_id,
      jsonb_build_object('linkId', v_link, 'targetKind', 'booking',
        'targetIdentifier', coalesce(r.display_id, r.id::text), 'linkType', 'booking',
        'backfill', tag, 'bookingId', r.id));
    v_linked := v_linked + 1;
    v_link := NULL;
  END LOOP;
  RAISE NOTICE '0552: linked % booking(s); % skipped by model relationship rules', v_linked, v_forbidden;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
