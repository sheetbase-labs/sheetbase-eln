-- Show changes on a sheet: every value a cell has held, who changed it, when
-- and the reason when one was given.
--
-- Two sources, both already recorded on every write:
--   * the sheet's own columns: api.sheet_instance_local_mutations keeps the
--     cells each write touched and the sheet as it stood after it, so the
--     value before a change is the value after the write that preceded it;
--   * dataset columns: a dataset row edit's change event carries from, to and
--     the reason for each field.
--
-- The function runs as the caller, so row security on the sheet, its writes
-- and the change events decides what comes back.

CREATE INDEX IF NOT EXISTS idx_change_events_entity_sequence
  ON api.change_events USING btree (entity_uuid, sequence);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.sheet_cell_history(p_instance_id uuid, p_limit integer DEFAULT 200)
    RETURNS jsonb
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path TO ''
    AS $$
WITH settings AS (
  SELECT LEAST(GREATEST(coalesce(p_limit, 200), 1), 500) AS lim
),
instance AS (
  SELECT i.id, i.state FROM api.sheet_instances i WHERE i.id = p_instance_id
),
-- One write more than asked for, so the oldest one returned still knows the
-- value its cells held before it.
writes AS (
  SELECT m.result_revision, m.created_at, m.actor_user_id, m.affected,
         m.result->'state'->'localValues' AS after_values
    FROM api.sheet_instance_local_mutations m
   WHERE m.instance_id = (SELECT id FROM instance)
   ORDER BY m.result_revision DESC
   LIMIT (SELECT lim + 1 FROM settings)
),
paired AS (
  SELECT w.*,
         lag(w.after_values) OVER (ORDER BY w.result_revision) AS before_values,
         row_number() OVER (ORDER BY w.result_revision) AS position,
         count(*) OVER () AS fetched
    FROM writes w
),
sheet_cells AS (
  SELECT p.*,
         -- A cell is "<row key>:<field id>"; a row key can hold colons, a
         -- field id (a UUID) cannot.
         left(cell, length(cell) - 37) AS row_key,
         right(cell, 36) AS field_id
    FROM paired p
   CROSS JOIN LATERAL jsonb_array_elements_text(p.affected->'cells') AS cell
   WHERE p.position > 1 OR p.fetched <= (SELECT lim FROM settings)
),
sheet_changes AS (
  SELECT c.created_at AS at,
         c.actor_user_id,
         'sheet'::text AS source,
         c.row_key,
         c.field_id,
         NULL::text AS dataset_id,
         NULL::text AS dataset_row_id,
         c.before_values->c.row_key->c.field_id AS before,
         c.after_values->c.row_key->c.field_id AS after,
         c.before_values IS NOT NULL AS before_known,
         NULL::text AS reason,
         c.result_revision AS ordinal
    FROM sheet_cells c
   WHERE c.before_values IS NULL
      OR (c.before_values->c.row_key->c.field_id)
         IS DISTINCT FROM (c.after_values->c.row_key->c.field_id)
),
bound_datasets AS (
  SELECT DISTINCT (b->>'datasetId')::uuid AS dataset_id
    FROM instance i
   CROSS JOIN LATERAL jsonb_array_elements(i.state->'bindings') AS b
   WHERE b->>'kind' = 'dataset'
),
dataset_events AS (
  SELECT e.*
    FROM api.change_events e
   WHERE e.entity_uuid IN (SELECT dataset_id FROM bound_datasets)
     AND e.entity_type = 'dataset'
     AND e.operation = 'update'
     AND e.payload ? 'rowId'
     AND jsonb_typeof(e.payload->'changes') = 'object'
   ORDER BY e.sequence DESC
   LIMIT (SELECT lim FROM settings)
),
dataset_changes AS (
  SELECT e.created_at AS at,
         e.actor_user_id,
         'dataset'::text AS source,
         NULL::text AS row_key,
         coalesce(change.value->>'fieldId', change.key) AS field_id,
         e.entity_uuid::text AS dataset_id,
         e.payload->>'rowId' AS dataset_row_id,
         change.value->'from' AS before,
         change.value->'to' AS after,
         true AS before_known,
         nullif(btrim(e.payload->>'reason'), '') AS reason,
         e.sequence AS ordinal
    FROM dataset_events e
   CROSS JOIN LATERAL jsonb_each(e.payload->'changes') AS change
   WHERE (change.value->'from') IS DISTINCT FROM (change.value->'to')
),
changes AS (
  SELECT * FROM sheet_changes
  UNION ALL
  SELECT * FROM dataset_changes
)
SELECT coalesce(jsonb_agg(jsonb_build_object(
         'at', c.at,
         'actorUserId', c.actor_user_id,
         'source', c.source,
         'rowKey', c.row_key,
         'fieldId', c.field_id,
         'datasetId', c.dataset_id,
         'datasetRowId', c.dataset_row_id,
         'before', c.before,
         'after', c.after,
         'beforeKnown', c.before_known,
         'reason', c.reason
       ) ORDER BY c.at DESC, c.ordinal DESC), '[]'::jsonb)
  FROM (SELECT * FROM changes ORDER BY at DESC, ordinal DESC LIMIT (SELECT lim FROM settings)) c
$$;
--> statement-breakpoint

ALTER FUNCTION api.sheet_cell_history(p_instance_id uuid, p_limit integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.sheet_cell_history(p_instance_id uuid, p_limit integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.sheet_cell_history(p_instance_id uuid, p_limit integer) TO authenticated;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.sheet_cell_history(p_instance_id uuid, p_limit integer) TO api_client;
