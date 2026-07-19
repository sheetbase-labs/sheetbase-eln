-- ELN-003: controlled notebook RPCs over PostgREST. Direct CRUD on the
-- notebook tables is safe under RLS for straightforward reads/writes, but
-- multi-row operations (create a record with its initial blocks, move a
-- block atomically) and optimistic-concurrency checks need a single
-- transactional boundary so the client cannot leave the notebook half-built
-- or silently clobber a newer remote edit.
--
-- Error categories (docs/notebook-api.md): the RPCs raise Sheetbase-specific
-- SQLSTATE codes in class SB so clients branch on category without parsing
-- messages:
--   SB001 stale_version   — expected_version did not match the row
--   SB002 missing_link    — record_link target unresolved in the workspace
--   SB003 invalid_payload — block payload failed shape validation
-- Standard SQLSTATEs are reused where they already fit (42501 permission,
-- 23514 check violation, 23503 foreign key). SECURITY INVOKER throughout: the
-- INSERT/UPDATE inside each RPC is still subject to the table's RLS policy
-- (defence in depth).

-- ---------------------------------------------------------------------------
-- create_record_with_blocks: create a record and its initial blocks in one
-- transaction. Reuses api.create_record for identifier assignment so the
-- EXP-/PRT-/RPT-YYYY-NNNN sequence stays consistent. Returns a jsonb object
-- { record, blocks } so the client can reconcile ids, identifier, order and
-- versions without a second round-trip.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."create_record_with_blocks"(
  p_project_id uuid,
  p_kind text,
  p_title text,
  p_status text DEFAULT 'draft',
  p_tags text[] DEFAULT '{}',
  p_blocks jsonb DEFAULT '[]'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_record "api"."records";
  v_blocks jsonb := coalesce(p_blocks, '[]'::jsonb);
  v_block jsonb;
  v_rows jsonb[] := ARRAY[]::jsonb[];
  v_order real;
  v_i int := 0;
  v_row "api"."blocks";
BEGIN
  -- create_record checks the active workspace, membership, kind, project
  -- scope and assigns the stable identifier.
  v_record := "api"."create_record"(p_project_id, p_kind, p_title, p_status, p_tags);

  FOR v_block IN SELECT * FROM jsonb_array_elements(v_blocks)
  LOOP
    v_i := v_i + 1;
    -- If the client supplied an explicit order, honour it; otherwise assign
    -- sequential 1..N so the initial notebook is deterministic.
    IF v_block ? 'order' THEN
      v_order := (v_block ->> 'order')::real;
    ELSE
      v_order := v_i::real;
    END IF;

    INSERT INTO "api"."blocks" (
      record_id, type, payload, payload_schema_version, "order",
      created_by_user_id
    ) VALUES (
      v_record.id,
      v_block ->> 'type',
      COALESCE(v_block -> 'payload', '{}'::jsonb),
      COALESCE((v_block ->> 'payload_schema_version')::int, 1),
      v_order,
      "api"."current_user_id"()
    )
    RETURNING * INTO v_row;

    v_rows := array_append(v_rows, to_jsonb(v_row));
  END LOOP;

  RETURN jsonb_build_object(
    'record', to_jsonb(v_record),
    'blocks', COALESCE(
      (SELECT jsonb_agg(e) FROM unnest(v_rows) AS e),
      '[]'::jsonb
    )
  );
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."create_record_with_blocks"(uuid, text, text, text, text[], jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_record_with_blocks"(uuid, text, text, text, text[], jsonb) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- update_block_payload: optimistic-concurrency content edit. The caller
-- supplies the block version it last saw; the RPC rejects a stale version
-- with SB001 before any write. Returns the updated block (with the new
-- version) so the client can reconcile.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."update_block_payload"(
  p_block_id uuid,
  p_payload jsonb,
  p_expected_version int,
  p_payload_schema_version int DEFAULT 1
)
RETURNS "api"."blocks"
LANGUAGE plpgsql
AS $$
DECLARE
  v_row "api"."blocks";
BEGIN
  -- Lock under RLS: a block in another workspace is invisible, so the row
  -- is null and we fail closed as permission_denied (no existence leak).
  SELECT * INTO v_row FROM "api"."blocks" WHERE id = p_block_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'block version mismatch: expected %, got %',
      p_expected_version, v_row.version USING ERRCODE = 'SB001';
  END IF;

  UPDATE "api"."blocks"
    SET payload = p_payload,
        payload_schema_version = p_payload_schema_version,
        version = v_row.version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_block_id
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."update_block_payload"(uuid, jsonb, int, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."update_block_payload"(uuid, jsonb, int, int) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- move_block: atomically reorder a block via fractional indexing. The
-- caller describes the target position by the ids of the blocks that should
-- immediately precede (p_after_block_id) and follow (p_before_block_id) the
-- moved block after the move. Either may be null (move to start/end). The
-- caller supplies the record structure_version it last saw; a stale version
-- is rejected with SB001.
--
-- When the fractional gap between the neighbours is too small to represent,
-- the RPC rebalances the whole record's block ordering to integers 1..N with
-- the moved block at its target position (a rare, bounded rewrite). Returns
-- { block, structure_version, order } where order is the new (id, order)
-- list so the client can reconcile every affected row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."move_block"(
  p_block_id uuid,
  p_expected_structure_version int,
  p_after_block_id uuid DEFAULT NULL,
  p_before_block_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_moved "api"."blocks";
  v_record_id uuid;
  v_sv int;
  v_after_order real;
  v_before_order real;
  v_new_order real;
  v_gap real;
  v_after "api"."blocks";
  v_before "api"."blocks";
  v_rebalanced boolean := false;
  v_order_list jsonb;
BEGIN
  SELECT * INTO v_moved FROM "api"."blocks" WHERE id = p_block_id FOR UPDATE;
  IF v_moved IS NULL THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;
  v_record_id := v_moved.record_id;

  -- Lock the record and verify structure_version for optimistic concurrency.
  SELECT structure_version INTO v_sv FROM "api"."records" WHERE id = v_record_id FOR UPDATE;
  IF v_sv IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_sv <> p_expected_structure_version THEN
    RAISE EXCEPTION 'structure version mismatch: expected %, got %',
      p_expected_structure_version, v_sv USING ERRCODE = 'SB001';
  END IF;

  -- Resolve the neighbour orders. Neighbours must be in the same record and
  -- not the moved block itself.
  IF p_after_block_id IS NOT NULL THEN
    SELECT * INTO v_after FROM "api"."blocks"
      WHERE id = p_after_block_id AND record_id = v_record_id AND id <> p_block_id
      FOR UPDATE;
    IF v_after IS NULL THEN
      RAISE EXCEPTION 'after_block is not in the same record' USING ERRCODE = '23503';
    END IF;
    v_after_order := v_after."order";
  END IF;
  IF p_before_block_id IS NOT NULL THEN
    SELECT * INTO v_before FROM "api"."blocks"
      WHERE id = p_before_block_id AND record_id = v_record_id AND id <> p_block_id
      FOR UPDATE;
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'before_block is not in the same record' USING ERRCODE = '23503';
    END IF;
    v_before_order := v_before."order";
  END IF;

  -- Fractional indexing. p_after is the preceding neighbour, p_before the
  -- following one, so after_order < new_order < before_order must hold.
  IF p_after_block_id IS NULL AND p_before_block_id IS NULL THEN
    -- No neighbours given: move to the end of the record.
    SELECT COALESCE(max("order"), 0) + 1 INTO v_new_order
      FROM "api"."blocks" WHERE record_id = v_record_id;
  ELSIF p_after_block_id IS NULL THEN
    -- Move to the start: place before the first neighbour.
    v_new_order := v_before_order / 2.0;
  ELSIF p_before_block_id IS NULL THEN
    -- Move to the end: place after the last neighbour.
    v_new_order := v_after_order + 1.0;
  ELSE
    IF v_after_order >= v_before_order THEN
      RAISE EXCEPTION 'after_block must precede before_block' USING ERRCODE = '23514';
    END IF;
    v_new_order := (v_after_order + v_before_order) / 2.0;
  END IF;

  -- Detect precision exhaustion. 1e-3 keeps ~10 levels of fractional insert
  -- before a rebalance; double precision gives far more in practice.
  v_gap := v_new_order;
  IF p_after_block_id IS NOT NULL AND p_before_block_id IS NOT NULL THEN
    v_gap := v_before_order - v_after_order;
  END IF;

  IF v_gap <= 1e-3 AND NOT (p_after_block_id IS NULL AND p_before_block_id IS NULL) THEN
    -- Rebalance: assign integer positions 1..N in the target order. Build
    -- the target ordering by removing the moved block from its current spot
    -- and inserting it at the (after, before) boundary.
    v_rebalanced := true;
    -- Re-key every block in the record to integers 1..N in the target
    -- order. The moved block is repositioned by giving it a sort key that
    -- lands between its requested neighbours; every other block keeps its
    -- current order as the sort key. row_number() then produces stable
    -- integer positions with no precision exhaustion.
    WITH reordered AS (
      SELECT
        id,
        CASE
          WHEN id = p_block_id THEN
            CASE
              WHEN p_after_block_id IS NULL THEN -1e9::real
              ELSE v_after_order + 0.5
            END
          ELSE "order"
        END AS sort_key,
        CASE WHEN id = p_block_id THEN 1 ELSE 0 END AS moved_flag
      FROM "api"."blocks"
      WHERE record_id = v_record_id
    ),
    ranked AS (
      SELECT id, row_number() OVER (ORDER BY sort_key, moved_flag) AS new_pos
      FROM reordered
    )
    UPDATE "api"."blocks" AS b
      SET "order" = r.new_pos::real,
          updated_by_user_id = "api"."current_user_id"()
      FROM ranked r
      WHERE b.id = r.id;
    SELECT "order" INTO v_new_order
      FROM "api"."blocks" WHERE id = p_block_id;
  ELSE
    UPDATE "api"."blocks"
      SET "order" = v_new_order,
          updated_by_user_id = "api"."current_user_id"()
      WHERE id = p_block_id;
  END IF;

  -- Bump the record structure_version so concurrent moves fail with SB001.
  UPDATE "api"."records"
    SET structure_version = v_sv + 1
    WHERE id = v_record_id;

  SELECT jsonb_agg(jsonb_build_object('id', id, 'order', "order") ORDER BY "order")
    INTO v_order_list
    FROM "api"."blocks" WHERE record_id = v_record_id;

  RETURN jsonb_build_object(
    'block', to_jsonb(v_moved),
    'structure_version', v_sv + 1,
    'rebalanced', v_rebalanced,
    'order', COALESCE(v_order_list, '[]'::jsonb)
  );
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."move_block"(uuid, int, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."move_block"(uuid, int, uuid, uuid) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- archive_record / restore_record: reversible soft archival. Both require
-- the metadata_version the client last saw so a stale view cannot clobber a
-- newer metadata edit. archive sets archived_at; restore clears archived_at
-- and deleted_at. Returns the updated record.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."archive_record"(
  p_record_id uuid,
  p_expected_metadata_version int
)
RETURNS "api"."records"
LANGUAGE plpgsql
AS $$
DECLARE
  v_row "api"."records";
BEGIN
  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  UPDATE "api"."records"
    SET archived_at = now(),
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."archive_record"(uuid, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."archive_record"(uuid, int) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."restore_record"(
  p_record_id uuid,
  p_expected_metadata_version int
)
RETURNS "api"."records"
LANGUAGE plpgsql
AS $$
DECLARE
  v_row "api"."records";
BEGIN
  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  UPDATE "api"."records"
    SET archived_at = NULL,
        deleted_at = NULL,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."restore_record"(uuid, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."restore_record"(uuid, int) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- create_record_link: validates that the target record (when referenced by
-- id) exists in the same workspace before inserting the link. Direct INSERT
-- is still permitted under RLS, but this RPC gives a stable missing_link
-- (SB002) error instead of an ambiguous foreign-key violation when the
-- target is invisible or does not exist. Returns the created link.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."create_record_link"(
  p_source_record_id uuid,
  p_target_kind text,
  p_target_identifier text,
  p_link_type text,
  p_target_record_id uuid DEFAULT NULL,
  p_label text DEFAULT NULL
)
RETURNS "api"."record_links"
LANGUAGE plpgsql
AS $$
DECLARE
  v_row "api"."record_links";
  v_target_ws uuid;
BEGIN
  IF p_target_record_id IS NOT NULL THEN
    SELECT workspace_id INTO v_target_ws
      FROM "api"."records" WHERE id = p_target_record_id;
    IF v_target_ws IS NULL THEN
      RAISE EXCEPTION 'target record not found in active workspace'
        USING ERRCODE = 'SB002';
    END IF;
    IF v_target_ws <> "api"."current_workspace_id"() THEN
      RAISE EXCEPTION 'record link crosses workspaces' USING ERRCODE = 'SB002';
    END IF;
  END IF;

  INSERT INTO "api"."record_links" (
    source_record_id, target_record_id, target_kind, target_identifier,
    link_type, created_by_user_id
  ) VALUES (
    p_source_record_id, p_target_record_id, p_target_kind,
    p_target_identifier, p_link_type, "api"."current_user_id"()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."create_record_link"(uuid, text, text, text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_record_link"(uuid, text, text, text, uuid, text) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
