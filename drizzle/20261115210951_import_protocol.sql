-- Import a protocol written elsewhere (for example a public protocol on
-- protocols.io) as an ordinary draft protocol: a protocol template record with
-- its steps, its reagents and a line saying where it came from. The caller
-- brings the text; nothing is fetched here. The record is a normal one, so it
-- reaches webhooks as record.created as well as protocol.imported.

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  IF position('''protocol_import''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''protocol_import''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES ('protocol.imported')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO internal.pipeline_trigger_events (name) VALUES ('protocol.imported')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE FUNCTION api.import_protocol(
    p_workspace_id uuid,
    p_title text,
    p_steps jsonb,
    p_description text DEFAULT NULL,
    p_reagents text[] DEFAULT ARRAY[]::text[],
    p_source jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_blocks jsonb := '[]'::jsonb;
  v_paragraphs jsonb;
  v_step jsonb;
  v_n integer := 0;
  v_section text := '';
  v_text text;
  v_result jsonb;
  v_record_id uuid;
  v_source text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A protocol needs a title of up to 200 characters.' USING ERRCODE = 'SB034';
  END IF;
  IF jsonb_typeof(p_steps) IS DISTINCT FROM 'array' OR jsonb_array_length(p_steps) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'A protocol needs between 1 and 300 steps.' USING ERRCODE = 'SB034';
  END IF;
  IF jsonb_typeof(coalesce(p_source, '{}'::jsonb)) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'The source is an object.' USING ERRCODE = 'SB034';
  END IF;

  -- Where it came from, then the description, one paragraph per blank line.
  v_source := nullif(btrim(coalesce(p_source->>'url', '')), '');
  v_paragraphs := '[]'::jsonb;
  IF v_source IS NOT NULL THEN
    v_paragraphs := v_paragraphs || jsonb_build_array(jsonb_build_object(
      'type', 'paragraph',
      'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text',
        'Imported from ' || coalesce(nullif(btrim(p_source->>'provider'), ''), 'another source') || ': ' || left(v_source, 500)
        || CASE WHEN nullif(btrim(coalesce(p_source->>'doi', '')), '') IS NOT NULL THEN ' (DOI ' || left(btrim(p_source->>'doi'), 200) || ')' ELSE '' END))));
  END IF;
  FOR v_text IN SELECT btrim(part) FROM regexp_split_to_table(coalesce(left(p_description, 20000), ''), E'\n\\s*\n') AS part LOOP
    IF v_text <> '' THEN
      v_paragraphs := v_paragraphs || jsonb_build_array(jsonb_build_object(
        'type', 'paragraph',
        'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))));
    END IF;
  END LOOP;
  IF jsonb_array_length(v_paragraphs) > 0 THEN
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
      'type', 'rich_text',
      'payload', jsonb_build_object('doc', jsonb_build_object('type', 'doc', 'content', v_paragraphs))));
  END IF;

  IF coalesce(array_length(p_reagents, 1), 0) > 0 THEN
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
      'type', 'rich_text',
      'payload', jsonb_build_object('doc', jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
        jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', 2),
          'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'Reagents'))),
        jsonb_build_object('type', 'bulletList', 'content', (
          SELECT jsonb_agg(jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(
            jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
              jsonb_build_object('type', 'text', 'text', left(btrim(r), 400)))))))
            FROM unnest(p_reagents[1:100]) AS r WHERE btrim(r) <> '')))))));
  END IF;

  -- A section name becomes a heading where the section starts.
  FOR v_step IN SELECT * FROM jsonb_array_elements(p_steps) LOOP
    v_text := nullif(btrim(coalesce(v_step->>'text', '')), '');
    IF v_text IS NULL THEN CONTINUE; END IF;
    IF nullif(btrim(coalesce(v_step->>'section', '')), '') IS NOT NULL
       AND btrim(v_step->>'section') IS DISTINCT FROM v_section THEN
      v_section := btrim(v_step->>'section');
      v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
        'type', 'rich_text',
        'payload', jsonb_build_object('doc', jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
          jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', 3),
            'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', left(v_section, 200)))))))));
    END IF;
    v_n := v_n + 1;
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
      'type', 'procedure_step',
      'payload', jsonb_build_object('text', left(v_text, 8000), 'stepNumber', v_n)));
  END LOOP;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Every step was empty.' USING ERRCODE = 'SB034';
  END IF;

  v_result := api.create_record_with_blocks(
    NULL, 'protocol_template', btrim(p_title), 'draft', ARRAY[]::text[], v_blocks, '{}'::jsonb);
  v_record_id := (v_result->'record'->>'id')::uuid;

  PERFORM internal.emit_change_event(p_workspace_id, 'protocol_import', v_record_id, 'create', v_record_id, NULL,
    jsonb_build_object('recordId', v_record_id, 'identifier', v_result->'record'->>'identifier',
      'title', btrim(p_title), 'provider', p_source->>'provider', 'url', p_source->>'url', 'steps', v_n));

  RETURN jsonb_build_object('record', v_result->'record', 'steps', v_n);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.import_protocol(uuid, text, jsonb, text, text[], jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.import_protocol(uuid, text, jsonb, text, text[], jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.import_protocol(uuid, text, jsonb, text, text[], jsonb) TO authenticated, api_client;
