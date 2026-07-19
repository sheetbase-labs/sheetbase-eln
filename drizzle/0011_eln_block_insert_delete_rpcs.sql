-- ELN-005: block insertion and deletion RPCs. Direct INSERT/DELETE on
-- api.blocks are permitted under RLS, but those paths do not bump the
-- record's structure_version, so a concurrent move_block would not see a
-- stale-version error. These two RPCs wrap the write with a structure
-- version bump and a stale-version guard, mirroring move_block.
--
-- insert_block: append a block at the end of the record, or insert it
-- immediately after a given anchor block via fractional indexing. Validates
-- the expected structure_version (SB001 on mismatch). Returns the created
-- block and the new structure_version so the client reconciles ids, order
-- and versions in one round-trip.
--
-- delete_block: remove a block and bump the structure_version. Returns the
-- new structure_version and the surviving (id, order) list (order is
-- unchanged on delete; the list lets the client confirm what remains).
--
-- Payload shape validation stays at the application boundary (src/lib/blocks),
-- consistent with ELN-002/003. The RPCs trust the caller's payload once the
-- type is a known block type.
CREATE OR REPLACE FUNCTION "api"."insert_block"(
  p_record_id uuid,
  p_type text,
  p_payload jsonb,
  p_payload_schema_version int DEFAULT 1,
  p_after_block_id uuid DEFAULT NULL,
  p_expected_structure_version int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_record "api"."records";
  v_sv int;
  v_new_order real;
  v_after "api"."blocks";
  v_next "api"."blocks";
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

  IF p_after_block_id IS NOT NULL THEN
    SELECT * INTO v_after FROM "api"."blocks"
      WHERE id = p_after_block_id AND record_id = p_record_id
      FOR UPDATE;
    IF v_after IS NULL THEN
      RAISE EXCEPTION 'after_block is not in this record' USING ERRCODE = '23503';
    END IF;
    -- First block after the anchor, by order.
    SELECT * INTO v_next FROM "api"."blocks"
      WHERE record_id = p_record_id AND "order" > v_after."order"
      ORDER BY "order" ASC LIMIT 1
      FOR UPDATE;
    IF v_next IS NULL THEN
      v_new_order := v_after."order" + 1.0;
    ELSE
      v_new_order := (v_after."order" + v_next."order") / 2.0;
    END IF;
  ELSE
    SELECT COALESCE(max("order"), 0) + 1 INTO v_new_order
      FROM "api"."blocks" WHERE record_id = p_record_id;
  END IF;

  v_id := gen_random_uuid();
  INSERT INTO "api"."blocks" (
    id, record_id, type, payload, payload_schema_version, "order", created_by_user_id
  ) VALUES (
    v_id, p_record_id, p_type, p_payload, p_payload_schema_version, v_new_order,
    "api"."current_user_id"()
  );

  UPDATE "api"."records"
    SET structure_version = v_sv + 1
    WHERE id = p_record_id;

  SELECT * INTO v_block FROM "api"."blocks" WHERE id = v_id;

  RETURN jsonb_build_object(
    'block', to_jsonb(v_block),
    'structure_version', v_sv + 1
  );
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."insert_block"(uuid, text, jsonb, int, uuid, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."insert_block"(uuid, text, jsonb, int, uuid, int) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."delete_block"(
  p_block_id uuid,
  p_expected_structure_version int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_block "api"."blocks";
  v_record_id uuid;
  v_sv int;
  v_order_list jsonb;
BEGIN
  SELECT * INTO v_block FROM "api"."blocks" WHERE id = p_block_id FOR UPDATE;
  IF v_block IS NULL THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;
  v_record_id := v_block.record_id;

  SELECT structure_version INTO v_sv FROM "api"."records" WHERE id = v_record_id FOR UPDATE;
  IF v_sv IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF p_expected_structure_version IS NOT NULL AND v_sv <> p_expected_structure_version THEN
    RAISE EXCEPTION 'structure version mismatch: expected %, got %',
      p_expected_structure_version, v_sv USING ERRCODE = 'SB001';
  END IF;

  DELETE FROM "api"."blocks" WHERE id = p_block_id;

  UPDATE "api"."records"
    SET structure_version = v_sv + 1
    WHERE id = v_record_id;

  SELECT jsonb_agg(jsonb_build_object('id', id, 'order', "order") ORDER BY "order")
    INTO v_order_list
    FROM "api"."blocks" WHERE record_id = v_record_id;

  RETURN jsonb_build_object(
    'structure_version', v_sv + 1,
    'order', COALESCE(v_order_list, '[]'::jsonb)
  );
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."delete_block"(uuid, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."delete_block"(uuid, int) TO authenticated;--> statement-breakpoint
