-- The sequence block now comes from the Sequence tools plugin (plugin key
-- `sequence-tools`, block `sequence`). Every existing sequence block becomes a
-- plugin block that keeps its old payload, untouched, as the plugin block's
-- state, so nothing a scientist saved is lost or reshaped.
--
-- Registry sequence fingerprints (the `seq:<sha256>` text in a registry entry)
-- are stored in the entry's own fields and are computed the same way by the
-- plugin, so they need no change here.
--
-- Search: a plugin block's words were not searched at all. They now are, by a
-- rule that is the same for every plugin: the text values in the block's state,
-- apart from very long ones (a raw sequence is one 'word' of thousands of
-- letters and the text search would only log a notice and skip it). The title,
-- caption, feature labels, primer names, plan and read names and registry
-- identifiers a sequence block already offered to search stay searchable.

DO $$
DECLARE
  v_sig regprocedure := 'internal.block_search_text(text, jsonb, uuid)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := $q$    WHEN 'plugin' THEN
      -- A plugin block's state is the plugin's own; search does not read it.
      v_text := '';
$q$;
  v_new constant text := $q$    WHEN 'plugin' THEN
      -- The words in a plugin block's state: every text value of up to 500
      -- characters. Longer ones (a raw sequence) are not words and are left out.
      SELECT coalesce(string_agg(x #>> '{}', ' '), '') INTO v_text
        FROM jsonb_path_query(coalesce(v_p -> 'state', 'null'::jsonb), 'strict $.**') x
       WHERE jsonb_typeof(x) = 'string' AND length(x #>> '{}') <= 500;
$q$;
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.block_search_text';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
--> statement-breakpoint

-- Sequence blocks become plugin blocks. The block type is fixed by a trigger and
-- the other triggers below record an edit by a person (a reason, an audit event,
-- a new "last edited" time), which a one-off conversion is not, so they are paused
-- for this one statement and put back at once. Search text still refreshes, and
-- that touches the record, so the check that refuses edits to records of an archived
-- project is paused too: this is not an edit by anyone, and an archived project's
-- notebooks must still be found by their sequence blocks.
DO $$
BEGIN
  ALTER TABLE api.blocks DISABLE TRIGGER blocks_identity_immutable;
  ALTER TABLE api.blocks DISABLE TRIGGER enforce_change_reason;
  ALTER TABLE api.blocks DISABLE TRIGGER record_change_reason;
  ALTER TABLE api.blocks DISABLE TRIGGER change_event_blocks;
  ALTER TABLE api.blocks DISABLE TRIGGER set_updated_at;
  ALTER TABLE api.records DISABLE TRIGGER assert_record_project_active;

  UPDATE api.blocks
     SET type = 'plugin',
         payload = jsonb_build_object('plugin', 'sequence-tools', 'block', 'sequence', 'state', payload),
         version = version + 1
   WHERE type = 'sequence';

  ALTER TABLE api.blocks ENABLE TRIGGER blocks_identity_immutable;
  ALTER TABLE api.blocks ENABLE TRIGGER enforce_change_reason;
  ALTER TABLE api.blocks ENABLE TRIGGER record_change_reason;
  ALTER TABLE api.blocks ENABLE TRIGGER change_event_blocks;
  ALTER TABLE api.blocks ENABLE TRIGGER set_updated_at;
  ALTER TABLE api.records ENABLE TRIGGER assert_record_project_active;
END $$;
