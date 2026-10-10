-- SRCH-01.2 — index Sheet Instance cell values.
--
-- The sheet's values live in the Instance state rather than one row per cell, so
-- a trigger rebuilds that instance's index rows whenever the state changes. The
-- table is RLS-scoped to the workspace and `api.search_sheet_cells` is SECURITY
-- INVOKER, so RLS filters every hit and the reader's project authority still
-- decides what a hit resolves to.
ALTER TABLE api.sheet_cell_search ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sheet_cell_search_select ON api.sheet_cell_search
  FOR SELECT TO authenticated
  USING (
    workspace_id = api.current_workspace_id()
    AND api.is_workspace_member(workspace_id)
  );
--> statement-breakpoint
GRANT SELECT ON api.sheet_cell_search TO authenticated;
--> statement-breakpoint

-- The text form of a stored sheet cell: scalars render directly, objects carry
-- their label/value shape.
CREATE OR REPLACE FUNCTION internal.sheet_cell_text(p_value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_value IS NULL OR p_value = 'null'::jsonb THEN NULL
    WHEN jsonb_typeof(p_value) = 'string' THEN p_value #>> '{}'
    WHEN jsonb_typeof(p_value) IN ('number', 'boolean') THEN p_value::text
    WHEN jsonb_typeof(p_value) = 'object' THEN coalesce(
      nullif(p_value->>'label', ''), nullif(p_value->>'value', ''), p_value::text)
    ELSE p_value::text
  END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.sheet_cell_text(jsonb) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.sheet_cell_text(jsonb) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.sync_sheet_cell_search()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM api.sheet_cell_search WHERE instance_id = OLD.id;
    RETURN OLD;
  END IF;
  -- Rebuild this instance's rows: a state change can add, edit or clear cells.
  DELETE FROM api.sheet_cell_search WHERE instance_id = NEW.id;
  IF NEW.state IS NULL THEN
    RETURN NEW;
  END IF;
  -- One row per (row identity, field) that actually holds a value.
  INSERT INTO api.sheet_cell_search(
    instance_id, row_key, field_id, workspace_id, project_id, field_label, value_text)
  SELECT NEW.id, cell.key, field.element->>'fieldId', NEW.workspace_id, NEW.project_id,
         coalesce(nullif(field.element->>'label', ''), field.element->>'key', field.element->>'fieldId'),
         internal.sheet_cell_text(cell.value->(field.element->>'fieldId'))
    FROM jsonb_each(NEW.state->'localValues') cell
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(NEW.state->'localFields', '[]'::jsonb)) field(element)
   WHERE coalesce(field.element->>'lifecycle', 'active') = 'active'
     AND cell.value ? (field.element->>'fieldId')
     AND internal.sheet_cell_text(cell.value->(field.element->>'fieldId')) IS NOT NULL
     AND btrim(internal.sheet_cell_text(cell.value->(field.element->>'fieldId'))) <> '';
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.sync_sheet_cell_search() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

DROP TRIGGER IF EXISTS sync_sheet_cell_search ON api.sheet_instances;
--> statement-breakpoint
CREATE TRIGGER sync_sheet_cell_search
  AFTER INSERT OR UPDATE OR DELETE ON api.sheet_instances
  FOR EACH ROW EXECUTE FUNCTION internal.sync_sheet_cell_search();
--> statement-breakpoint

-- Rebuild the index for the instances that already exist.
INSERT INTO api.sheet_cell_search(
  instance_id, row_key, field_id, workspace_id, project_id, field_label, value_text)
SELECT si.id, cell.key, field.element->>'fieldId', si.workspace_id, si.project_id,
       coalesce(nullif(field.element->>'label', ''), field.element->>'key', field.element->>'fieldId'),
       internal.sheet_cell_text(cell.value->(field.element->>'fieldId'))
  FROM api.sheet_instances si
  CROSS JOIN LATERAL jsonb_each(coalesce(si.state->'localValues', '{}'::jsonb)) cell
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(si.state->'localFields', '[]'::jsonb)) field(element)
 WHERE coalesce(field.element->>'lifecycle', 'active') = 'active'
   AND cell.value ? (field.element->>'fieldId')
   AND internal.sheet_cell_text(cell.value->(field.element->>'fieldId')) IS NOT NULL
   AND btrim(internal.sheet_cell_text(cell.value->(field.element->>'fieldId'))) <> ''
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.search_sheet_cells(
  p_query text,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  instance_id uuid,
  instance_name text,
  project_id uuid,
  row_key text,
  field_label text,
  value_text text,
  snippet text,
  rank real
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, api
AS $$
  SELECT cs.instance_id, si.name, cs.project_id, cs.row_key, cs.field_label, cs.value_text,
         ts_headline('english', cs.value_text, plainto_tsquery('english', p_query)) AS snippet,
         ts_rank(cs.search_vector, plainto_tsquery('english', p_query)) AS rank
  FROM api.sheet_cell_search cs
  JOIN api.sheet_instances si ON si.id = cs.instance_id
  WHERE coalesce(btrim(p_query), '') <> ''
    AND cs.search_vector @@ plainto_tsquery('english', p_query)
  ORDER BY rank DESC, cs.value_text ASC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.search_sheet_cells(text, integer) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.search_sheet_cells(text, integer) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
