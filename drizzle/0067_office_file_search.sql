-- Office files embedded in notebooks, found through their text (SRCH-OFFICE).
--
-- 1. A file block contributes the text of the version it shows (its
--    fileVersion), not of every version, so a figure that was corrected in v2
--    is no longer found by the words of v1.
-- 2. api.search says which embedded file matched and which block holds it, so
--    the result can read "In plate-reader.xlsx" and open the notebook at that
--    block.
-- 3. Legacy Word files (.doc) can be uploaded; their text is read like the rest.

-- An integer held in a payload, or NULL when it is absent or malformed.
CREATE FUNCTION internal.search_int(p_text text) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
BEGIN
  RETURN p_text::integer;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_int(text) OWNER TO migrator;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.search_int(text) TO authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.block_search_text(p_type text, p_payload jsonb, p_record_id uuid DEFAULT NULL)
    RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_text text := '';
  v_id uuid;
  v_ref text;
BEGIN
  CASE p_type
    WHEN 'rich_text' THEN
      v_text := internal.rich_text_plain(v_p -> 'doc');

    WHEN 'checklist' THEN
      v_text := internal.jsonb_path_text(v_p, '$.items[*].text');

    WHEN 'callout' THEN
      v_text := coalesce(v_p ->> 'text', '');

    WHEN 'conclusion' THEN
      v_text := concat_ws(' ', v_p ->> 'text', v_p ->> 'basis',
        replace(coalesce(v_p ->> 'verdict', ''), '_', ' '));

    WHEN 'metric' THEN
      v_text := concat_ws(' ', v_p ->> 'label', v_p ->> 'value', v_p ->> 'unit',
        v_p ->> 'provenance');

    WHEN 'table' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.columns[*]'),
        internal.jsonb_path_text(v_p, '$.rows[*][*]'));

    WHEN 'procedure_step' THEN
      v_text := concat_ws(' ', v_p ->> 'text', v_p ->> 'note');

    WHEN 'signature_request' THEN
      v_text := concat_ws(' ', v_p ->> 'requestedUserName',
        replace(coalesce(v_p ->> 'meaning', ''), '-', ' '), v_p ->> 'note');

    WHEN 'corrective_actions' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.items[*].action'),
        internal.jsonb_path_text(v_p, '$.items[*].ownerName'),
        replace(internal.jsonb_path_text(v_p, '$.items[*].status'), '-', ' '));

    WHEN 'materials' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.items[*].identifier'),
        internal.jsonb_path_text(v_p, '$.items[*].title'),
        internal.jsonb_path_text(v_p, '$.items[*].note'),
        internal.jsonb_path_text(v_p, '$.items[*].unit.symbol'));

    WHEN 'linked_record' THEN
      v_text := concat_ws(' ', v_p ->> 'targetIdentifier', v_p ->> 'label',
        replace(coalesce(v_p ->> 'linkType', ''), '_', ' '), v_p ->> 'targetKind');
      v_id := internal.search_uuid(v_p ->> 'targetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', r.identifier, r.title) INTO v_ref
          FROM api.records r
         WHERE r.id = v_id AND r.deleted_at IS NULL
           AND internal.search_scope_ok(p_record_id, r.project_id);
        v_text := concat_ws(' ', v_text, v_ref);
      END IF;

    WHEN 'protocol_reference' THEN
      v_text := concat_ws(' ', v_p ->> 'protocolIdentifier', v_p ->> 'protocolTitle',
        v_p ->> 'version', replace(coalesce(v_p ->> 'approvalStatus', ''), '_', ' '));

    WHEN 'file' THEN
      v_text := concat_ws(' ', v_p ->> 'displayName', v_p ->> 'fileIdentifier',
        v_p ->> 'mediaType');
      v_id := internal.search_uuid(v_p ->> 'fileRecordId');
      IF v_id IS NOT NULL THEN
        -- What is written inside the attached file, so a notebook is found by
        -- the report it attaches. Only the version the block shows (its
        -- fileVersion, else the newest), capped, and only from a file in the
        -- notebook's own project.
        SELECT left(fo.extracted_text, 100000) INTO v_ref
          FROM api.file_objects fo
          JOIN api.records fr ON fr.id = fo.record_id
         WHERE fo.record_id = v_id AND fo.deleted_at IS NULL
           AND internal.search_scope_ok(p_record_id, fr.project_id)
         ORDER BY (fo.version = internal.search_int(v_p ->> 'fileVersion')) DESC NULLS LAST,
                  fo.version DESC
         LIMIT 1;
        v_text := concat_ws(' ', v_text, v_ref);
      END IF;

    WHEN 'sheet' THEN
      v_id := internal.search_uuid(v_p ->> 'instanceId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', si.display_id, si.name,
                 internal.jsonb_path_text(si.state, '$.localFields[*].label'))
          INTO v_text
          FROM api.sheet_instances si
         WHERE si.id = v_id AND si.lifecycle IN ('active', 'archived')
           AND internal.search_scope_ok(p_record_id, si.project_id);
      END IF;

    WHEN 'chart' THEN
      v_text := concat_ws(' ', v_p ->> 'title',
        internal.jsonb_path_text(v_p, '$.spec.display.axes.*.label'),
        internal.jsonb_path_text(v_p, '$.spec.display.axes.*.unit'),
        internal.jsonb_path_text(v_p, '$.spec.display.series[*].label'),
        internal.jsonb_path_text(v_p, '$.spec.display.annotations[*].label'),
        v_p #>> '{spec,display,caption}');
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT concat_ws(' ', d.display_id, d.name), ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.spec.datasets[*].datasetId') x
        JOIN api.datasets d ON d.id = internal.search_uuid(x #>> '{}')
       WHERE internal.search_scope_ok(p_record_id, d.primary_project_id);
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT f.label, ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.spec.fields.*.fieldId') x
        JOIN api.dataset_schema_version_fields f ON f.field_id = internal.search_uuid(x #>> '{}');

    WHEN 'analysis' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'provenance',
        v_p #>> '{frozen,definitionName}',
        internal.jsonb_path_text(v_p, '$.frozen.columns[*].label'));
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT concat_ws(' ', d.display_id, d.name), ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.frozen.datasetProvenance[*].datasetId') x
        JOIN api.datasets d ON d.id = internal.search_uuid(x #>> '{}')
       WHERE internal.search_scope_ok(p_record_id, d.primary_project_id);
      v_id := internal.search_uuid(v_p ->> 'definitionId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, ad.name) INTO v_text
          FROM api.analysis_definitions ad WHERE ad.id = v_id;
      END IF;

    WHEN 'plate_map' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'provenance',
        internal.jsonb_path_text(v_p, '$.spec.wells[*].wellCode'),
        replace(internal.jsonb_path_text(v_p, '$.spec.wells[*].role'), '_', ' '),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].sampleRef.identifier'),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].sampleRef.title'),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].notes'));

    WHEN 'pipeline_output' THEN
      v_text := coalesce(v_p ->> 'label', '');
      v_id := internal.search_uuid(v_p ->> 'runId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, pd.display_id, pd.name) INTO v_text
          FROM api.pipeline_runs pr
          JOIN api.pipeline_definition_versions pv ON pv.id = pr.definition_version_id
          JOIN api.pipeline_definitions pd ON pd.id = pv.definition_id
         WHERE pr.id = v_id;
      END IF;
      v_id := internal.search_uuid(v_p ->> 'datasetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, d.display_id, d.name) INTO v_text
          FROM api.datasets d
         WHERE d.id = v_id AND internal.search_scope_ok(p_record_id, d.primary_project_id);
      END IF;

    WHEN 'dataset_import' THEN
      v_text := coalesce(v_p ->> 'sheetName', '');
      v_id := internal.search_uuid(v_p ->> 'fileId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, f.filename) INTO v_text
          FROM api.dataset_import_files f WHERE f.id = v_id;
      END IF;
      v_id := internal.search_uuid(v_p ->> 'datasetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, d.display_id, d.name) INTO v_text
          FROM api.datasets d
         WHERE d.id = v_id AND internal.search_scope_ok(p_record_id, d.primary_project_id);
      END IF;

    ELSE
      -- A type this migration has no rule for: the payload's string values,
      -- which never include keys.
      v_text := internal.extract_jsonb_text(v_p);
  END CASE;
  RETURN btrim(coalesce(v_text, ''));
END;
$$;
--> statement-breakpoint

-- The embedded file of a notebook that matches a text query best: the block that
-- holds it, the file's name and a snippet around the match. Runs as the caller,
-- so row security on blocks and files decides what can be named; a file the
-- reader cannot open never labels a hit.
CREATE FUNCTION internal.search_embedded_file_hit(p_record_id uuid, p_tsq tsquery)
    RETURNS TABLE (block_id uuid, file_name text, context text)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT b.id,
         coalesce(nullif(fo.display_name, ''), b.payload ->> 'displayName'),
         ts_headline('english', left(fo.extracted_text, 100000), p_tsq,
           'MaxWords=30,MinWords=10,ShortWord=3')
    FROM api.blocks b
    JOIN api.records fr
      ON fr.id = internal.search_uuid(b.payload ->> 'fileRecordId') AND fr.deleted_at IS NULL
    CROSS JOIN LATERAL (
      SELECT f.display_name, f.extracted_text
        FROM api.file_objects f
       WHERE f.record_id = fr.id AND f.deleted_at IS NULL
         AND internal.search_scope_ok(p_record_id, fr.project_id)
       ORDER BY (f.version = internal.search_int(b.payload ->> 'fileVersion')) DESC NULLS LAST,
                f.version DESC
       LIMIT 1
    ) fo
   WHERE b.record_id = p_record_id AND b.type = 'file'
     AND to_tsvector('english', left(coalesce(fo.extracted_text, ''), 100000)) @@ p_tsq
   ORDER BY ts_rank(to_tsvector('english', left(fo.extracted_text, 100000)), p_tsq) DESC, b."order"
   LIMIT 1
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_embedded_file_hit(uuid, tsquery) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.search_embedded_file_hit(uuid, tsquery) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.search_embedded_file_hit(uuid, tsquery) TO authenticated, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.search_scope_ok(uuid, uuid) TO authenticated, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.search_uuid(text) TO authenticated, api_client;
--> statement-breakpoint

DROP FUNCTION api.search(text, uuid, text, text, text, timestamptz, timestamptz, integer, integer, text, boolean, jsonb, text);
--> statement-breakpoint
CREATE FUNCTION api.search(
    p_query text DEFAULT ''::text, p_project_id uuid DEFAULT NULL::uuid,
    p_kind text DEFAULT NULL::text, p_status text DEFAULT NULL::text,
    p_owner_id text DEFAULT NULL::text, p_date_from timestamptz DEFAULT NULL::timestamptz,
    p_date_to timestamptz DEFAULT NULL::timestamptz, p_limit integer DEFAULT 20,
    p_offset integer DEFAULT 0, p_result_type text DEFAULT NULL::text,
    p_include_archived boolean DEFAULT true, p_filter jsonb DEFAULT NULL::jsonb,
    p_sort text DEFAULT 'relevance'::text)
  RETURNS TABLE (result_type text, record_id uuid, kind text, identifier text, title text,
    status text, project_id uuid, archived boolean, created_by_user_id text,
    created_at timestamptz, updated_at timestamptz, matched_context text, matched_field text,
    rank real, deep_link text, total_count bigint, parent_title text, fields jsonb,
    matched_block_id uuid, matched_file_name text)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_parsed record;
  v_has_text boolean;
  v_has_query boolean;
  v_limit integer;
  v_offset integer;
  v_sort text;
  v_ids text[];
BEGIN
  v_sort := coalesce(nullif(btrim(p_sort), ''), 'relevance');
  IF v_sort NOT IN ('relevance', 'updated', 'created') THEN
    RAISE EXCEPTION 'invalid sort %', v_sort USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_parsed FROM internal.search_parse_query(p_query);
  v_has_text := numnode(v_parsed.tsq) > 0;
  v_has_query := v_has_text OR cardinality(v_parsed.id_tokens) > 0;
  v_ids := (SELECT coalesce(array_agg(lower(t)), ARRAY[]::text[]) FROM unnest(v_parsed.id_tokens) t);

  v_limit := coalesce(p_limit, 20);
  IF v_limit < 1 THEN v_limit := 20; END IF;
  IF v_limit > 100 THEN v_limit := 100; END IF;
  v_offset := coalesce(p_offset, 0);
  IF v_offset < 0 THEN v_offset := 0; END IF;

  RETURN QUERY
  WITH m AS (
    SELECT * FROM internal.search_matches(p_query, p_filter, p_project_id, p_kind, p_status,
      p_owner_id, p_date_from, p_date_to, p_result_type, p_include_archived)
  ),
  page AS (
    SELECT m.*, count(*) OVER () AS total
      FROM m
     ORDER BY
       CASE WHEN v_sort = 'relevance' AND v_has_query THEN m.rank END DESC NULLS LAST,
       CASE WHEN v_sort = 'created' THEN m.created_at END DESC NULLS LAST,
       m.updated_at DESC NULLS LAST,
       m.record_id
     LIMIT v_limit OFFSET v_offset
  )
  SELECT
    pg.result_type,
    pg.record_id,
    pg.kind,
    d.identifier,
    d.title,
    d.status,
    d.project_id,
    d.archived,
    coalesce(d.owner_user_id, ''),
    d.created_at,
    d.updated_at,
    CASE
      WHEN NOT v_has_query THEN left(d.title || ' — ' || d.identifier, 120)
      WHEN pg.cell_text IS NOT NULL THEN
        ts_headline('english', left(pg.cell_text || ' ' || coalesce(pg.cell_label, ''), 20000),
          v_parsed.tsq, 'MaxWords=30,MinWords=10,ShortWord=3')
      WHEN fh.block_id IS NOT NULL THEN fh.context
      ELSE
        ts_headline('english',
          left(d.title || ' — ' || d.identifier || ' — ' || d.body, 30000),
          v_parsed.tsq,
          'MaxWords=30,MinWords=10,ShortWord=3')
    END,
    -- A file whose text matches is reported as its contents, even when its name also matches.
    CASE
      WHEN NOT v_has_query THEN 'title'
      WHEN pg.cell_text IS NOT NULL THEN 'cell_value'
      WHEN fh.block_id IS NOT NULL THEN 'embedded_file'
      WHEN pg.in_text AND d.object_type = 'comment' THEN 'comment_body'
      WHEN pg.in_text THEN 'block_text'
      WHEN v_has_text AND d.object_type = 'file'
        AND ts_filter(d.tsv, '{d}') @@ v_parsed.tsq THEN 'file_contents'
      WHEN v_has_text AND to_tsvector('english', d.title) @@ v_parsed.tsq THEN 'title'
      WHEN (v_has_text AND to_tsvector('english', d.identifier) @@ v_parsed.tsq)
        OR lower(d.identifier) = ANY (v_ids) THEN 'identifier'
      WHEN v_has_text AND d.object_type IN ('record', 'file')
        AND to_tsvector('english', d.kind) @@ v_parsed.tsq THEN 'kind'
      WHEN v_has_text AND to_tsvector('english', d.status) @@ v_parsed.tsq THEN 'status'
      WHEN v_has_text AND to_tsvector('english', array_to_string(d.tags, ' ')) @@ v_parsed.tsq THEN 'tags'
      WHEN v_has_text AND d.head_tsv @@ v_parsed.tsq THEN
        CASE d.object_type WHEN 'record' THEN 'relationship' WHEN 'file' THEN 'file_metadata' ELSE 'title' END
      WHEN NOT v_has_text THEN 'identifier'
      WHEN d.object_type = 'file' THEN 'file_contents'
      ELSE 'description'
    END,
    pg.rank,
    CASE
      WHEN pg.result_type = 'dataset_row' THEN '/datasets?dataset=' || pg.record_id::text
      WHEN pg.result_type = 'sheet_row' THEN '/sheets/' || pg.record_id::text
      ELSE d.deep_link
    END,
    pg.total,
    par.title,
    d.fields,
    fh.block_id,
    fh.file_name
  FROM page pg
  JOIN api.search_documents d ON d.object_type = pg.doc_type AND d.object_id = pg.record_id
  -- A notebook found by the text of a file it embeds: which file, in which block.
  LEFT JOIN LATERAL (
    SELECT * FROM internal.search_embedded_file_hit(pg.record_id, v_parsed.tsq)
     WHERE pg.in_text AND pg.doc_type = 'record' AND v_has_text
  ) fh ON true
  LEFT JOIN api.search_documents par ON par.object_type = d.parent_type AND par.object_id = d.parent_id
  ORDER BY
    CASE WHEN v_sort = 'relevance' AND v_has_query THEN pg.rank END DESC NULLS LAST,
    CASE WHEN v_sort = 'created' THEN pg.created_at END DESC NULLS LAST,
    pg.updated_at DESC NULLS LAST,
    pg.record_id;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.search(text, uuid, text, text, text, timestamptz, timestamptz, integer, integer, text, boolean, jsonb, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.search(text, uuid, text, text, text, timestamptz, timestamptz, integer, integer, text, boolean, jsonb, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.search(text, uuid, text, text, text, timestamptz, timestamptz, integer, integer, text, boolean, jsonb, text) TO authenticated;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.search(text, uuid, text, text, text, timestamptz, timestamptz, integer, integer, text, boolean, jsonb, text) TO api_client;
--> statement-breakpoint

-- Legacy Word documents (.doc, application/msword) can be attached; their text
-- is read like the other Office formats.
ALTER TABLE api.file_objects DROP CONSTRAINT chk_file_objects_media_type;
--> statement-breakpoint
ALTER TABLE api.file_objects ADD CONSTRAINT chk_file_objects_media_type CHECK (media_type = ANY (ARRAY[
  'text/csv', 'text/plain', 'application/json', 'application/pdf',
  'image/png', 'image/jpeg', 'image/tiff', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/octet-stream'
]));
--> statement-breakpoint

-- api.search gained two columns, so the saved-search runner that returns its rows must too.
DROP FUNCTION api.run_saved_search(uuid, integer, integer);
--> statement-breakpoint
CREATE FUNCTION api.run_saved_search(
    p_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
  RETURNS TABLE (result_type text, record_id uuid, kind text, identifier text, title text,
    status text, project_id uuid, archived boolean, created_by_user_id text,
    created_at timestamptz, updated_at timestamptz, matched_context text, matched_field text,
    rank real, deep_link text, total_count bigint, parent_title text, fields jsonb,
    matched_block_id uuid, matched_file_name text)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_saved api.saved_searches;
  v_args jsonb;
BEGIN
  SELECT * INTO v_saved FROM api.saved_searches s
   WHERE s.id = p_id AND s.workspace_id = api.current_workspace_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'saved search not found' USING ERRCODE = 'P0002';
  END IF;
  v_args := coalesce(v_saved.arguments, '{}'::jsonb);
  RETURN QUERY SELECT * FROM api.search(
    p_query := coalesce(v_args ->> 'p_query', v_saved.facets ->> 'text', v_saved.query),
    p_project_id := (v_args ->> 'p_project_id')::uuid,
    p_kind := v_args ->> 'p_kind',
    p_status := v_args ->> 'p_status',
    p_owner_id := v_args ->> 'p_owner_id',
    p_date_from := (v_args ->> 'p_date_from')::timestamptz,
    p_date_to := (v_args ->> 'p_date_to')::timestamptz,
    p_limit := p_limit,
    p_offset := p_offset,
    p_result_type := v_args ->> 'p_result_type',
    p_include_archived := coalesce((v_args ->> 'p_include_archived')::boolean, true),
    p_filter := nullif(v_args -> 'p_filter', 'null'::jsonb),
    p_sort := coalesce(v_args ->> 'p_sort', 'relevance'));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.run_saved_search(uuid, integer, integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.run_saved_search(uuid, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.run_saved_search(uuid, integer, integer) TO authenticated;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.run_saved_search(uuid, integer, integer) TO api_client;
--> statement-breakpoint

SELECT internal.search_reindex('record');
