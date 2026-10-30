-- One search index over all app data.
--
-- api.search used to be a 560-line union of eleven CTEs that rebuilt a
-- tsvector from the source tables on every query, and api.search_facets was a
-- hand-copied twin of it. Only records carried an indexed vector; everything
-- else (datasets, sheets, comments, files, pipelines...) was scanned per query,
-- blocks leaked their JSON keys into snippets ("text paragraph 4 conditions"),
-- and instruments, bookings, storage, clients, deviations, parsers and people
-- could not be found at all.
--
-- This migration adds api.search_documents: one row per searchable object,
-- kept current by triggers on the source tables, with row-level security that
-- mirrors the sources. api.search and api.search_facets (next migration
-- statements) read only that table plus the two cell-value tables, and share
-- one matching function so their counts cannot drift.
--
-- The backfill at the end writes no user-attributed rows: owner_user_id is
-- copied from the source row, never invented.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------
CREATE TABLE api.search_documents (
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
  -- What the object belongs to (a comment's sheet or notebook, a run's
  -- instrument), so a hit can say "in EXP-0145".
  parent_type text,
  parent_id uuid,
  -- The project that governs who may see it; NULL for workspace-level objects.
  project_id uuid,
  kind text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '',
  owner_user_id text,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz,
  updated_at timestamptz,
  archived boolean NOT NULL DEFAULT false,
  -- Set on a draft experiment (and what hangs off it): only its author and
  -- workspace admins may see it, as on api.records.
  private_to_user_id text,
  -- Set where the source table asks internal.can_access_object for more than
  -- the project (a sheet's notebook and data sources, a run's linked records).
  access_kind text,
  title text NOT NULL DEFAULT '',
  identifier text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  deep_link text NOT NULL DEFAULT '',
  tsv tsvector NOT NULL,
  -- Only the A and B parts of tsv (name, identifier, tags, status, kind): what
  -- decides whether a hit was found in the text or only in the heading.
  head_tsv tsvector NOT NULL,
  PRIMARY KEY (object_type, object_id),
  CONSTRAINT chk_search_documents_type CHECK (object_type IN (
    'record', 'file', 'dataset', 'sheet', 'template', 'comment', 'project',
    'pipeline', 'analysis', 'instrument', 'instrument_run', 'booking',
    'storage_location', 'client', 'deviation', 'parser', 'person'))
);
--> statement-breakpoint
ALTER TABLE api.search_documents OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_search_documents_tsv ON api.search_documents USING gin (tsv);
--> statement-breakpoint
CREATE INDEX idx_search_documents_name_trgm ON api.search_documents
  USING gin ((title || ' ' || identifier) public.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX idx_search_documents_browse
  ON api.search_documents (workspace_id, object_type, updated_at DESC);
--> statement-breakpoint
CREATE INDEX idx_search_documents_fields
  ON api.search_documents USING gin (fields jsonb_path_ops);
--> statement-breakpoint
CREATE INDEX idx_search_documents_parent
  ON api.search_documents (parent_type, parent_id) WHERE parent_id IS NOT NULL;
--> statement-breakpoint
COMMENT ON TABLE api.search_documents IS
  'One row per searchable object, maintained by triggers on the source tables (internal.search_reindex). Weights: A title+identifier, B tags/status/kind, C body, D file text.';
--> statement-breakpoint
GRANT SELECT ON api.search_documents TO authenticated, api_client;
--> statement-breakpoint
ALTER TABLE api.search_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Row security mirrors the sources. Permissive: workspace membership, as on
-- records, datasets, comments and the rest. Restrictive: the project (once per
-- statement, as api.records does since 0049), a draft experiment's privacy
-- (authenticated only, as records_draft_experiment_private), and
-- internal.can_access_object for the few types whose sources ask for it.
CREATE POLICY search_documents_select ON api.search_documents
  FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id()
         AND (SELECT api.is_workspace_member(api.current_workspace_id())));
--> statement-breakpoint
CREATE POLICY search_documents_select_api_client ON api.search_documents
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY search_documents_project ON api.search_documents
  AS RESTRICTIVE FOR SELECT TO authenticated, api_client
  USING (project_id IS NULL OR project_id IN (SELECT internal.viewable_project_ids()));
--> statement-breakpoint
CREATE POLICY search_documents_private ON api.search_documents
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (private_to_user_id IS NULL
         OR private_to_user_id = (SELECT api.current_user_id())
         OR (SELECT api.has_capability(workspace_id, 'workspace.admin')));
--> statement-breakpoint
CREATE POLICY search_documents_object ON api.search_documents
  AS RESTRICTIVE FOR SELECT TO authenticated, api_client
  USING (access_kind IS NULL
         OR internal.can_access_object(access_kind, object_id, 'view'));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Text helpers.
-- ---------------------------------------------------------------------------

