-- PIPE-03.1 — the governed catalogue gains the block-insert operation.
--
-- internal.pipeline_action_errors validates authored actions against a catalogue that is
-- mirrored as a literal in this function, so a new operation has to be added in both places
-- or a run is refused before it starts. The entry below matches the TypeScript catalogue in
-- src/lib/pipelines/actions.ts, including the proposalKind that makes the operation
-- proposable.
--
-- `mode` is validated here too: the action object may say whether the step executes the
-- operation or proposes it, and a mode the executor does not understand would otherwise be
-- ignored silently.
--
-- The function is patched rather than reproduced, and the patch asserts its marker was
-- found, so a failure to match raises instead of leaving the catalogue unchanged.

DO $$
DECLARE
  def text;
  marker text := '[{"operation":"create_project"';
  entry text;
BEGIN
  def := pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure);
  IF position('"operation":"insert_block"' in def) > 0 THEN RETURN; END IF;
  IF position(marker in def) = 0 THEN
    RAISE EXCEPTION 'action catalogue marker not found';
  END IF;

  entry := '{"operation":"insert_block","rpc":"insert_block",'
    || '"label":"Insert a notebook block",'
    || '"description":"Insert a block into a notebook record, after a named block. A step may propose this instead of doing it.",'
    || '"proposalKind":"notebook_block.insert",'
    || '"arguments":['
    || '{"name":"p_record_id","type":"uuid","required":true,"nullable":false},'
    || '{"name":"p_type","type":"text","required":true,"nullable":false},'
    || '{"name":"p_payload","type":"jsonb","required":true,"nullable":false},'
    || '{"name":"p_payload_schema_version","type":"integer","required":false,"nullable":false},'
    || '{"name":"p_after_block_id","type":"uuid","required":false,"nullable":true},'
    || '{"name":"p_expected_structure_version","type":"integer","required":false,"nullable":false},'
    || '{"name":"p_before_block_id","type":"uuid","required":false,"nullable":true}'
    || ']},';

  def := replace(def, marker, '[' || entry || '{"operation":"create_project"');

  -- `mode`, when present, must be one the executor understands.
  IF position('unknown action mode' in def) = 0 THEN
    def := replace(def,
      '    IF jsonb_typeof(v_action->''arguments'') IS DISTINCT FROM ''object'' THEN',
      '    IF v_action ? ''mode'' AND v_action->>''mode'' NOT IN (''execute'',''propose'') THEN'
      || E'\n'
      || '      v_errors := v_errors || ''[{"code":"invalid_value","field":"actions","message":"unknown action mode"}]''::jsonb;'
      || E'\n'
      || '      CONTINUE;'
      || E'\n'
      || '    END IF;'
      || E'\n'
      || '    IF jsonb_typeof(v_action->''arguments'') IS DISTINCT FROM ''object'' THEN');
  END IF;

  EXECUTE def;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
