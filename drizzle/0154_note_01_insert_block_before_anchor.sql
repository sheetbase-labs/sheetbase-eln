-- NOTE-01: server-authoritative insert-at-position for block undo.
--
-- insert_block previously supported only an `after` anchor (null =
-- append). Restoring a deleted first block therefore needed a second,
-- non-atomic move_block call after the insert; a move failure left the
-- restored block appended at the end of the record.
--
-- This migration replaces insert_block with a version that also accepts
-- p_before_block_id, mirroring move_block's neighbour semantics:
--   (after, null)  → after the anchor / end
--   (null, before) → before the anchor / start
--   (after, before)→ strictly between the two anchors (23514 if inverted)
--   (null, null)   → append
-- The insert, version bump and any precision rebalance happen in one
-- plpgsql block, so a restore is a single atomic operation. The result now
-- also returns the full (id, order) list so the client reconciles positions
-- in the same round-trip.
--
-- The old six-argument signature is dropped; every in-repo caller
-- (templates, sheet instance blocks) uses only the leading arguments and
-- keeps working through the new function's defaults.
DROP FUNCTION IF EXISTS "api"."insert_block"(uuid, text, jsonb, int, uuid, int);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "api"."insert_block"(
  p_record_id uuid,
  p_type text,
  p_payload jsonb,
  p_payload_schema_version int DEFAULT 1,
  p_after_block_id uuid DEFAULT NULL,
  p_expected_structure_version int DEFAULT NULL,
  p_before_block_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_record "api"."records";
  v_sv int;
  v_new_order real;
  v_after "api"."blocks";
  v_before "api"."blocks";
  v_next "api"."blocks";
  v_after_order real;
  v_before_order real;
  v_gap real;
  v_rebalanced boolean := false;
  v_block "api"."blocks";
  v_id uuid;
BEGIN
  SELECT * INTO v_record FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_record IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;

  -- Optional stale-version guard. When supplied, a mismatch aborts before
  -- any write so the client can refetch and retry.
  IF p_expected_structure_version IS NOT NULL THEN
    SELECT structure_version INTO v_sv FROM "api"."records" WHERE id = p_record_id;
    IF v_sv <> p_expected_structure_version THEN
      RAISE EXCEPTION 'structure version mismatch: expected %, got %',
        p_expected_structure_version, v_sv USING ERRCODE = 'SB001';
    END IF;
  END IF;
  v_sv := v_record.structure_version;

  -- Resolve and lock the anchors. Both must belong to this record.
  IF p_after_block_id IS NOT NULL THEN
    SELECT * INTO v_after FROM "api"."blocks"
      WHERE id = p_after_block_id AND record_id = p_record_id
      FOR UPDATE;
    IF v_after IS NULL THEN
      RAISE EXCEPTION 'after_block is not in this record' USING ERRCODE = '23503';
    END IF;
    v_after_order := v_after."order";
  END IF;
  IF p_before_block_id IS NOT NULL THEN
    SELECT * INTO v_before FROM "api"."blocks"
      WHERE id = p_before_block_id AND record_id = p_record_id
      FOR UPDATE;
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'before_block is not in this record' USING ERRCODE = '23503';
    END IF;
    v_before_order := v_before."order";
  END IF;

  -- Fractional indexing, mirroring move_block's neighbour semantics.
  IF p_after_block_id IS NOT NULL AND p_before_block_id IS NOT NULL THEN
    IF v_after_order >= v_before_order THEN
      RAISE EXCEPTION 'after_block must precede before_block' USING ERRCODE = '23514';
    END IF;
    v_new_order := (v_after_order + v_before_order) / 2.0;
  ELSIF p_after_block_id IS NOT NULL THEN
    -- First block after the anchor, by order.
    SELECT * INTO v_next FROM "api"."blocks"
      WHERE record_id = p_record_id AND "order" > v_after_order
      ORDER BY "order" ASC LIMIT 1
      FOR UPDATE;
    IF v_next IS NULL THEN
      v_new_order := v_after_order + 1.0;
    ELSE
      v_new_order := (v_after_order + v_next."order") / 2.0;
    END IF;
  ELSIF p_before_block_id IS NOT NULL THEN
    -- Insert at the start, before the anchor.
    v_new_order := v_before_order / 2.0;
  ELSE
    SELECT COALESCE(max("order"), 0) + 1 INTO v_new_order
      FROM "api"."blocks" WHERE record_id = p_record_id;
  END IF;

  -- Precision-exhaustion guard, mirroring move_block: a collapsed gap
  -- between two anchors, or a start insert into a sub-1e-3 head gap,
  -- triggers a re-key of every block in the record to integer positions
  -- 1..N after the insert.
  IF p_after_block_id IS NOT NULL AND p_before_block_id IS NOT NULL THEN
    v_gap := v_before_order - v_after_order;
  ELSE
    v_gap := v_new_order;
  END IF;

  v_id := gen_random_uuid();
  INSERT INTO "api"."blocks" (
    id, record_id, type, payload, payload_schema_version, "order", created_by_user_id
  ) VALUES (
    v_id, p_record_id, p_type, p_payload, p_payload_schema_version, v_new_order,
    "api"."current_user_id"()
  );

  IF v_gap <= 1e-3 THEN
    v_rebalanced := true;
    -- Re-key to integers 1..N. The new block's fractional order may have
    -- collapsed onto an anchor's order, so the tie-break places it after
    -- blocks sharing its order when it rounded down onto the after anchor,
    -- and before them when it rounded up onto the before anchor.
    WITH ranked AS (
      SELECT
        id,
        row_number() OVER (
          ORDER BY "order",
            CASE
              WHEN id = v_id AND v_new_order = v_before_order THEN -1
              WHEN id = v_id THEN 1
              ELSE 0
            END
        ) AS new_pos
      FROM "api"."blocks"
      WHERE record_id = p_record_id
    )
    UPDATE "api"."blocks" b
      SET "order" = ranked.new_pos
      FROM ranked
      WHERE b.id = ranked.id;
  END IF;

  UPDATE "api"."records"
    SET structure_version = v_sv + 1
    WHERE id = p_record_id;

  SELECT * INTO v_block FROM "api"."blocks" WHERE id = v_id;

  RETURN jsonb_build_object(
    'block', to_jsonb(v_block),
    'structure_version', v_sv + 1,
    'rebalanced', v_rebalanced,
    'order', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'order', "order") ORDER BY "order"), '[]'::jsonb)
      FROM "api"."blocks" WHERE record_id = p_record_id
    )
  );
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."insert_block"(uuid, text, jsonb, int, uuid, int, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."insert_block"(uuid, text, jsonb, int, uuid, int, uuid) TO authenticated;--> statement-breakpoint