-- Plain text of a rich-text document: node types and marks are structure, not
-- words, so only text nodes count. Paragraphs, headings and list items are
-- separated by a space; text nodes inside one paragraph are joined as written.
CREATE FUNCTION internal.rich_text_plain(p_node jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_type text;
  v_child jsonb;
  v_parts text[] := ARRAY[]::text[];
BEGIN
  IF p_node IS NULL OR jsonb_typeof(p_node) <> 'object' THEN RETURN ''; END IF;
  v_type := p_node ->> 'type';
  IF v_type = 'text' THEN RETURN coalesce(p_node ->> 'text', ''); END IF;
  IF jsonb_typeof(p_node -> 'content') <> 'array' THEN RETURN ''; END IF;
  FOR v_child IN SELECT * FROM jsonb_array_elements(p_node -> 'content') LOOP
    v_parts := v_parts || internal.rich_text_plain(v_child);
  END LOOP;
  -- Inline content (text nodes) concatenates; block content is spaced.
  IF v_type IN ('paragraph', 'heading') THEN
    RETURN array_to_string(v_parts, '');
  END IF;
  RETURN array_to_string(v_parts, ' ');
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.rich_text_plain(jsonb) OWNER TO migrator;
--> statement-breakpoint

-- The scalar leaves matched by a JSON path, as text, joined by spaces.
CREATE FUNCTION internal.jsonb_path_text(p_value jsonb, p_path text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT coalesce(string_agg(x #>> '{}', ' '), '')
    FROM jsonb_path_query(p_value, p_path::jsonpath) x
   WHERE jsonb_typeof(x) IN ('string', 'number')
$$;
--> statement-breakpoint
ALTER FUNCTION internal.jsonb_path_text(jsonb, text) OWNER TO migrator;
--> statement-breakpoint

-- Whether a referenced object may contribute its name to a notebook's search
-- text. A notebook in one project must not make a record in another project
-- findable by words the reader could not otherwise see.
CREATE FUNCTION internal.search_scope_ok(p_record_id uuid, p_target_project uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p_target_project IS NULL
      OR p_record_id IS NULL
      OR p_target_project IS NOT DISTINCT FROM
         (SELECT r.project_id FROM api.records r WHERE r.id = p_record_id)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_scope_ok(uuid, uuid) OWNER TO migrator;
--> statement-breakpoint

-- A uuid held in a payload, or NULL when it is absent or malformed.
CREATE FUNCTION internal.search_uuid(p_text text) RETURNS uuid
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
BEGIN
  RETURN p_text::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_uuid(text) OWNER TO migrator;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- One rule per block type. The words a reader sees on the page, with
-- references resolved to the names they point at. Keys, ids and node names
-- never reach the index. Unknown types fall back to the payload's string
-- values. src/lib/blocks/registry.test.ts-style parity: a vitest fails when
-- BLOCK_TYPES has a type with no rule below.
-- ---------------------------------------------------------------------------
CREATE FUNCTION internal.block_search_text(p_type text, p_payload jsonb, p_record_id uuid DEFAULT NULL)
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
        -- the report it attaches; capped, and only from a file in the
        -- notebook's own project.
        SELECT left(string_agg(coalesce(fo.extracted_text, ''), ' '), 20000) INTO v_ref
          FROM api.file_objects fo
          JOIN api.records fr ON fr.id = fo.record_id
         WHERE fo.record_id = v_id AND fo.deleted_at IS NULL
           AND internal.search_scope_ok(p_record_id, fr.project_id);
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
ALTER FUNCTION internal.block_search_text(text, jsonb, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.block_search_text(text, jsonb, uuid) FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The vector. Weights: A title, identifier and aliases; B tags, status and
-- kind; C body; D file text. Input is truncated so the vector stays well under
-- PostgreSQL's 1 MB limit.
-- ---------------------------------------------------------------------------
CREATE FUNCTION internal.search_make_tsv(p_title text, p_identifier text, p_aliases text,
    p_tags text[], p_status text, p_kind text, p_body text, p_file_text text) RETURNS tsvector
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT setweight(to_tsvector('english'::regconfig,
           left(coalesce(p_title, '') || ' ' || coalesce(p_identifier, '') || ' ' || coalesce(p_aliases, ''), 2000)), 'A')
      || setweight(to_tsvector('english'::regconfig,
           left(array_to_string(coalesce(p_tags, ARRAY[]::text[]), ' ') || ' ' ||
                coalesce(p_status, '') || ' ' || coalesce(p_kind, ''), 2000)), 'B')
      || setweight(to_tsvector('english'::regconfig, left(coalesce(p_body, ''), 250000)), 'C')
      || setweight(to_tsvector('english'::regconfig, left(coalesce(p_file_text, ''), 250000)), 'D')
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_make_tsv(text, text, text, text[], text, text, text, text) OWNER TO migrator;
--> statement-breakpoint

-- What a builder returns for one object.
CREATE TYPE internal.search_doc_input AS (
  object_type text,
  object_id uuid,
  workspace_id uuid,
  parent_type text,
  parent_id uuid,
  project_id uuid,
  kind text,
  status text,
  owner_user_id text,
  tags text[],
  created_at timestamptz,
  updated_at timestamptz,
  archived boolean,
  private_to_user_id text,
  access_kind text,
  title text,
  identifier text,
  aliases text,
  body text,
  file_text text,
  fields jsonb,
  deep_link text
);
--> statement-breakpoint
ALTER TYPE internal.search_doc_input OWNER TO migrator;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Builders: one per object type, set-based, so the backfill (p_ids NULL) and a
-- single-object reindex run the same SQL. Each returns nothing for an object
-- that should not be indexed (deleted, filtered out), which removes its row.
-- ---------------------------------------------------------------------------

-- Notebooks, samples, materials, protocols, reports and every other record
-- kind except uploaded files.
CREATE FUNCTION internal.search_docs_record(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'record'::text, r.id, r.workspace_id, NULL::text, NULL::uuid, r.project_id,
         r.kind, r.status, r.created_by_user_id,
         coalesce(r.tags, ARRAY[]::text[]), r.created_at, r.updated_at,
         r.archived_at IS NOT NULL,
         CASE WHEN r.kind = 'experiment' AND r.status = 'draft' THEN r.created_by_user_id END,
         NULL::text,
         r.title, r.identifier,
         (SELECT string_agg(a.alias, ' ') FROM api.record_aliases a WHERE a.record_id = r.id),
         concat_ws(E'\n',
           (SELECT string_agg(internal.block_search_text(b.type, b.payload, r.id), E'\n' ORDER BY b."order")
              FROM api.blocks b WHERE b.record_id = r.id),
           internal.extract_jsonb_text(r.properties),
           (SELECT string_agg(concat_ws(' ', rl.target_identifier, rl.target_kind, rl.link_type), ' ')
              FROM api.record_links rl WHERE rl.source_record_id = r.id)),
         ''::text,
         coalesce((SELECT jsonb_object_agg(e.key, e.value)
                     FROM jsonb_each(CASE WHEN jsonb_typeof(r.custom_fields) = 'object'
                                          THEN r.custom_fields ELSE '{}'::jsonb END) e
                    WHERE jsonb_typeof(e.value) IN ('string', 'number', 'boolean')), '{}'::jsonb)
           || jsonb_strip_nulls(jsonb_build_object(
                'reviewer', r.reviewer_user_id, 'decision', r.decision,
                'planned_end', r.planned_end, 'locked', r.locked_at IS NOT NULL)),
         CASE r.kind
           WHEN 'sample' THEN '/samples?selected=' || r.id::text
           WHEN 'material' THEN '/materials?selected=' || r.id::text
           WHEN 'protocol_template' THEN '/templates?protocol=' || r.id::text
           ELSE '/records/' || r.id::text
         END
    FROM api.records r
   WHERE r.deleted_at IS NULL AND r.kind <> 'file'
     AND (p_ids IS NULL OR r.id = ANY (p_ids))
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_record(uuid[]) OWNER TO migrator;
--> statement-breakpoint

-- Uploaded files: the name and kind are the title, the text inside the file is
-- the low-weight body. Several versions of one file all contribute.
CREATE FUNCTION internal.search_docs_file(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'file'::text, r.id, r.workspace_id, NULL::text, NULL::uuid, r.project_id,
         r.kind, r.status, r.created_by_user_id,
         coalesce(r.tags, ARRAY[]::text[]), r.created_at, r.updated_at,
         r.archived_at IS NOT NULL, NULL::text, NULL::text,
         coalesce(f.display_name, r.title), r.identifier,
         concat_ws(' ', r.title, f.names),
         concat_ws(E'\n', f.media_types, internal.extract_jsonb_text(r.properties),
           (SELECT string_agg(concat_ws(' ', rl.target_identifier, rl.target_kind, rl.link_type), ' ')
              FROM api.record_links rl WHERE rl.source_record_id = r.id)),
         coalesce(f.text, ''),
         jsonb_strip_nulls(jsonb_build_object(
           'media_type', f.media_type, 'byte_size', f.byte_size, 'has_text', coalesce(f.text, '') <> '')),
         '/records/' || r.id::text
    FROM api.records r
    LEFT JOIN LATERAL (
      SELECT (array_agg(fo.display_name ORDER BY fo.created_at DESC))[1] AS display_name,
             string_agg(fo.display_name, ' ') AS names,
             (array_agg(fo.media_type ORDER BY fo.created_at DESC))[1] AS media_type,
             string_agg(DISTINCT fo.media_type, ' ') AS media_types,
             sum(fo.byte_size) AS byte_size,
             string_agg(fo.extracted_text, E'\n') AS text
        FROM api.file_objects fo
       WHERE fo.record_id = r.id AND fo.deleted_at IS NULL
    ) f ON true
   WHERE r.deleted_at IS NULL AND r.kind = 'file'
     AND (p_ids IS NULL OR r.id = ANY (p_ids))
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_file(uuid[]) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_docs_dataset(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'dataset'::text, d.id, d.workspace_id, NULL::text, NULL::uuid, d.primary_project_id,
         'dataset'::text, d.lifecycle, d.created_by_user_id, ARRAY[]::text[],
         d.created_at, d.updated_at, d.lifecycle = 'archived', NULL::text, NULL::text,
         d.name, coalesce(d.display_id, d.id::text), d.id::text,
         concat_ws(E'\n', d.description, d.intended_use, sd.name, sd.key,
           (SELECT string_agg(f.label, ' ' ORDER BY f.display_order)
              FROM api.dataset_schema_version_fields f
             WHERE f.schema_version_id = d.schema_version_id AND f.lifecycle = 'active')),
         ''::text,
         jsonb_strip_nulls(jsonb_build_object(
           'schema_key', sd.key, 'schema_name', sd.name, 'intended_use', d.intended_use)),
         '/datasets?dataset=' || d.id::text
    FROM api.datasets d
    JOIN api.dataset_schema_versions dsv ON dsv.id = d.schema_version_id
    JOIN api.dataset_schema_definitions sd ON sd.id = dsv.schema_id
   WHERE d.lifecycle IN ('active', 'archived')
     AND (p_ids IS NULL OR d.id = ANY (p_ids))
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_dataset(uuid[]) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_docs_sheet(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'sheet'::text, si.id, si.workspace_id,
         CASE WHEN si.notebook_record_id IS NOT NULL THEN 'record' END, si.notebook_record_id,
         si.project_id, 'sheet_instance'::text, si.lifecycle, si.created_by_user_id,
         ARRAY[]::text[], si.created_at, si.updated_at, si.lifecycle = 'archived',
         NULL::text, 'instance'::text,
         si.name, coalesce(si.display_id, si.id::text), si.id::text,
         concat_ws(E'\n', si.description,
           internal.jsonb_path_text(si.state, '$.localFields[*].label'),
           internal.jsonb_path_text(si.state, '$.localFields[*].description'),
           nb.identifier, nb.title),
         ''::text,
         jsonb_strip_nulls(jsonb_build_object('notebook', nb.identifier)),
         '/sheets/' || si.id::text
    FROM api.sheet_instances si
    LEFT JOIN api.records nb ON nb.id = si.notebook_record_id
   WHERE si.lifecycle IN ('active', 'archived')
     AND (p_ids IS NULL OR si.id = ANY (p_ids))
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_sheet(uuid[]) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_docs_template(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'template'::text, nt.id, nt.workspace_id, NULL::text, NULL::uuid, NULL::uuid,
         'notebook_template'::text, nt.lifecycle, nt.created_by_user_id, ARRAY[]::text[],
         nt.created_at, nt.updated_at, nt.lifecycle = 'retired', NULL::text, NULL::text,
         nt.name, coalesce(nt.display_id, nt.key), nt.key,
         coalesce(nt.description, ''), ''::text,
         jsonb_build_object('key', nt.key),
         '/templates?template=' || nt.id::text
    FROM api.notebook_templates nt
   WHERE nt.lifecycle IN ('active', 'retired')
     AND (p_ids IS NULL OR nt.id = ANY (p_ids))
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_template(uuid[]) OWNER TO migrator;
--> statement-breakpoint

-- A comment is found by what it says, and lands on the sheet or notebook it is
-- on. It inherits the project of that parent, and a draft experiment's
-- privacy, so it is never easier to find than the thing it is about.
CREATE FUNCTION internal.search_docs_comment(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'comment'::text, c.id, c.workspace_id,
         CASE WHEN c.sheet_instance_id IS NOT NULL THEN 'sheet'
              WHEN c.record_id IS NOT NULL THEN 'record' END,
         coalesce(c.sheet_instance_id, c.record_id),
         coalesce(si.project_id, r.project_id),
         'comment'::text, c.state, c.author_user_id, ARRAY[]::text[],
         c.created_at, c.updated_at,
         coalesce(si.lifecycle = 'archived', false) OR r.archived_at IS NOT NULL,
         CASE WHEN r.kind = 'experiment' AND r.status = 'draft' THEN r.created_by_user_id END,
         'comment'::text,
         left(c.body, 120), ''::text, NULL::text, c.body, ''::text,
         jsonb_strip_nulls(jsonb_build_object('resolved', c.resolved_at IS NOT NULL)),
         CASE WHEN c.sheet_instance_id IS NOT NULL
                THEN '/sheets/' || c.sheet_instance_id::text || '?commentId=' || c.id::text
              WHEN c.record_id IS NOT NULL THEN '/records/' || c.record_id::text
              WHEN c.revision_id IS NOT NULL THEN '/review/' || c.revision_id::text
              ELSE '/search' END
    FROM api.comments c
    LEFT JOIN api.sheet_instances si ON si.id = c.sheet_instance_id
    LEFT JOIN api.records r ON r.id = c.record_id
   WHERE p_ids IS NULL OR c.id = ANY (p_ids)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_comment(uuid[]) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_docs_project(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'project'::text, p.id, p.workspace_id, NULL::text, NULL::uuid, p.id,
         'project'::text, p.status, p.lead_user_id, ARRAY[]::text[],
         p.created_at, p.updated_at, p.archived_at IS NOT NULL, NULL::text, NULL::text,
         p.title, coalesce(p.display_id, p.key), p.key,
         concat_ws(E'\n', p.agreement_reference, p.modality, p.stage, cl.name,
           internal.extract_jsonb_text(p.custom_fields)),
         ''::text,
         jsonb_strip_nulls(jsonb_build_object(
           'key', p.key, 'modality', p.modality, 'stage', p.stage,
           'client', cl.name, 'lead', p.lead_user_id)),
         '/projects/' || p.id::text
    FROM api.projects p
    LEFT JOIN api.clients cl ON cl.id = p.client_id
   WHERE p_ids IS NULL OR p.id = ANY (p_ids)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_project(uuid[]) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_docs_pipeline(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'pipeline'::text, pd.id, pd.workspace_id, NULL::text, NULL::uuid, NULL::uuid,
         'pipeline'::text, pd.lifecycle, pd.created_by_user_id, ARRAY[]::text[],
         pd.created_at, pd.updated_at, pd.lifecycle = 'archived', NULL::text, NULL::text,
         pd.name, coalesce(pd.display_id, pd.key), pd.key,
         coalesce(pd.description, ''), ''::text,
         jsonb_build_object('key', pd.key),
         '/pipelines/' || pd.id::text
    FROM api.pipeline_definitions pd
   WHERE p_ids IS NULL OR pd.id = ANY (p_ids)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_pipeline(uuid[]) OWNER TO migrator;
--> statement-breakpoint

-- Saved chart views and saved statistics.
CREATE FUNCTION internal.search_docs_analysis(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'analysis'::text, a.id, a.workspace_id, NULL::text, NULL::uuid, NULL::uuid,
         'analysis'::text, '', a.owner_user_id, ARRAY[]::text[],
         a.created_at, a.updated_at, false, NULL::text, NULL::text,
         a.name, coalesce(a.display_id, left(a.id::text, 8)), NULL::text,
         ''::text, ''::text,
         jsonb_build_object('version', a.version),
         '/analysis/' || a.id::text
    FROM (
      SELECT av.id, av.workspace_id, av.name, av.display_id, av.owner_user_id,
             av.version, av.created_at, av.updated_at
        FROM api.analysis_views av
      UNION ALL
      SELECT ad.id, ad.workspace_id, ad.name, ad.display_id, ad.owner_user_id,
             ad.version, ad.created_at, ad.updated_at
        FROM api.analysis_definitions ad
    ) a
   WHERE p_ids IS NULL OR a.id = ANY (p_ids)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_analysis(uuid[]) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_docs_instrument(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'instrument'::text, i.id, i.workspace_id, NULL::text, NULL::uuid, NULL::uuid,
         'instrument'::text, coalesce(i.connection_status, ''), i.owner_id, ARRAY[]::text[],
         i.created_at, i.updated_at, i.retired_at IS NOT NULL, NULL::text, NULL::text,
         i.name, coalesce(i.display_id, ''), i.serial_number,
         concat_ws(E'\n', i.instrument_type, i.vendor, i.model, i.location,
           i.qualified_for, internal.extract_jsonb_text(i.custom_fields)),
         ''::text,
         jsonb_strip_nulls(jsonb_build_object(
           'instrument_type', i.instrument_type, 'vendor', i.vendor, 'model', i.model,
           'serial_number', i.serial_number, 'location', i.location)),
         '/instruments/' || i.id::text
    FROM api.instruments i
   WHERE p_ids IS NULL OR i.id = ANY (p_ids)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_instrument(uuid[]) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_docs_instrument_run(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'instrument_run'::text, r.id, r.workspace_id, 'instrument'::text, r.instrument_id,
         r.project_id, 'instrument_run'::text, r.status, r.created_by_user_id,
         coalesce(r.tags, ARRAY[]::text[]), r.created_at, r.updated_at, false,
         NULL::text, 'run'::text,
         coalesce(nullif(r.name, ''), nullif(r.protocol_name, ''), r.run_identifier, ''),
         coalesce(r.run_identifier, ''), NULL::text,
         concat_ws(E'\n', r.protocol_name, r.operator, r.error_message, r.plate_format,
           i.name, internal.extract_jsonb_text(r.custom_fields)),
         ''::text,
         jsonb_strip_nulls(jsonb_build_object(
           'instrument', i.name, 'operator', r.operator, 'protocol', r.protocol_name,
           'plate_format', r.plate_format, 'started_at', r.started_at)),
         '/instruments/' || r.instrument_id::text
    FROM api.instrument_runs r
    LEFT JOIN api.instruments i ON i.id = r.instrument_id
   WHERE p_ids IS NULL OR r.id = ANY (p_ids)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_instrument_run(uuid[]) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_docs_booking(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'booking'::text, b.id, b.workspace_id, NULL::text, NULL::uuid, b.project_id,
         'booking'::text, b.status, b.created_by_user_id, ARRAY[]::text[],
         b.created_at, b.updated_at, b.cancelled_at IS NOT NULL, NULL::text, 'booking'::text,
         b.title, coalesce(b.display_id, ''), NULL::text,
         concat_ws(E'\n', b.notes, b.location, res.name, b.linked_experiment_identifier,
           b.linked_experiment_title),
         ''::text,
         jsonb_strip_nulls(jsonb_build_object(
           'resource', res.name, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
           'location', b.location)),
         '/schedule'
    FROM api.calendar_bookings b
    LEFT JOIN api.calendar_resources res ON res.id = b.resource_id
   WHERE p_ids IS NULL OR b.id = ANY (p_ids)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_booking(uuid[]) OWNER TO migrator;
--> statement-breakpoint

-- Sites, rooms, units, shelves, racks and boxes: one type, with the place's
-- full path in the text so "freezer 3" finds the box in it.
CREATE FUNCTION internal.search_docs_storage_location(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'storage_location'::text, l.id, l.workspace_id, NULL::text, NULL::uuid, NULL::uuid,
         l.level, '', NULL::text, ARRAY[]::text[], l.created_at, l.updated_at,
         l.archived_at IS NOT NULL, NULL::text, NULL::text,
         l.name, coalesce(l.code, ''), NULL::text,
         concat_ws(E'\n', l.path, l.description, l.unit_type),
         ''::text,
         jsonb_strip_nulls(jsonb_build_object(
           'level', l.level, 'code', l.code, 'path', l.path,
           'temperature_min_c', l.tmin, 'temperature_max_c', l.tmax)),
         '/settings/storage'
    FROM (
      SELECT s.id, s.workspace_id, 'site'::text AS level, s.name, s.code, s.description,
             NULL::text AS unit_type, NULL::text AS path, s.temperature_min_c AS tmin,
             s.temperature_max_c AS tmax, s.created_at, s.updated_at, s.archived_at
        FROM api.storage_sites s
      UNION ALL
      SELECT r.id, r.workspace_id, 'room', r.name, r.code, NULL, NULL, st.name,
             r.temperature_min_c, r.temperature_max_c, r.created_at, r.updated_at, r.archived_at
        FROM api.storage_rooms r JOIN api.storage_sites st ON st.id = r.site_id
      UNION ALL
      SELECT u.id, u.workspace_id, 'unit', u.name, u.code, NULL, u.unit_type,
             concat_ws(' > ', st.name, r.name),
             u.temperature_min_c, u.temperature_max_c, u.created_at, u.updated_at, u.archived_at
        FROM api.storage_units u
        JOIN api.storage_rooms r ON r.id = u.room_id
        JOIN api.storage_sites st ON st.id = r.site_id
      UNION ALL
      SELECT sh.id, sh.workspace_id, 'shelf', sh.name, NULL, NULL, NULL,
             concat_ws(' > ', st.name, r.name, u.name),
             NULL, NULL, sh.created_at, sh.updated_at, sh.archived_at
        FROM api.storage_shelves sh
        JOIN api.storage_units u ON u.id = sh.unit_id
        JOIN api.storage_rooms r ON r.id = u.room_id
        JOIN api.storage_sites st ON st.id = r.site_id
      UNION ALL
      SELECT rk.id, rk.workspace_id, 'rack', rk.name, NULL, NULL, NULL,
             concat_ws(' > ', st.name, r.name, u.name, sh.name),
             NULL, NULL, rk.created_at, rk.updated_at, rk.archived_at
        FROM api.storage_racks rk
        JOIN api.storage_shelves sh ON sh.id = rk.shelf_id
        JOIN api.storage_units u ON u.id = sh.unit_id
        JOIN api.storage_rooms r ON r.id = u.room_id
        JOIN api.storage_sites st ON st.id = r.site_id
      UNION ALL
      SELECT bx.id, bx.workspace_id, 'box', bx.name, bx.code, NULL, NULL,
             concat_ws(' > ', st.name, r.name, u.name, sh.name, rk.name),
             NULL, NULL, bx.created_at, bx.updated_at, bx.archived_at
        FROM api.storage_boxes bx
        JOIN api.storage_racks rk ON rk.id = bx.rack_id
        JOIN api.storage_shelves sh ON sh.id = rk.shelf_id
        JOIN api.storage_units u ON u.id = sh.unit_id
        JOIN api.storage_rooms r ON r.id = u.room_id
        JOIN api.storage_sites st ON st.id = r.site_id
    ) l
   WHERE p_ids IS NULL OR l.id = ANY (p_ids)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_storage_location(uuid[]) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_docs_client(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'client'::text, c.id, c.workspace_id, NULL::text, NULL::uuid, NULL::uuid,
         'client'::text, '', c.created_by_user_id, ARRAY[]::text[],
         c.created_at, c.updated_at, c.archived_at IS NOT NULL, NULL::text, NULL::text,
         c.name, coalesce(c.code, ''), NULL::text, ''::text, ''::text,
         jsonb_strip_nulls(jsonb_build_object('code', c.code)),
         '/settings/clients'
    FROM api.clients c
   WHERE p_ids IS NULL OR c.id = ANY (p_ids)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_client(uuid[]) OWNER TO migrator;
--> statement-breakpoint

-- A step the author did differently from the protocol, with what the protocol
-- said and what was done. It lands on the notebook it was recorded in.
CREATE FUNCTION internal.search_docs_deviation(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'deviation'::text, d.id, d.workspace_id, 'record'::text, d.record_id, r.project_id,
         'deviation'::text, CASE WHEN nullif(btrim(d.reason), '') IS NULL THEN 'unexplained' ELSE 'explained' END,
         d.created_by_user_id, ARRAY[]::text[], d.created_at,
         coalesce(d.reason_at, d.created_at), r.archived_at IS NOT NULL, NULL::text, NULL::text,
         left(coalesce(nullif(btrim(d.reason), ''), nullif(btrim(d.recorded_text), ''), d.frozen_text), 120),
         r.identifier, NULL::text,
         concat_ws(E'\n', d.frozen_text, d.recorded_text, d.reason, r.title),
         ''::text,
         jsonb_strip_nulls(jsonb_build_object('notebook', r.identifier)),
         '/records/' || d.record_id::text
    FROM api.protocol_deviations d
    JOIN api.records r ON r.id = d.record_id
   WHERE r.deleted_at IS NULL AND (p_ids IS NULL OR d.id = ANY (p_ids))
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_deviation(uuid[]) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_docs_parser(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'parser'::text, p.id, p.workspace_id,
         CASE WHEN p.instrument_id IS NOT NULL THEN 'instrument' END, p.instrument_id,
         NULL::uuid, 'parser'::text, '', p.created_by_user_id, ARRAY[]::text[],
         p.created_at, p.updated_at, false, NULL::text, NULL::text,
         p.name, p.key, NULL::text,
         concat_ws(E'\n', p.format, i.name), ''::text,
         jsonb_strip_nulls(jsonb_build_object('format', p.format, 'key', p.key, 'instrument', i.name)),
         CASE WHEN p.instrument_id IS NOT NULL
              THEN '/instruments/' || p.instrument_id::text ELSE '/settings/integrations' END
    FROM api.parsers p
    LEFT JOIN api.instruments i ON i.id = p.instrument_id
   WHERE p_ids IS NULL OR p.id = ANY (p_ids)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_parser(uuid[]) OWNER TO migrator;
--> statement-breakpoint

-- Workspace members: name and role only. Email addresses are not indexed, so
-- search cannot be used to look up who has which address.
CREATE FUNCTION internal.search_docs_person(p_ids uuid[] DEFAULT NULL)
    RETURNS SETOF internal.search_doc_input
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'person'::text, m.id, m.workspace_id, NULL::text, NULL::uuid, NULL::uuid,
         'person'::text, CASE WHEN m.suspended_at IS NOT NULL THEN 'suspended' ELSE 'active' END,
         NULL::text, ARRAY[]::text[], m.created_at, greatest(m.updated_at, u."updatedAt"),
         m.suspended_at IS NOT NULL, NULL::text, NULL::text,
         coalesce(nullif(u.name, ''), m.username, m.user_id), coalesce(m.username, ''), NULL::text,
         replace(m.role, '_', ' '), ''::text,
         jsonb_build_object('role', m.role),
         '/settings/members'
    FROM api.workspace_memberships m
    JOIN internal."user" u ON u.id = m.user_id
   WHERE p_ids IS NULL OR m.id = ANY (p_ids)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_docs_person(uuid[]) OWNER TO migrator;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Writing the index.
-- ---------------------------------------------------------------------------

-- Rebuild the rows for some objects of one type (all of them when p_ids is
-- NULL): rows the builder no longer returns are deleted, the rest upserted.
CREATE FUNCTION internal.search_reindex(p_type text, p_ids uuid[] DEFAULT NULL) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_type NOT IN ('record', 'file', 'dataset', 'sheet', 'template', 'comment',
      'project', 'pipeline', 'analysis', 'instrument', 'instrument_run', 'booking',
      'storage_location', 'client', 'deviation', 'parser', 'person') THEN
    RAISE EXCEPTION 'unknown search object type %', p_type USING ERRCODE = '22023';
  END IF;
  EXECUTE format($q$
    WITH built AS MATERIALIZED (SELECT * FROM internal.%1$I($1)),
    gone AS (
      DELETE FROM api.search_documents d
       WHERE d.object_type = $2
         AND ($1 IS NULL OR d.object_id = ANY ($1))
         AND NOT EXISTS (SELECT 1 FROM built b WHERE b.object_id = d.object_id)
    ),
    up AS (
      INSERT INTO api.search_documents AS d (
        object_type, object_id, workspace_id, parent_type, parent_id, project_id, kind,
        status, owner_user_id, tags, created_at, updated_at, archived, private_to_user_id,
        access_kind, title, identifier, body, fields, deep_link, tsv, head_tsv)
      SELECT b.object_type, b.object_id, b.workspace_id, b.parent_type, b.parent_id,
             b.project_id, coalesce(b.kind, ''), coalesce(b.status, ''), b.owner_user_id,
             coalesce(b.tags, ARRAY[]::text[]), b.created_at, b.updated_at,
             coalesce(b.archived, false), b.private_to_user_id, b.access_kind,
             coalesce(b.title, ''), coalesce(b.identifier, ''),
             left(concat_ws(E'\n', nullif(left(b.body, 250000), ''), nullif(left(b.file_text, 250000), '')), 500000),
             coalesce(b.fields, '{}'::jsonb), coalesce(b.deep_link, ''),
             t.tsv, ts_filter(t.tsv, '{a,b}')
        FROM built b
        CROSS JOIN LATERAL (
          SELECT internal.search_make_tsv(b.title, b.identifier, b.aliases, b.tags, b.status,
                   b.kind, b.body, b.file_text) AS tsv
        ) t
      ON CONFLICT (object_type, object_id) DO UPDATE SET
        workspace_id = EXCLUDED.workspace_id, parent_type = EXCLUDED.parent_type,
        parent_id = EXCLUDED.parent_id, project_id = EXCLUDED.project_id,
        kind = EXCLUDED.kind, status = EXCLUDED.status,
        owner_user_id = EXCLUDED.owner_user_id, tags = EXCLUDED.tags,
        created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at,
        archived = EXCLUDED.archived, private_to_user_id = EXCLUDED.private_to_user_id,
        access_kind = EXCLUDED.access_kind, title = EXCLUDED.title,
        identifier = EXCLUDED.identifier, body = EXCLUDED.body, fields = EXCLUDED.fields,
        deep_link = EXCLUDED.deep_link, tsv = EXCLUDED.tsv, head_tsv = EXCLUDED.head_tsv
      RETURNING 1
    )
    SELECT count(*)::integer FROM up
  $q$, 'search_docs_' || p_type) INTO v_n USING p_ids, p_type;
  RETURN v_n;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_reindex(text, uuid[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.search_reindex(text, uuid[]) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.search_reindex(p_type text, p_id uuid) RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$ SELECT internal.search_reindex(p_type, ARRAY[p_id]) $$;
--> statement-breakpoint
ALTER FUNCTION internal.search_reindex(text, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.search_reindex(text, uuid) FROM PUBLIC;
--> statement-breakpoint

-- Rebuild everything. Safe to run at any time.
CREATE FUNCTION internal.search_reindex_all() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_type text;
  v_total integer := 0;
BEGIN
  FOREACH v_type IN ARRAY ARRAY['record', 'file', 'dataset', 'sheet', 'template', 'comment',
      'project', 'pipeline', 'analysis', 'instrument', 'instrument_run', 'booking',
      'storage_location', 'client', 'deviation', 'parser', 'person'] LOOP
    v_total := v_total + internal.search_reindex(v_type, NULL::uuid[]);
  END LOOP;
  RETURN v_total;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_reindex_all() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.search_reindex_all() FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Keeping it current. One statement-level trigger function serves every source
-- table: it collects the distinct ids a statement touched (from the transition
-- tables) and reindexes them once, so inserting 500 blocks costs one rebuild of
-- the notebook, not 500.
--
--   TG_ARGV[0]  column that holds the indexed object's id
--   TG_ARGV[1]  object types to reindex, comma separated
--   TG_ARGV[2]  columns whose change renames the object, comma separated
--               (notebooks that mention it are then reindexed too)
--   TG_ARGV[3]  column to look the renamed object up by in those notebooks'
--               blocks (defaults to TG_ARGV[0])
--
-- A failure here must not fail the write that caused it: the index would be
-- stale until the next change, whereas a refused save loses someone's work. It
-- is reported as a warning, and internal.search_reindex_all() repairs it.
-- ---------------------------------------------------------------------------
CREATE FUNCTION internal.search_dependent_records(p_ids uuid[]) RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce(array_agg(DISTINCT x.record_id), ARRAY[]::uuid[])
    FROM (
      -- A block names what it points at by uuid anywhere in its payload.
      SELECT b.record_id
        FROM api.blocks b
       WHERE EXISTS (SELECT 1 FROM unnest(p_ids) i WHERE b.payload::text LIKE '%' || i::text || '%')
      UNION
      SELECT rl.source_record_id
        FROM api.record_links rl
       WHERE rl.target_record_id = ANY (p_ids)
    ) x
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_dependent_records(uuid[]) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_sync_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_idcol text := TG_ARGV[0];
  v_types text[] := string_to_array(TG_ARGV[1], ',');
  v_rename text[] := string_to_array(coalesce(TG_ARGV[2], ''), ',');
  v_depcol text := coalesce(nullif(TG_ARGV[3], ''), TG_ARGV[0]);
  v_ids uuid[];
  v_renamed uuid[];
  v_dependents uuid[];
  v_cond text;
  v_type text;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      EXECUTE format('SELECT array_agg(DISTINCT %I) FROM new_rows', v_idcol) INTO v_ids;
    ELSIF TG_OP = 'DELETE' THEN
      EXECUTE format('SELECT array_agg(DISTINCT %I) FROM old_rows', v_idcol) INTO v_ids;
    ELSE
      EXECUTE format(
        'SELECT array_agg(DISTINCT x) FROM (SELECT %1$I AS x FROM new_rows UNION SELECT %1$I FROM old_rows) s',
        v_idcol) INTO v_ids;
    END IF;
    IF v_ids IS NULL THEN RETURN NULL; END IF;

    FOREACH v_type IN ARRAY v_types LOOP
      PERFORM internal.search_reindex(v_type, v_ids);
    END LOOP;

    IF TG_OP <> 'INSERT' AND cardinality(v_rename) > 0 AND v_rename[1] <> '' THEN
      SELECT string_agg(format('(to_jsonb(n) -> %1$L) IS DISTINCT FROM (to_jsonb(o) -> %1$L)', c), ' OR ')
        INTO v_cond FROM unnest(v_rename) c;
      IF TG_OP = 'UPDATE' THEN
        EXECUTE format(
          'SELECT array_agg(DISTINCT n.%1$I) FROM new_rows n JOIN old_rows o ON o.%2$I = n.%2$I WHERE %3$s',
          v_depcol, v_idcol, v_cond) INTO v_renamed;
      ELSE
        EXECUTE format('SELECT array_agg(DISTINCT %I) FROM old_rows', v_depcol) INTO v_renamed;
      END IF;
      IF v_renamed IS NOT NULL THEN
        v_dependents := internal.search_dependent_records(v_renamed);
        IF cardinality(v_dependents) > 0 THEN
          PERFORM internal.search_reindex('record', v_dependents);
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'search index update failed on %.% (%): %', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_sync_trigger() OWNER TO migrator;
--> statement-breakpoint

-- A member's name lives on the user row, not the membership.
CREATE FUNCTION internal.search_sync_user_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ids uuid[];
BEGIN
  BEGIN
    SELECT array_agg(m.id) INTO v_ids
      FROM api.workspace_memberships m
     WHERE m.user_id IN (SELECT n.id FROM new_rows n JOIN old_rows o ON o.id = n.id
                          WHERE n.name IS DISTINCT FROM o.name);
    IF v_ids IS NOT NULL THEN
      PERFORM internal.search_reindex('person', v_ids);
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'search index update failed for a user rename: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_sync_user_trigger() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER search_sync_au AFTER UPDATE ON internal."user"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION internal.search_sync_user_trigger();
--> statement-breakpoint

-- Attach the statement-level triggers (insert, update, delete) to each source.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('records',            'id',               'record,file',      'title,identifier',          ''),
      ('blocks',             'record_id',        'record',           '',                          ''),
      ('file_objects',       'record_id',        'file',             'display_name,extracted_text', ''),
      ('record_links',       'source_record_id', 'record',           '',                          ''),
      ('record_aliases',     'record_id',        'record',           '',                          ''),
      ('datasets',           'id',               'dataset',          'name,display_id',           ''),
      ('sheet_instances',    'id',               'sheet',            'name,display_id',           ''),
      ('notebook_templates', 'id',               'template',         '',                          ''),
      ('comments',           'id',               'comment',          '',                          ''),
      ('projects',           'id',               'project',          '',                          ''),
      ('pipeline_definitions','id',              'pipeline',         '',                          ''),
      ('analysis_views',     'id',               'analysis',         '',                          ''),
      ('analysis_definitions','id',              'analysis',         '',                          ''),
      ('instruments',        'id',               'instrument',       '',                          ''),
      ('instrument_runs',    'id',               'instrument_run',   '',                          ''),
      ('calendar_bookings',  'id',               'booking',          '',                          ''),
      ('storage_sites',      'id',               'storage_location', '',                          ''),
      ('storage_rooms',      'id',               'storage_location', '',                          ''),
      ('storage_units',      'id',               'storage_location', '',                          ''),
      ('storage_shelves',    'id',               'storage_location', '',                          ''),
      ('storage_racks',      'id',               'storage_location', '',                          ''),
      ('storage_boxes',      'id',               'storage_location', '',                          ''),
      ('clients',            'id',               'client',           '',                          ''),
      ('protocol_deviations','id',               'deviation',        '',                          ''),
      ('parsers',            'id',               'parser',           '',                          ''),
      ('workspace_memberships','id',             'person',           '',                          '')
    ) AS t(tbl, idcol, types, rename_cols, depcol)
  LOOP
    EXECUTE format(
      'CREATE TRIGGER search_sync_ai AFTER INSERT ON api.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION internal.search_sync_trigger(%L, %L, %L, %L)',
      r.tbl, r.idcol, r.types, r.rename_cols, r.depcol);
    EXECUTE format(
      'CREATE TRIGGER search_sync_au AFTER UPDATE ON api.%I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION internal.search_sync_trigger(%L, %L, %L, %L)',
      r.tbl, r.idcol, r.types, r.rename_cols, r.depcol);
    EXECUTE format(
      'CREATE TRIGGER search_sync_ad AFTER DELETE ON api.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION internal.search_sync_trigger(%L, %L, %L, %L)',
      r.tbl, r.idcol, r.types, r.rename_cols, r.depcol);
  END LOOP;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The query.
-- ---------------------------------------------------------------------------

-- websearch_to_tsquery reads "quoted phrases", -excluded words and OR. On top
-- of it, the word being typed (the last bare word) also matches as a prefix, so
-- "chrom" finds chromatography.
CREATE FUNCTION internal.search_tsquery(p_text text) RETURNS tsquery
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_text text := btrim(coalesce(p_text, ''));
  v_q tsquery;
  v_last text;
  v_prefix tsquery;
BEGIN
  v_q := websearch_to_tsquery('english', v_text);
  v_last := substring(v_text from '(?:^|\s)([[:alnum:]]{2,})$');
  IF v_last IS NOT NULL AND lower(v_last) <> 'or' AND numnode(v_q) > 0 THEN
    v_prefix := to_tsquery('english', quote_literal(v_last) || ':*');
    IF numnode(v_prefix) > 0 THEN
      v_q := ts_rewrite(v_q, to_tsquery('english', quote_literal(v_last)), v_prefix);
    END IF;
  END IF;
  RETURN v_q;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_tsquery(text) OWNER TO migrator;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.search_tsquery(text) TO authenticated, api_client;
--> statement-breakpoint

-- The query the way the matcher needs it: the full tsquery; the identifier-like
-- terms in it (anything with a digit or a hyphen inside a word: DS-03, 0145),
-- which also match by substring on the name and identifier; and the query with
-- those terms taken out, which must still match in text.
CREATE FUNCTION internal.search_parse_query(p_query text, OUT tsq tsquery, OUT id_tokens text[], OUT rest tsquery)
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_text text := btrim(coalesce(p_query, ''));
  v_tok text;
  v_rest text[] := ARRAY[]::text[];
BEGIN
  id_tokens := ARRAY[]::text[];
  IF v_text = '' THEN
    tsq := ''::tsquery;
    rest := ''::tsquery;
    RETURN;
  END IF;
  FOR v_tok IN SELECT t FROM regexp_split_to_table(v_text, '\s+') t LOOP
    IF v_tok ~ '^[[:alnum:]_]+(-[[:alnum:]_]+)*$' AND v_tok ~ '[0-9-]' THEN
      id_tokens := id_tokens || v_tok;
    ELSE
      v_rest := v_rest || v_tok;
    END IF;
  END LOOP;
  tsq := internal.search_tsquery(v_text);
  rest := internal.search_tsquery(array_to_string(v_rest, ' '));
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_parse_query(text) OWNER TO migrator;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.search_parse_query(text) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The filter tree. The sheetbase-shared GroupNode JSON:
--   {type:'group', combinator:'AND'|'OR'|'NOT', children:[...]}
--   {type:'condition', field, operator, value}
-- NOT matches when none of its children match. Compiled to a predicate over
-- the alias s, built only from fixed text and quote_literal/quote_ident'd
-- values, so nothing a caller sends is ever executable. Anything unknown is
-- rejected with 22023.
-- ---------------------------------------------------------------------------
CREATE FUNCTION internal.search_filter_scalar(p_value jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) IN ('object', 'array', 'null') THEN
    RAISE EXCEPTION 'filter value must be a single value' USING ERRCODE = '22023';
  END IF;
  RETURN p_value #>> '{}';
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_filter_scalar(jsonb) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_filter_list(p_value jsonb) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_item jsonb;
  v_out text[] := ARRAY[]::text[];
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'array' THEN
    RAISE EXCEPTION 'filter value must be a list' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_value) > 200 THEN
    RAISE EXCEPTION 'filter list is too long' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_value) LOOP
    v_out := v_out || internal.search_filter_scalar(v_item);
  END LOOP;
  RETURN v_out;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_filter_list(jsonb) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_like_escape(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$ SELECT replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_') $$;
--> statement-breakpoint
ALTER FUNCTION internal.search_like_escape(text) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_compile_condition(p_field text, p_op text, p_value jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_kind text;
  v_expr text;
  v_key text;
  v_j text;
  v_t text;
  v1 text;
  v2 text;
  v_list text[];
  v_pair text[];
  v_days integer;
  v_lit text;
BEGIN
  IF p_op IS NULL OR p_op NOT IN ('eq', 'neq', 'in', 'contains', 'startsWith', 'endsWith',
      'isNull', 'notNull', 'gt', 'gte', 'lt', 'lte', 'between', 'withinLastDays') THEN
    RAISE EXCEPTION 'unknown filter operator %', coalesce(p_op, '') USING ERRCODE = '22023';
  END IF;

  CASE p_field
    WHEN 'type' THEN v_kind := 'text'; v_expr := 's.object_type';
    WHEN 'kind' THEN v_kind := 'text'; v_expr := 's.kind';
    WHEN 'status' THEN v_kind := 'text'; v_expr := 's.status';
    WHEN 'project' THEN v_kind := 'text'; v_expr := 's.project_id::text';
    WHEN 'owner' THEN v_kind := 'text'; v_expr := 's.owner_user_id';
    WHEN 'created' THEN v_kind := 'time'; v_expr := 's.created_at';
    WHEN 'updated' THEN v_kind := 'time'; v_expr := 's.updated_at';
    WHEN 'archived' THEN v_kind := 'bool'; v_expr := 's.archived';
    WHEN 'tags' THEN v_kind := 'tags'; v_expr := 's.tags';
    ELSE
      IF p_field ~ '^fields\.[A-Za-z0-9_.:-]{1,64}$' THEN
        v_kind := 'field';
        v_key := substr(p_field, 8);
        v_j := 's.fields -> ' || quote_literal(v_key);
        v_t := 's.fields ->> ' || quote_literal(v_key);
      ELSE
        RAISE EXCEPTION 'unknown filter field %', coalesce(p_field, '') USING ERRCODE = '22023';
      END IF;
  END CASE;

  -- Operators that read no value.
  IF p_op = 'isNull' THEN
    RETURN CASE v_kind
      WHEN 'text' THEN format('(%1$s IS NULL OR %1$s = %2$L)', v_expr, '')
      WHEN 'time' THEN format('%s IS NULL', v_expr)
      WHEN 'bool' THEN 'false'
      WHEN 'tags' THEN 'cardinality(s.tags) = 0'
      ELSE format('((%1$s) IS NULL OR jsonb_typeof(%1$s) = %2$L)', v_j, 'null') END;
  ELSIF p_op = 'notNull' THEN
    RETURN CASE v_kind
      WHEN 'text' THEN format('(%1$s IS NOT NULL AND %1$s <> %2$L)', v_expr, '')
      WHEN 'time' THEN format('%s IS NOT NULL', v_expr)
      WHEN 'bool' THEN 'true'
      WHEN 'tags' THEN 'cardinality(s.tags) > 0'
      ELSE format('((%1$s) IS NOT NULL AND jsonb_typeof(%1$s) <> %2$L)', v_j, 'null') END;
  END IF;

  IF v_kind = 'text' THEN
    CASE p_op
      WHEN 'eq' THEN RETURN format('%s = %L', v_expr, internal.search_filter_scalar(p_value));
      WHEN 'neq' THEN RETURN format('%s IS DISTINCT FROM %L', v_expr, internal.search_filter_scalar(p_value));
      WHEN 'in' THEN
        v_list := internal.search_filter_list(p_value);
        IF cardinality(v_list) = 0 THEN RETURN 'false'; END IF;
        RETURN format('%s = ANY (%L::text[])', v_expr, v_list);
      WHEN 'contains' THEN RETURN format('%s ILIKE %L', v_expr, '%' || internal.search_like_escape(internal.search_filter_scalar(p_value)) || '%');
      WHEN 'startsWith' THEN RETURN format('%s ILIKE %L', v_expr, internal.search_like_escape(internal.search_filter_scalar(p_value)) || '%');
      WHEN 'endsWith' THEN RETURN format('%s ILIKE %L', v_expr, '%' || internal.search_like_escape(internal.search_filter_scalar(p_value)));
      WHEN 'gt' THEN RETURN format('%s > %L', v_expr, internal.search_filter_scalar(p_value));
      WHEN 'gte' THEN RETURN format('%s >= %L', v_expr, internal.search_filter_scalar(p_value));
      WHEN 'lt' THEN RETURN format('%s < %L', v_expr, internal.search_filter_scalar(p_value));
      WHEN 'lte' THEN RETURN format('%s <= %L', v_expr, internal.search_filter_scalar(p_value));
      WHEN 'between' THEN
        v_pair := internal.search_filter_list(p_value);
        IF cardinality(v_pair) <> 2 THEN RAISE EXCEPTION 'between needs two values' USING ERRCODE = '22023'; END IF;
        RETURN format('%s BETWEEN %L AND %L', v_expr, v_pair[1], v_pair[2]);
      ELSE RAISE EXCEPTION 'operator % does not apply to %', p_op, p_field USING ERRCODE = '22023';
    END CASE;

  ELSIF v_kind = 'time' THEN
    IF p_op = 'withinLastDays' THEN
      v_days := (internal.search_filter_scalar(p_value))::integer;
      IF v_days < 1 OR v_days > 36500 THEN
        RAISE EXCEPTION 'withinLastDays needs a number of days' USING ERRCODE = '22023';
      END IF;
      -- Calendar days, inclusive of today (UTC), as in sheetbase-shared.
      RETURN format('(%s AT TIME ZONE %L)::date BETWEEN ((now() AT TIME ZONE %L)::date - %s) AND (now() AT TIME ZONE %L)::date',
        v_expr, 'UTC', 'UTC', v_days - 1, 'UTC');
    END IF;
    IF p_op = 'between' THEN
      v_pair := internal.search_filter_list(p_value);
      IF cardinality(v_pair) <> 2 THEN RAISE EXCEPTION 'between needs two values' USING ERRCODE = '22023'; END IF;
      RETURN '(' || internal.search_compile_condition(p_field, 'gte', to_jsonb(v_pair[1]))
        || ' AND ' || internal.search_compile_condition(p_field, 'lte', to_jsonb(v_pair[2])) || ')';
    END IF;
    v1 := internal.search_filter_scalar(p_value);
    IF NOT pg_input_is_valid(v1, 'timestamptz') THEN
      RAISE EXCEPTION 'not a date: %', v1 USING ERRCODE = '22023';
    END IF;
    -- A bare date means the whole day (UTC).
    IF v1 ~ '^\d{4}-\d{2}-\d{2}$' THEN
      CASE p_op
        WHEN 'eq' THEN RETURN format('(%s AT TIME ZONE %L)::date = %L::date', v_expr, 'UTC', v1);
        WHEN 'gt' THEN RETURN format('%s >= ((%L::date + 1)::timestamp AT TIME ZONE %L)', v_expr, v1, 'UTC');
        WHEN 'gte' THEN RETURN format('%s >= (%L::date::timestamp AT TIME ZONE %L)', v_expr, v1, 'UTC');
        WHEN 'lt' THEN RETURN format('%s < (%L::date::timestamp AT TIME ZONE %L)', v_expr, v1, 'UTC');
        WHEN 'lte' THEN RETURN format('%s < ((%L::date + 1)::timestamp AT TIME ZONE %L)', v_expr, v1, 'UTC');
        ELSE RAISE EXCEPTION 'operator % does not apply to %', p_op, p_field USING ERRCODE = '22023';
      END CASE;
    END IF;
    CASE p_op
      WHEN 'eq' THEN RETURN format('%s = %L::timestamptz', v_expr, v1);
      WHEN 'gt' THEN RETURN format('%s > %L::timestamptz', v_expr, v1);
      WHEN 'gte' THEN RETURN format('%s >= %L::timestamptz', v_expr, v1);
      WHEN 'lt' THEN RETURN format('%s < %L::timestamptz', v_expr, v1);
      WHEN 'lte' THEN RETURN format('%s <= %L::timestamptz', v_expr, v1);
      ELSE RAISE EXCEPTION 'operator % does not apply to %', p_op, p_field USING ERRCODE = '22023';
    END CASE;

  ELSIF v_kind = 'bool' THEN
    v1 := lower(internal.search_filter_scalar(p_value));
    IF v1 NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'archived is true or false' USING ERRCODE = '22023';
    END IF;
    CASE p_op
      WHEN 'eq' THEN RETURN format('%s = %s', v_expr, v1);
      WHEN 'neq' THEN RETURN format('%s <> %s', v_expr, v1);
      ELSE RAISE EXCEPTION 'operator % does not apply to %', p_op, p_field USING ERRCODE = '22023';
    END CASE;

  ELSIF v_kind = 'tags' THEN
    CASE p_op
      WHEN 'eq' THEN RETURN format('s.tags @> ARRAY[%L]::text[]', internal.search_filter_scalar(p_value));
      WHEN 'neq' THEN RETURN format('NOT (s.tags @> ARRAY[%L]::text[])', internal.search_filter_scalar(p_value));
      WHEN 'in' THEN
        v_list := internal.search_filter_list(p_value);
        IF cardinality(v_list) = 0 THEN RETURN 'false'; END IF;
        RETURN format('s.tags && %L::text[]', v_list);
      WHEN 'contains' THEN RETURN format('EXISTS (SELECT 1 FROM unnest(s.tags) tg WHERE tg ILIKE %L)', '%' || internal.search_like_escape(internal.search_filter_scalar(p_value)) || '%');
      WHEN 'startsWith' THEN RETURN format('EXISTS (SELECT 1 FROM unnest(s.tags) tg WHERE tg ILIKE %L)', internal.search_like_escape(internal.search_filter_scalar(p_value)) || '%');
      WHEN 'endsWith' THEN RETURN format('EXISTS (SELECT 1 FROM unnest(s.tags) tg WHERE tg ILIKE %L)', '%' || internal.search_like_escape(internal.search_filter_scalar(p_value)));
      ELSE RAISE EXCEPTION 'operator % does not apply to tags', p_op USING ERRCODE = '22023';
    END CASE;

  ELSE
    -- fields.<key>: compared as JSON, so numbers compare as numbers and a
    -- value of another type simply does not match instead of raising.
    CASE p_op
      WHEN 'eq', 'neq' THEN
        IF p_value IS NOT NULL AND jsonb_typeof(p_value) IN ('number', 'boolean') THEN
          v_lit := format('(%s) %s %L::jsonb', v_j, CASE p_op WHEN 'eq' THEN '=' ELSE 'IS DISTINCT FROM' END, p_value::text);
        ELSE
          v_lit := format('(%s) %s %L', v_t, CASE p_op WHEN 'eq' THEN '=' ELSE 'IS DISTINCT FROM' END, internal.search_filter_scalar(p_value));
        END IF;
        RETURN v_lit;
      WHEN 'in' THEN
        v_list := internal.search_filter_list(p_value);
        IF cardinality(v_list) = 0 THEN RETURN 'false'; END IF;
        RETURN format('(%s) = ANY (%L::text[])', v_t, v_list);
      WHEN 'contains' THEN RETURN format('(%s) ILIKE %L', v_t, '%' || internal.search_like_escape(internal.search_filter_scalar(p_value)) || '%');
      WHEN 'startsWith' THEN RETURN format('(%s) ILIKE %L', v_t, internal.search_like_escape(internal.search_filter_scalar(p_value)) || '%');
      WHEN 'endsWith' THEN RETURN format('(%s) ILIKE %L', v_t, '%' || internal.search_like_escape(internal.search_filter_scalar(p_value)));
      WHEN 'gt', 'gte', 'lt', 'lte' THEN
        IF p_value IS NULL OR jsonb_typeof(p_value) NOT IN ('string', 'number') THEN
          RAISE EXCEPTION 'filter value must be a single value' USING ERRCODE = '22023';
        END IF;
        RETURN format('(%s) %s %L::jsonb', v_j,
          CASE p_op WHEN 'gt' THEN '>' WHEN 'gte' THEN '>=' WHEN 'lt' THEN '<' ELSE '<=' END, p_value::text);
      WHEN 'between' THEN
        IF p_value IS NULL OR jsonb_typeof(p_value) <> 'array' OR jsonb_array_length(p_value) <> 2 THEN
          RAISE EXCEPTION 'between needs two values' USING ERRCODE = '22023';
        END IF;
        RETURN format('(%s) BETWEEN %L::jsonb AND %L::jsonb', v_j, (p_value -> 0)::text, (p_value -> 1)::text);
      WHEN 'withinLastDays' THEN
        v_days := (internal.search_filter_scalar(p_value))::integer;
        IF v_days < 1 OR v_days > 36500 THEN
          RAISE EXCEPTION 'withinLastDays needs a number of days' USING ERRCODE = '22023';
        END IF;
        RETURN format('(CASE WHEN pg_input_is_valid(%1$s, %2$L) THEN (%1$s)::timestamptz AT TIME ZONE %3$L >= ((now() AT TIME ZONE %3$L)::date - %4$s) ELSE false END)',
          v_t, 'timestamptz', 'UTC', v_days - 1);
      ELSE RAISE EXCEPTION 'operator % does not apply to %', p_op, p_field USING ERRCODE = '22023';
    END CASE;
  END IF;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_compile_condition(text, text, jsonb) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.search_compile_node(p_node jsonb, p_depth integer) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_child jsonb;
  v_parts text[] := ARRAY[]::text[];
  v_part text;
  v_comb text;
BEGIN
  IF p_node IS NULL OR jsonb_typeof(p_node) <> 'object' THEN
    RAISE EXCEPTION 'filter node must be an object' USING ERRCODE = '22023';
  END IF;
  CASE p_node ->> 'type'
    WHEN 'condition' THEN
      RETURN internal.search_compile_condition(p_node ->> 'field', p_node ->> 'operator', p_node -> 'value');
    WHEN 'group' THEN
      IF p_depth > 4 THEN
        RAISE EXCEPTION 'filter is nested too deeply' USING ERRCODE = '22023';
      END IF;
      v_comb := coalesce(p_node ->> 'combinator', 'AND');
      IF v_comb NOT IN ('AND', 'OR', 'NOT') THEN
        RAISE EXCEPTION 'unknown filter combinator %', v_comb USING ERRCODE = '22023';
      END IF;
      IF p_node -> 'children' IS NOT NULL AND jsonb_typeof(p_node -> 'children') <> 'array' THEN
        RAISE EXCEPTION 'filter children must be a list' USING ERRCODE = '22023';
      END IF;
      FOR v_child IN SELECT * FROM jsonb_array_elements(coalesce(p_node -> 'children', '[]'::jsonb)) LOOP
        v_part := internal.search_compile_node(v_child, p_depth + 1);
        IF v_part IS NOT NULL THEN v_parts := v_parts || v_part; END IF;
      END LOOP;
      -- An empty group matches everything, so a half-built filter narrows nothing.
      IF cardinality(v_parts) = 0 THEN RETURN NULL; END IF;
      RETURN CASE v_comb
        WHEN 'AND' THEN '(' || array_to_string(v_parts, ' AND ') || ')'
        WHEN 'OR' THEN '(' || array_to_string(v_parts, ' OR ') || ')'
        ELSE '(NOT (' || array_to_string(v_parts, ' OR ') || '))' END;
    ELSE
      RAISE EXCEPTION 'filter node type must be group or condition' USING ERRCODE = '22023';
  END CASE;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_compile_node(jsonb, integer) OWNER TO migrator;
--> statement-breakpoint

-- The predicate over alias s for a whole filter tree: at most 4 groups deep and
-- 50 conditions. NULL or an empty tree is 'true'.
CREATE FUNCTION internal.search_compile_filter(p_filter jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_conditions integer;
BEGIN
  IF p_filter IS NULL OR p_filter = 'null'::jsonb OR p_filter = '{}'::jsonb THEN
    RETURN 'true';
  END IF;
  SELECT count(*) INTO v_conditions
    FROM jsonb_path_query(p_filter, 'strict $.**') n
   WHERE jsonb_typeof(n) = 'object' AND n ->> 'type' = 'condition';
  IF v_conditions > 50 THEN
    RAISE EXCEPTION 'filter has too many conditions' USING ERRCODE = '22023';
  END IF;
  RETURN coalesce(internal.search_compile_node(p_filter, 1), 'true');
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_compile_filter(jsonb) OWNER TO migrator;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.search_compile_filter(jsonb) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Matching, shared by api.search and api.search_facets so the page and its
-- counts cannot drift: both read this function, so a change here changes both.
-- It runs as the caller, so row security on search_documents and the two cell
-- tables decides what is visible.
-- ---------------------------------------------------------------------------
CREATE FUNCTION internal.search_matches(
    p_query text, p_filter jsonb, p_project_id uuid, p_kind text, p_status text,
    p_owner_id text, p_date_from timestamptz, p_date_to timestamptz, p_result_type text,
    p_include_archived boolean)
  RETURNS TABLE (result_type text, doc_type text, record_id uuid, kind text,
    project_id uuid, in_text boolean, rank real, created_at timestamptz,
    updated_at timestamptz, cell_text text, cell_label text)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid;
  v_type text;
  v_parsed record;
  v_has_text boolean;
  v_has_query boolean;
  v_ids_sql text := 'true';
  v_tok text;
  v_text_sql text := 'true';
  v_in_text_sql text := 'false';
  v_rank_sql text := '0::real';
  v_common text := 'true';
  v_filter text;
  v_cells_sql text := '';
BEGIN
  v_workspace_id := api.current_workspace_id();
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'no active workspace in request claims' USING ERRCODE = '42804';
  END IF;
  IF NOT api.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'caller is not a member of the active workspace' USING ERRCODE = '42501';
  END IF;

  v_type := nullif(btrim(coalesce(p_result_type, '')), '');
  IF v_type IS NOT NULL AND v_type NOT IN
    ('record', 'file', 'dataset', 'sheet', 'template', 'comment', 'dataset_row', 'sheet_row',
     'project', 'pipeline', 'analysis', 'instrument', 'instrument_run', 'booking',
     'storage_location', 'client', 'deviation', 'parser', 'person') THEN
    RAISE EXCEPTION 'invalid result type filter' USING ERRCODE = '22023';
  END IF;

  v_filter := internal.search_compile_filter(p_filter);

  SELECT * INTO v_parsed FROM internal.search_parse_query(p_query);
  v_has_text := numnode(v_parsed.tsq) > 0;
  v_has_query := v_has_text OR cardinality(v_parsed.id_tokens) > 0;

  v_common := concat_ws(' AND ',
    CASE WHEN v_type IS NOT NULL THEN format('s.object_type = %L', v_type) END,
    CASE WHEN p_project_id IS NOT NULL THEN format('s.project_id = %L', p_project_id) END,
    CASE WHEN nullif(p_kind, '') IS NOT NULL THEN format('s.kind = %L', p_kind) END,
    CASE WHEN nullif(p_status, '') IS NOT NULL THEN format('s.status = %L', p_status) END,
    CASE WHEN nullif(p_owner_id, '') IS NOT NULL THEN format('s.owner_user_id = %L', p_owner_id) END,
    CASE WHEN p_date_from IS NOT NULL THEN format('s.created_at >= %L', p_date_from) END,
    CASE WHEN p_date_to IS NOT NULL THEN format('s.created_at <= %L', p_date_to) END,
    CASE WHEN NOT coalesce(p_include_archived, true) THEN 'NOT s.archived' END,
    v_filter);

  IF v_has_query THEN
    -- Identifier-like terms also match by substring on name and identifier;
    -- the rest of the query must then still match in text.
    IF cardinality(v_parsed.id_tokens) > 0 THEN
      FOREACH v_tok IN ARRAY v_parsed.id_tokens LOOP
        v_ids_sql := v_ids_sql || format(' AND (s.title || %L || s.identifier) ILIKE %L',
          ' ', '%' || internal.search_like_escape(v_tok) || '%');
      END LOOP;
      v_ids_sql := '(' || v_ids_sql || CASE WHEN numnode(v_parsed.rest) > 0 THEN ' AND s.tsv @@ $2' ELSE '' END || ')';
    END IF;
    v_text_sql := CASE
      WHEN v_has_text AND cardinality(v_parsed.id_tokens) > 0 THEN '(s.tsv @@ $1 OR ' || v_ids_sql || ')'
      WHEN v_has_text THEN 's.tsv @@ $1'
      ELSE v_ids_sql END;
    -- Found in the text, not only in the heading: a notebook's body or a comment.
    v_in_text_sql := CASE WHEN v_has_text
      THEN '(s.object_type = ''comment'' OR (s.object_type = ''record'' AND s.tsv @@ $1 AND NOT s.head_tsv @@ $1))'
      ELSE 'false' END;
    v_rank_sql := (CASE WHEN v_has_text THEN 'ts_rank(s.tsv, $1, 1)' ELSE '0' END)
      || ' + (CASE WHEN lower(s.identifier) = ANY ($3) THEN 1 ELSE 0 END)'
      || ' + (CASE WHEN ' || CASE WHEN cardinality(v_parsed.id_tokens) > 0 THEN v_ids_sql ELSE 'false' END
      || ' THEN 0.3 ELSE 0 END)';
    v_rank_sql := '(' || v_rank_sql || ')::real';
  END IF;

  -- Cell values keep their own tables (and their own indexes); a hit carries
  -- the dataset's or sheet's fields, so every filter reads the same columns.
  IF v_has_text AND (v_type IS NULL OR v_type IN ('dataset_row', 'sheet_row')) THEN
    v_cells_sql := format($c$
      UNION ALL
      SELECT * FROM (
        SELECT DISTINCT ON (c.rt, c.doc_id)
               c.rt AS result_type, c.doc_type, c.doc_id AS record_id, c.rt AS kind,
               s.project_id, false AS in_text, c.cell_rank AS rank,
               s.created_at, s.updated_at, c.value_text AS cell_text, c.field_label AS cell_label
          FROM (
            SELECT 'dataset_row'::text AS rt, 'dataset'::text AS doc_type, cs.dataset_id AS doc_id,
                   cs.value_text, cs.field_label,
                   (ts_rank(cs.search_vector, $1) * 0.5)::real AS cell_rank
              FROM api.dataset_cell_search cs
             WHERE cs.search_vector @@ $1
            UNION ALL
            SELECT 'sheet_row', 'sheet', scs.instance_id, scs.value_text, scs.field_label,
                   (ts_rank(scs.search_vector, $1) * 0.5)::real
              FROM api.sheet_cell_search scs
             WHERE scs.search_vector @@ $1
          ) c
          JOIN (
            SELECT d.object_type AS parent_type, d.object_id, d.project_id, d.kind AS parent_kind,
                   d.status, d.owner_user_id, d.tags, d.created_at, d.updated_at, d.archived, d.fields
              FROM api.search_documents d WHERE d.object_type IN ('dataset', 'sheet')
          ) pd ON pd.parent_type = c.doc_type AND pd.object_id = c.doc_id
          CROSS JOIN LATERAL (
            SELECT CASE c.rt WHEN 'dataset_row' THEN 'dataset_row' ELSE 'sheet_row' END AS object_type,
                   pd.parent_kind AS kind, pd.status, pd.project_id, pd.owner_user_id, pd.tags,
                   pd.created_at, pd.updated_at, pd.archived, pd.fields
          ) s
         WHERE %s
         ORDER BY c.rt, c.doc_id, c.cell_rank DESC
      ) cells
    $c$, v_common);
  END IF;

  RETURN QUERY EXECUTE format($q$
    SELECT s.object_type::text AS result_type, s.object_type::text AS doc_type,
           s.object_id AS record_id, s.kind::text, s.project_id,
           %s AS in_text, %s AS rank, s.created_at, s.updated_at,
           NULL::text AS cell_text, NULL::text AS cell_label
      FROM api.search_documents s
     WHERE %s AND %s
    %s
  $q$, v_in_text_sql, v_rank_sql, v_text_sql, v_common, v_cells_sql)
  USING v_parsed.tsq, v_parsed.rest, (SELECT coalesce(array_agg(lower(t)), ARRAY[]::text[]) FROM unnest(v_parsed.id_tokens) t);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_matches(text, jsonb, uuid, text, text, text, timestamptz, timestamptz, text, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.search_matches(text, jsonb, uuid, text, text, text, timestamptz, timestamptz, text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.search_matches(text, jsonb, uuid, text, text, text, timestamptz, timestamptz, text, boolean) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.search: one page of hits. The old signature is replaced; the old
-- arguments keep their names and positions, and the new ones come last.
-- ---------------------------------------------------------------------------
DROP FUNCTION api.search(text, uuid, text, text, text, timestamptz, timestamptz, integer, integer, text, boolean);
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
    rank real, deep_link text, total_count bigint, parent_title text, fields jsonb)
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
      ELSE
        ts_headline('english',
          left(d.title || ' — ' || d.identifier || ' — ' || d.body, 30000),
          v_parsed.tsq,
          'MaxWords=30,MinWords=10,ShortWord=3')
    END,
    CASE
      WHEN NOT v_has_query THEN 'title'
      WHEN pg.cell_text IS NOT NULL THEN 'cell_value'
      WHEN pg.in_text AND d.object_type = 'comment' THEN 'comment_body'
      WHEN pg.in_text THEN 'block_text'
      WHEN v_has_text AND to_tsvector('english', d.title) @@ v_parsed.tsq THEN 'title'
      WHEN (v_has_text AND to_tsvector('english', d.identifier) @@ v_parsed.tsq)
        OR lower(d.identifier) = ANY (v_ids) THEN 'identifier'
      WHEN v_has_text AND d.object_type IN ('record', 'file')
        AND to_tsvector('english', d.kind) @@ v_parsed.tsq THEN 'kind'
      WHEN v_has_text AND to_tsvector('english', d.status) @@ v_parsed.tsq THEN 'status'
      WHEN v_has_text AND to_tsvector('english', array_to_string(d.tags, ' ')) @@ v_parsed.tsq THEN 'tags'
      WHEN v_has_text AND d.head_tsv @@ v_parsed.tsq THEN 'title'
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
    d.fields
  FROM page pg
  JOIN api.search_documents d ON d.object_type = pg.doc_type AND d.object_id = pg.record_id
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

-- Counts for the facet column: every match, grouped the way the page groups
-- them, from the same matcher.
DROP FUNCTION api.search_facets(text, uuid, text, text, text, timestamptz, timestamptz, text, boolean);
--> statement-breakpoint
CREATE FUNCTION api.search_facets(
    p_query text DEFAULT ''::text, p_project_id uuid DEFAULT NULL::uuid,
    p_kind text DEFAULT NULL::text, p_status text DEFAULT NULL::text,
    p_owner_id text DEFAULT NULL::text, p_date_from timestamptz DEFAULT NULL::timestamptz,
    p_date_to timestamptz DEFAULT NULL::timestamptz, p_result_type text DEFAULT NULL::text,
    p_include_archived boolean DEFAULT true, p_filter jsonb DEFAULT NULL::jsonb)
  RETURNS TABLE (result_type text, kind text, project_id uuid, in_text boolean, match_count bigint)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT m.result_type, m.kind, m.project_id, m.in_text, count(*)
    FROM internal.search_matches(p_query, p_filter, p_project_id, p_kind, p_status,
      p_owner_id, p_date_from, p_date_to, p_result_type, p_include_archived) m
   GROUP BY m.result_type, m.kind, m.project_id, m.in_text
$$;
--> statement-breakpoint
ALTER FUNCTION api.search_facets(text, uuid, text, text, text, timestamptz, timestamptz, text, boolean, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.search_facets(text, uuid, text, text, text, timestamptz, timestamptz, text, boolean, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.search_facets(text, uuid, text, text, text, timestamptz, timestamptz, text, boolean, jsonb) TO authenticated;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.search_facets(text, uuid, text, text, text, timestamptz, timestamptz, text, boolean, jsonb) TO api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Backfill. Builders copy owner and author ids from the source rows; no
-- user-attributed row is written and no user id is invented.
-- ---------------------------------------------------------------------------
SELECT internal.search_reindex_all();
