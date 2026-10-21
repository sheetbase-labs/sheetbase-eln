-- DATA-23 — a dataset linked from the notebook shows on the experiment's Links tab.
--
-- The `/linked` block stores the dataset it points at in its own payload, but the
-- Links tab, the dataset's "Used by" and the results view read `record_links`, so a
-- dataset linked this way was invisible to all of them. Saving such a block now
-- writes the same `dataset` link the import and the dataset page write (target is
-- the display id, no target record). The block stays the source of truth: a link
-- the registry's relationship rules refuse is skipped rather than failing the save,
-- and removing the block leaves the link, as removing a block never unlinks.
CREATE OR REPLACE FUNCTION internal.link_dataset_block()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_workspace uuid;
  v_display text;
  v_ref text := NEW.payload->>'targetId';
BEGIN
  SELECT workspace_id INTO v_workspace FROM api.records
   WHERE id = NEW.record_id AND deleted_at IS NULL;
  IF v_workspace IS NULL THEN RETURN NEW; END IF;

  BEGIN
    IF v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT display_id INTO v_display FROM api.datasets
       WHERE id = v_ref::uuid AND workspace_id = v_workspace;
    ELSE
      SELECT display_id INTO v_display FROM api.datasets
       WHERE display_id = NEW.payload->>'targetIdentifier' AND workspace_id = v_workspace;
    END IF;
    IF v_display IS NULL THEN RETURN NEW; END IF;

    INSERT INTO api.record_links (source_record_id, target_record_id, target_kind,
                                  target_identifier, link_type, created_by_user_id)
    VALUES (NEW.record_id, NULL, 'dataset', v_display, 'dataset',
            coalesce(api.current_user_id(), NEW.updated_by_user_id, NEW.created_by_user_id))
    ON CONFLICT (source_record_id, target_identifier, link_type) DO NOTHING;
  EXCEPTION WHEN SQLSTATE 'SB080' OR SQLSTATE 'SB081' THEN
    NULL;
  END;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.link_dataset_block() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER link_dataset_block
  AFTER INSERT OR UPDATE OF payload ON api.blocks
  FOR EACH ROW WHEN (NEW.type = 'linked_record' AND NEW.payload->>'targetKind' = 'dataset')
  EXECUTE FUNCTION internal.link_dataset_block();
--> statement-breakpoint

-- Blocks written before the trigger existed. Same rules, one savepoint per block.
DO $$
DECLARE b record;
BEGIN
  FOR b IN
    SELECT bl.record_id, d.display_id,
           coalesce(bl.updated_by_user_id, bl.created_by_user_id) AS actor
      FROM api.blocks bl
      JOIN api.records r ON r.id = bl.record_id AND r.deleted_at IS NULL
      JOIN api.datasets d ON d.workspace_id = r.workspace_id AND d.display_id IS NOT NULL
       AND (CASE WHEN bl.payload->>'targetId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 THEN d.id = (bl.payload->>'targetId')::uuid
                 ELSE d.display_id = bl.payload->>'targetIdentifier' END)
     WHERE bl.type = 'linked_record' AND bl.payload->>'targetKind' = 'dataset'
  LOOP
    BEGIN
      INSERT INTO api.record_links (source_record_id, target_record_id, target_kind,
                                    target_identifier, link_type, created_by_user_id)
      VALUES (b.record_id, NULL, 'dataset', b.display_id, 'dataset', b.actor)
      ON CONFLICT (source_record_id, target_identifier, link_type) DO NOTHING;
    EXCEPTION WHEN SQLSTATE 'SB080' OR SQLSTATE 'SB081' THEN
      NULL;
    END;
  END LOOP;
END $$;
