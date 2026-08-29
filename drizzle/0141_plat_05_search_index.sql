-- PLAT-05 — maintained FTS index for global search.
--
-- DATA-04's api.search computed a tsvector for every workspace record on
-- every query (measured ~2 s at 20k records, dominated by the records CTE).
-- This migration persists the record search vector in api.records.search_tsv,
-- maintains it via triggers (including parent-record refresh when a block,
-- file or link changes), backfills existing rows, adds a partial GIN index,
-- and routes api.search's record branch through the indexed path. The
-- tsvector weights match the previous on-the-fly expression exactly, so
-- ranking and match semantics are unchanged.

--> statement-breakpoint

ALTER TABLE api.records ADD COLUMN search_tsv tsvector;

--> statement-breakpoint

CREATE INDEX idx_records_search_tsv ON api.records USING gin (search_tsv)
  WHERE deleted_at IS NULL;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.compute_record_search_tsv(p_record_id uuid)
RETURNS tsvector
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rec api.records;
BEGIN
  SELECT * INTO rec FROM api.records WHERE id = p_record_id;
  IF rec.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN internal.compute_record_search_tsv_row(rec);
END;
$$;

--> statement-breakpoint

-- Row-based computation. Used by the record trigger during BEFORE INSERT (the
-- row is not yet visible to a SELECT at that point) and by the id-based
-- wrapper for child-table refreshes.
CREATE OR REPLACE FUNCTION internal.compute_record_search_tsv_row(rec api.records)
RETURNS tsvector
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF rec.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN
    setweight(to_tsvector('english', coalesce(rec.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(rec.identifier, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(rec.kind, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(rec.status, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(
      array_to_string(coalesce(rec.tags, ARRAY[]::text[]), ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(
      internal.extract_jsonb_text(rec.properties), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT string_agg(internal.extract_jsonb_text(b.payload), ' ')
         FROM api.blocks b WHERE b.record_id = rec.id), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT string_agg(
         coalesce(fo.display_name, '') || ' ' || coalesce(fo.media_type, ''), ' ')
         FROM api.file_objects fo WHERE fo.record_id = rec.id), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT string_agg(
         coalesce(rl.target_identifier, '') || ' ' ||
         coalesce(rl.target_kind, '') || ' ' || coalesce(rl.link_type, ''), ' ')
         FROM api.record_links rl WHERE rl.source_record_id = rec.id), '')), 'C');
END;
$$;

--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION internal.compute_record_search_tsv(uuid) FROM PUBLIC, anon, authenticated, api_client;
REVOKE EXECUTE ON FUNCTION internal.compute_record_search_tsv_row(api.records) FROM PUBLIC, anon, authenticated, api_client;

--> statement-breakpoint

-- Records: recompute the vector from the incoming row before a tracked
-- metadata write (BEFORE INSERT cannot SELECT the not-yet-inserted row).
CREATE OR REPLACE FUNCTION internal.trg_refresh_record_search_tsv()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.search_tsv := internal.compute_record_search_tsv_row(NEW);
  RETURN NEW;
END;
$$;

--> statement-breakpoint

CREATE TRIGGER refresh_record_search_tsv
  BEFORE INSERT OR UPDATE OF title, identifier, kind, status, tags, properties, deleted_at
  ON api.records FOR EACH ROW
  EXECUTE FUNCTION internal.trg_refresh_record_search_tsv();

--> statement-breakpoint

-- Child tables: rebuild the owning record's vector after a block/file/link
-- change (the block's own change event covers the structure change; the
-- record-level event must not be re-emitted for pure search maintenance).
CREATE OR REPLACE FUNCTION internal.trg_refresh_parent_record_search_tsv()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent uuid;
  v_old_parent uuid;
BEGIN
  IF TG_TABLE_NAME = 'record_links' THEN
    v_parent := COALESCE(NEW.source_record_id, OLD.source_record_id);
    v_old_parent := OLD.source_record_id;
  ELSE
    v_parent := COALESCE(NEW.record_id, OLD.record_id);
    v_old_parent := OLD.record_id;
  END IF;
  IF v_parent IS NOT NULL THEN
    UPDATE api.records
       SET search_tsv = internal.compute_record_search_tsv(v_parent)
     WHERE id = v_parent;
  END IF;
  -- A block/file moved to a different record: refresh the former parent too.
  IF TG_OP = 'UPDATE' AND v_old_parent IS NOT NULL AND v_old_parent IS DISTINCT FROM v_parent THEN
    UPDATE api.records
       SET search_tsv = internal.compute_record_search_tsv(v_old_parent)
     WHERE id = v_old_parent;
  END IF;
  RETURN NULL;
END;
$$;

--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION internal.trg_refresh_parent_record_search_tsv() FROM PUBLIC, anon, authenticated, api_client;

--> statement-breakpoint

CREATE TRIGGER refresh_record_search_tsv_blocks
  AFTER INSERT OR UPDATE OR DELETE ON api.blocks FOR EACH ROW
  EXECUTE FUNCTION internal.trg_refresh_parent_record_search_tsv();

--> statement-breakpoint

CREATE TRIGGER refresh_record_search_tsv_files
  AFTER INSERT OR UPDATE OR DELETE ON api.file_objects FOR EACH ROW
  EXECUTE FUNCTION internal.trg_refresh_parent_record_search_tsv();

--> statement-breakpoint

CREATE TRIGGER refresh_record_search_tsv_links
  AFTER INSERT OR UPDATE OR DELETE ON api.record_links FOR EACH ROW
  EXECUTE FUNCTION internal.trg_refresh_parent_record_search_tsv();

--> statement-breakpoint

-- Live-change guard: a record UPDATE that changes ONLY search_tsv is search
-- index maintenance (child-table refresh), not a product change — do not
-- emit a duplicate 'record' change event. Any other column change still
-- emits, exactly as before.
CREATE OR REPLACE FUNCTION internal.trg_change_event_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op text;
  v_payload jsonb;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    v_op := 'create';
    v_payload := jsonb_build_object(
      'kind', NEW.kind, 'identifier', NEW.identifier, 'title', NEW.title,
      'status', NEW.status, 'structureVersion', NEW.structure_version,
      'metadataVersion', NEW.metadata_version
    );
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'record', NEW.id, v_op, NEW.id, NEW.project_id, v_payload
    );
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Pure search-index maintenance (only search_tsv differs): no event.
    IF (to_jsonb(OLD) - 'search_tsv') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'search_tsv')
       AND OLD.search_tsv IS DISTINCT FROM NEW.search_tsv THEN
      RETURN NULL;
    END IF;
    -- Derive the semantic operation from the archived_at transition first;
    -- otherwise it is a metadata/structure update.
    IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
      v_op := 'archive';
    ELSIF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN
      v_op := 'restore';
    ELSE
      v_op := 'update';
    END IF;
    v_payload := jsonb_build_object(
      'title', NEW.title, 'status', NEW.status,
      'structureVersion', NEW.structure_version,
      'metadataVersion', NEW.metadata_version,
      'changedMetadata', (OLD.title IS DISTINCT FROM NEW.title
        OR OLD.status IS DISTINCT FROM NEW.status
        OR OLD.tags IS DISTINCT FROM NEW.tags
        OR OLD.properties IS DISTINCT FROM NEW.properties
        OR OLD.folder_id IS DISTINCT FROM NEW.folder_id),
      'changedStructure', (OLD.structure_version IS DISTINCT FROM NEW.structure_version),
      'changes', jsonb_strip_nulls(jsonb_build_object(
        'title', CASE WHEN OLD.title IS DISTINCT FROM NEW.title
          THEN jsonb_build_object('from', OLD.title, 'to', NEW.title) END,
        'status', CASE WHEN OLD.status IS DISTINCT FROM NEW.status
          THEN jsonb_build_object('from', OLD.status, 'to', NEW.status) END,
        'folderId', CASE WHEN OLD.folder_id IS DISTINCT FROM NEW.folder_id
          THEN jsonb_build_object('from', OLD.folder_id, 'to', NEW.folder_id) END
      ))
    );
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'record', NEW.id, v_op, NEW.id, NEW.project_id, v_payload
    );
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM "internal"."emit_change_event"(
      OLD.workspace_id, 'record', OLD.id, 'delete', OLD.id, OLD.project_id,
      jsonb_build_object('identifier', OLD.identifier, 'kind', OLD.kind)
    );
  END IF;
  RETURN NULL;
