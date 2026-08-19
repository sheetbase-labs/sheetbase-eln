-- CORE-06.5 P1: templatePlacementId provenance must be system-managed.
-- Public block payload updates may not add/remove/mutate templatePlacementId.

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

  IF v_row.type = 'sheet'
     AND (
       (v_row.payload ? 'templatePlacementId') <> (p_payload ? 'templatePlacementId')
       OR (
         p_payload ? 'templatePlacementId'
         AND v_row.payload->>'templatePlacementId' IS DISTINCT FROM p_payload->>'templatePlacementId'
       )
     ) THEN
    RAISE EXCEPTION 'templatePlacementId is system-managed and cannot be changed via update_block_payload'
      USING ERRCODE = '23514';
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
$$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
