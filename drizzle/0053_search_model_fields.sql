-- Fields an admin adds to the Project, Instrument and Instrument run models (custom_fields)
-- become filterable in search, as record fields already are: each scalar value
-- joins the document's `fields`, where `fields.<key>` conditions read it. The
-- built-in values keep their keys and win over a custom field of the same name.

CREATE OR REPLACE FUNCTION internal.search_custom_scalars(p_custom jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT coalesce((SELECT jsonb_object_agg(e.key, e.value)
                     FROM jsonb_each(CASE WHEN jsonb_typeof(p_custom) = 'object'
                                          THEN p_custom ELSE '{}'::jsonb END) e
                    WHERE jsonb_typeof(e.value) IN ('string', 'number', 'boolean')), '{}'::jsonb)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.search_custom_scalars(jsonb) OWNER TO migrator;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.search_docs_project(p_ids uuid[] DEFAULT NULL)
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
         internal.search_custom_scalars(p.custom_fields)
           || jsonb_strip_nulls(jsonb_build_object(
                'key', p.key, 'modality', p.modality, 'stage', p.stage,
                'client', cl.name, 'lead', p.lead_user_id)),
         '/projects/' || p.id::text
    FROM api.projects p
    LEFT JOIN api.clients cl ON cl.id = p.client_id
   WHERE p_ids IS NULL OR p.id = ANY (p_ids)
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.search_docs_instrument(p_ids uuid[] DEFAULT NULL)
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
         internal.search_custom_scalars(i.custom_fields)
           || jsonb_strip_nulls(jsonb_build_object(
                'instrument_type', i.instrument_type, 'vendor', i.vendor, 'model', i.model,
                'serial_number', i.serial_number, 'location', i.location)),
         '/instruments/' || i.id::text
    FROM api.instruments i
   WHERE p_ids IS NULL OR i.id = ANY (p_ids)
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.search_docs_instrument_run(p_ids uuid[] DEFAULT NULL)
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
         internal.search_custom_scalars(r.custom_fields)
           || jsonb_strip_nulls(jsonb_build_object(
                'instrument', i.name, 'operator', r.operator, 'protocol', r.protocol_name,
                'plate_format', r.plate_format, 'started_at', r.started_at)),
         '/instruments/' || r.instrument_id::text
    FROM api.instrument_runs r
    LEFT JOIN api.instruments i ON i.id = r.instrument_id
   WHERE p_ids IS NULL OR r.id = ANY (p_ids)
$$;
--> statement-breakpoint
SELECT internal.search_reindex('project');
--> statement-breakpoint
SELECT internal.search_reindex('instrument');
--> statement-breakpoint
SELECT internal.search_reindex('instrument_run');
