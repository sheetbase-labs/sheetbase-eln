-- SRCH-01.2 — index published Dataset cell values.
--
-- api.dataset_cell_search (declared in src/db/schema.ts) holds one row per
-- dataset_version_values cell with the field label and the rendered text value.
-- A trigger keeps it in step with the immutable version values. The table is
-- RLS-scoped to the workspace, and api.search_cells is SECURITY INVOKER so RLS
-- filters every hit.

ALTER TABLE api.dataset_cell_search ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY dataset_cell_search_select ON api.dataset_cell_search
  FOR SELECT TO authenticated
  USING (
    workspace_id = api.current_workspace_id()
    AND api.is_workspace_member(workspace_id)
  );
--> statement-breakpoint
GRANT SELECT ON api.dataset_cell_search TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.sync_dataset_cell_search()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_dataset_id uuid;
  v_workspace_id uuid;
  v_label text;
  v_category jsonb;
  v_text text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM api.dataset_cell_search
    WHERE dataset_version_id = OLD.dataset_version_id
      AND row_id = OLD.row_id
      AND field_id = OLD.field_id
      AND ordinal = OLD.ordinal;
    RETURN OLD;
  END IF;

  SELECT dv.dataset_id, dv.workspace_id, f.label, f.category
    INTO v_dataset_id, v_workspace_id, v_label, v_category
  FROM api.dataset_versions dv
  JOIN api.dataset_schema_version_fields f
    ON f.schema_version_id = dv.schema_version_id
   AND f.field_id = NEW.field_id
  WHERE dv.id = NEW.dataset_version_id;

  v_text := CASE
    WHEN NEW.text_value IS NOT NULL THEN NEW.text_value
    WHEN NEW.integer_value IS NOT NULL THEN NEW.integer_value::text
    WHEN NEW.numeric_value IS NOT NULL THEN NEW.numeric_value::text
    WHEN NEW.boolean_value IS NOT NULL THEN NEW.boolean_value::text
    WHEN NEW.date_value IS NOT NULL THEN NEW.date_value::text
    WHEN NEW.timestamp_value IS NOT NULL THEN NEW.timestamp_value::text
    WHEN NEW.category_option_id IS NOT NULL THEN coalesce(
      (SELECT opt->>'label'
         FROM jsonb_array_elements(coalesce(v_category, '[]'::jsonb)) opt
        WHERE opt->>'id' = NEW.category_option_id::text
        LIMIT 1),
      NEW.category_option_id::text)
    WHEN NEW.reference_id IS NOT NULL THEN coalesce(
      (SELECT r.identifier FROM api.records r WHERE r.id = NEW.reference_id),
      NEW.reference_id::text)
    ELSE ''
  END;

  IF TG_OP = 'UPDATE' THEN
    DELETE FROM api.dataset_cell_search
    WHERE dataset_version_id = OLD.dataset_version_id
      AND row_id = OLD.row_id
      AND field_id = OLD.field_id
      AND ordinal = OLD.ordinal;
  END IF;

  INSERT INTO api.dataset_cell_search(
    dataset_version_id, row_id, field_id, ordinal,
    dataset_id, workspace_id, field_label, value_text
  )
  VALUES (
    NEW.dataset_version_id, NEW.row_id, NEW.field_id, NEW.ordinal,
    v_dataset_id, v_workspace_id, coalesce(v_label, ''), coalesce(v_text, '')
  )
  ON CONFLICT (dataset_version_id, row_id, field_id, ordinal) DO UPDATE
    SET field_label = EXCLUDED.field_label,
        value_text = EXCLUDED.value_text,
        dataset_id = EXCLUDED.dataset_id,
        workspace_id = EXCLUDED.workspace_id;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER sync_dataset_cell_search
  AFTER INSERT OR UPDATE OR DELETE ON api.dataset_version_values
  FOR EACH ROW EXECUTE FUNCTION internal.sync_dataset_cell_search();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.search_cells(
  p_query text,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  dataset_id uuid,
  dataset_version_id uuid,
  dataset_name text,
  row_id uuid,
  field_label text,
  value_text text,
  snippet text,
  rank real
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, api
AS $$
  SELECT cs.dataset_id, cs.dataset_version_id, d.name, cs.row_id, cs.field_label,
         cs.value_text,
         ts_headline('english', cs.value_text, plainto_tsquery('english', p_query)) AS snippet,
         ts_rank(cs.search_vector, plainto_tsquery('english', p_query)) AS rank
  FROM api.dataset_cell_search cs
  JOIN api.datasets d ON d.id = cs.dataset_id
  WHERE coalesce(btrim(p_query), '') <> ''
    AND cs.search_vector @@ plainto_tsquery('english', p_query)
  ORDER BY rank DESC, cs.value_text ASC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.search_cells(text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.search_cells(text, integer) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