END;
$$;

--> statement-breakpoint

-- Backfill existing records (the guard above prevents 20k+ change events).
UPDATE api.records
   SET search_tsv = internal.compute_record_search_tsv(id)
 WHERE search_tsv IS NULL;

--> statement-breakpoint

-- Route api.search's record branch through the indexed vector. Everything
-- else in the function is unchanged; only record_hits differs.
CREATE OR REPLACE FUNCTION "api"."search"(
  p_query text DEFAULT '',
  p_project_id uuid DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_owner_id text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0,
  p_result_type text DEFAULT NULL
)
RETURNS TABLE (
  result_type text,
  record_id uuid,
  kind text,
  identifier text,
  title text,
  status text,
  project_id uuid,
  archived boolean,
  created_by_user_id text,
  created_at timestamptz,
  updated_at timestamptz,
  matched_context text,
  matched_field text,
  rank real,
  deep_link text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_workspace_id uuid;
  v_tsquery tsquery;
  v_has_query boolean;
  v_limit int;
  v_offset int;
  v_result_type text;
BEGIN
  v_workspace_id := "api"."current_workspace_id"();
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'no active workspace in request claims' USING ERRCODE = '42804';
  END IF;
  IF NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RAISE EXCEPTION 'caller is not a member of the active workspace' USING ERRCODE = '42501';
  END IF;

  v_result_type := nullif(btrim(coalesce(p_result_type, '')), '');
  IF v_result_type IS NOT NULL AND v_result_type NOT IN
    ('record', 'file', 'dataset', 'sheet', 'template') THEN
    RAISE EXCEPTION 'invalid result type filter' USING ERRCODE = '22023';
  END IF;

  -- Track whether the caller provided a non-empty query. An empty query means
  -- "browse everything" mode: no tsquery match is required, results are
  -- ordered by recency, and matched_context is a title excerpt.
  v_has_query := btrim(coalesce(p_query, '')) <> '';

  IF v_has_query THEN
    v_tsquery := plainto_tsquery('english', p_query);
    IF v_tsquery = ''::tsquery THEN
      v_has_query := false;
    END IF;
  ELSE
    v_tsquery := ''::tsquery;
  END IF;

  -- Clamp pagination parameters.
  v_limit := coalesce(p_limit, 20);
  IF v_limit < 1 THEN v_limit := 20; END IF;
  IF v_limit > 100 THEN v_limit := 100; END IF;
  v_offset := coalesce(p_offset, 0);
  IF v_offset < 0 THEN v_offset := 0; END IF;

  RETURN QUERY
  WITH
  ---------------------------------------------------------------------------
  -- Records (indexed via api.records.search_tsv; the GIN index accelerates
  -- the @@ match and only matching rows pay for the text-correlation columns).
  ---------------------------------------------------------------------------
  record_hits AS (
    SELECT
      CASE WHEN r.kind = 'file' THEN 'file' ELSE 'record' END AS result_type,
      r.id AS record_id,
      r.kind,
      r.identifier,
      r.title,
      r.status,
      r.project_id,
      (r.archived_at IS NOT NULL) AS archived,
      r.created_by_user_id,
      r.created_at,
      r.updated_at,
      coalesce(
        (SELECT string_agg(internal.extract_jsonb_text(b.payload), ' ')
         FROM api.blocks b WHERE b.record_id = r.id),
        '') AS block_text,
      coalesce(
        (SELECT string_agg(
          coalesce(fo.display_name, '') || ' ' || coalesce(fo.media_type, ''), ' ')
         FROM api.file_objects fo WHERE fo.record_id = r.id),
        '') AS file_text,
      coalesce(internal.extract_jsonb_text(r.properties), '') AS property_text,
      coalesce(
        (SELECT string_agg(
          coalesce(rl.target_identifier, '') || ' ' ||
          coalesce(rl.target_kind, '') || ' ' ||
          coalesce(rl.link_type, ''), ' ')
         FROM api.record_links rl WHERE rl.source_record_id = r.id),
        '') AS link_text,
      coalesce(array_to_string(coalesce(r.tags, ARRAY[]::text[]), ' '), '') AS tag_text,
      coalesce(r.search_tsv, ''::tsvector) AS search_vector,
      coalesce(r.title, '') || ' ' || coalesce(r.identifier, '') || ' ' ||
      coalesce(array_to_string(coalesce(r.tags, ARRAY[]::text[]), ' '), '') || ' ' ||
      coalesce(internal.extract_jsonb_text(r.properties), '') || ' ' ||
      coalesce(
        (SELECT string_agg(internal.extract_jsonb_text(b.payload), ' ')
         FROM api.blocks b WHERE b.record_id = r.id),
        '') || ' ' ||
      coalesce(
        (SELECT string_agg(
          coalesce(fo.display_name, '') || ' ' || coalesce(fo.media_type, ''), ' ')
         FROM api.file_objects fo WHERE fo.record_id = r.id),
        '') || ' ' ||
      coalesce(
        (SELECT string_agg(
          coalesce(rl.target_identifier, '') || ' ' ||
          coalesce(rl.target_kind, '') || ' ' ||
          coalesce(rl.link_type, ''), ' ')
         FROM api.record_links rl WHERE rl.source_record_id = r.id),
        '') AS combined_text
    FROM api.records r
    WHERE r.deleted_at IS NULL
      AND (NOT v_has_query OR r.search_tsv @@ v_tsquery)
      AND (
        v_result_type IS NULL
        OR (v_result_type = 'file' AND r.kind = 'file')
        OR (v_result_type = 'record' AND r.kind <> 'file')
      )
      AND (p_project_id IS NULL OR r.project_id = p_project_id)
      AND (p_kind IS NULL OR r.kind = p_kind)
      AND (p_status IS NULL OR r.status = p_status)
      AND (p_owner_id IS NULL OR r.created_by_user_id = p_owner_id)
      AND (p_date_from IS NULL OR r.created_at >= p_date_from)
      AND (p_date_to IS NULL OR r.created_at <= p_date_to)
  ),
  ---------------------------------------------------------------------------
  -- Canonical Datasets. Live mutable objects: exported/searched as-is, never
  -- presented as evidence.
  ---------------------------------------------------------------------------
  dataset_hits AS (
    SELECT
      'dataset' AS result_type,
      d.id AS record_id,
      'dataset' AS kind,
      d.id::text AS identifier,
      d.name AS title,
      d.lifecycle AS status,
      d.primary_project_id AS project_id,
      (d.lifecycle = 'archived') AS archived,
      d.created_by_user_id,
      d.created_at,
      d.updated_at,
      ''::text AS block_text,
      ''::text AS file_text,
      ''::text AS property_text,
      ''::text AS link_text,
      ''::text AS tag_text,
      setweight(to_tsvector('english', coalesce(d.name, '')), 'A') ||
      setweight(to_tsvector('english', d.id::text), 'A') ||
      setweight(to_tsvector('english',
        coalesce(sd.key, '') || ' ' || coalesce(sd.name, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(d.description, '')), 'C')
      AS search_vector,
      coalesce(d.name, '') || ' ' || d.id::text || ' ' ||
      coalesce(sd.key, '') || ' ' || coalesce(sd.name, '') || ' ' ||
      coalesce(d.description, '') AS combined_text
    FROM api.datasets d
    JOIN api.dataset_schema_versions dsv ON dsv.id = d.schema_version_id
    JOIN api.dataset_schema_definitions sd ON sd.id = dsv.schema_id
    WHERE d.lifecycle IN ('active', 'archived')
      AND (v_result_type IS NULL OR v_result_type = 'dataset')
      AND (p_project_id IS NULL OR d.primary_project_id = p_project_id)
      AND (p_date_from IS NULL OR d.created_at >= p_date_from)
      AND (p_date_to IS NULL OR d.created_at <= p_date_to)
      -- A record-only filter implies the caller wants records; the new
      -- object classes are suppressed so legacy filters keep exact semantics.
      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL
  ),
  ---------------------------------------------------------------------------
  -- Sheet Instances (working sheets bound to Notebooks or projects).
  ---------------------------------------------------------------------------
  sheet_hits AS (
    SELECT
      'sheet' AS result_type,
      si.id AS record_id,
      'sheet_instance' AS kind,
      si.id::text AS identifier,
      si.name AS title,
      si.lifecycle AS status,
      si.project_id,
      (si.lifecycle = 'archived') AS archived,
      si.created_by_user_id,
      si.created_at,
      si.updated_at,
      ''::text AS block_text,
      ''::text AS file_text,
      ''::text AS property_text,
      ''::text AS link_text,
      ''::text AS tag_text,
      setweight(to_tsvector('english', coalesce(si.name, '')), 'A') ||
      setweight(to_tsvector('english', si.id::text), 'A') ||
      setweight(to_tsvector('english', coalesce(si.description, '')), 'C')
      AS search_vector,
      coalesce(si.name, '') || ' ' || si.id::text || ' ' ||
      coalesce(si.description, '') AS combined_text
    FROM api.sheet_instances si
    WHERE si.lifecycle IN ('active', 'archived')
      AND (v_result_type IS NULL OR v_result_type = 'sheet')
      AND (p_project_id IS NULL OR si.project_id = p_project_id)
      AND (p_date_from IS NULL OR si.created_at >= p_date_from)
      AND (p_date_to IS NULL OR si.created_at <= p_date_to)
      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL
  ),
  ---------------------------------------------------------------------------
  -- Notebook Templates (CORE-06 versioned catalogue; workspace-level).
  ---------------------------------------------------------------------------
  template_hits AS (
    SELECT
      'template' AS result_type,
      nt.id AS record_id,
      'notebook_template' AS kind,
      nt.key AS identifier,
      nt.name AS title,
      nt.lifecycle AS status,
      NULL::uuid AS project_id,
      (nt.lifecycle = 'retired') AS archived,
      nt.created_by_user_id,
      nt.created_at,
      nt.updated_at,
      ''::text AS block_text,
      ''::text AS file_text,
      ''::text AS property_text,
      ''::text AS link_text,
      ''::text AS tag_text,
      setweight(to_tsvector('english', coalesce(nt.name, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(nt.key, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(nt.description, '')), 'C')
      AS search_vector,
      coalesce(nt.name, '') || ' ' || coalesce(nt.key, '') || ' ' ||
      coalesce(nt.description, '') AS combined_text
    FROM api.notebook_templates nt
    WHERE nt.lifecycle IN ('active', 'retired')
      AND (v_result_type IS NULL OR v_result_type = 'template')
      AND (p_date_from IS NULL OR nt.created_at >= p_date_from)
      AND (p_date_to IS NULL OR nt.created_at <= p_date_to)
      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL
  ),
  all_hits AS (
    SELECT * FROM record_hits
    UNION ALL
    SELECT * FROM dataset_hits
    UNION ALL
    SELECT * FROM sheet_hits
    UNION ALL
    SELECT * FROM template_hits
  )
  SELECT
    h.result_type,
    h.record_id,
    h.kind,
    h.identifier,
    h.title,
    h.status,
    h.project_id,
    h.archived,
    h.created_by_user_id,
    h.created_at,
    h.updated_at,
    CASE
      WHEN NOT v_has_query THEN
        left(coalesce(h.title, '') || ' — ' || coalesce(h.identifier, ''), 120)
      ELSE
        ts_headline('english', h.combined_text, v_tsquery,
          'MaxWords=30,MinWords=10,ShortWord=3')
    END AS matched_context,
    CASE
      WHEN NOT v_has_query THEN 'title'
      WHEN to_tsvector('english', h.title) @@ v_tsquery THEN 'title'
      WHEN to_tsvector('english', h.identifier) @@ v_tsquery THEN 'identifier'
      WHEN h.result_type IN ('record', 'file')
        AND to_tsvector('english', h.kind) @@ v_tsquery THEN 'kind'
      WHEN to_tsvector('english', h.status) @@ v_tsquery THEN 'status'
      WHEN to_tsvector('english', h.tag_text) @@ v_tsquery THEN 'tags'
      WHEN h.result_type IN ('record', 'file')
        AND to_tsvector('english', h.block_text) @@ v_tsquery THEN 'block_text'
      WHEN h.result_type IN ('record', 'file')
        AND to_tsvector('english', h.file_text) @@ v_tsquery THEN 'file_metadata'
      WHEN to_tsvector('english', h.property_text) @@ v_tsquery THEN 'properties'
      WHEN h.link_text <> ''
        AND to_tsvector('english', h.link_text) @@ v_tsquery THEN 'relationship'
      WHEN to_tsvector('english', h.combined_text) @@ v_tsquery THEN 'description'
      ELSE 'relationship'
    END AS matched_field,
    CASE
      WHEN NOT v_has_query THEN 0::real
      ELSE ts_rank(h.search_vector, v_tsquery)
    END AS rank,
    CASE
      WHEN h.result_type = 'dataset'
        THEN '/datasets?dataset=' || h.record_id::text
      WHEN h.result_type = 'sheet'
        THEN '/sheets/' || h.record_id::text
      WHEN h.result_type = 'template' THEN '/templates'
      WHEN h.kind = 'notebook_template' THEN '/templates'
      ELSE '/projects/' || coalesce(h.project_id::text, '')
        || '/experiments/' || h.record_id::text
    END AS deep_link,
    count(*) OVER () AS total_count
  FROM all_hits h
  WHERE (NOT v_has_query) OR h.search_vector @@ v_tsquery
  ORDER BY
    (CASE WHEN v_has_query THEN ts_rank(h.search_vector, v_tsquery) ELSE 0 END) DESC,
    h.updated_at DESC,
    h.record_id ASC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."search"(text, uuid, text, text, text, timestamptz, timestamptz, int, int, text) FROM PUBLIC;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION "api"."search"(text, uuid, text, text, text, timestamptz, timestamptz, int, int, text) TO authenticated;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION "api"."search"(text, uuid, text, text, text, timestamptz, timestamptz, int, int, text) TO api_client;--> statement-breakpoint

-- Search-index maintenance updates api.records.search_tsv (child-table
-- refresh). The generic set_updated_at trigger would bump records.updated_at,
-- changing the submission evidence digest, so maintenance-only updates (only
-- search_tsv differs) keep the previous updated_at. Tables without a
-- search_tsv column are unaffected.
CREATE OR REPLACE FUNCTION "internal"."set_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF to_jsonb(OLD) ? 'search_tsv'
     AND (to_jsonb(OLD) - 'search_tsv') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'search_tsv') THEN
    NEW."updated_at" := OLD."updated_at";
  ELSE
    NEW."updated_at" := now();
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
