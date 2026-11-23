-- Materials were called reagents when the status change list was written, so
-- the list still names `reagent:` and no material could change status through
-- this function. Same changes, under the name records use today.
CREATE OR REPLACE FUNCTION api.transition_record_status(p_record_id uuid, p_target_status text, p_expected_metadata_version integer) RETURNS api.records
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_row "api"."records";
  v_allowed text[];
  v_transition_key text;
BEGIN
  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'archived records are frozen; restore before transitioning'
      USING ERRCODE = 'SB004';
  END IF;

  v_transition_key := v_row.kind || ':' || v_row.status || '->' || p_target_status;
  v_allowed := ARRAY[
    'sample:available->reserved',
    'sample:available->consumed',
    'sample:available->quarantined',
    'sample:reserved->available',
    'sample:reserved->consumed',
    'sample:quarantined->available',
    'material:available->reserved',
    'material:available->consumed',
    'material:available->quarantined',
    'material:available->expired',
    'material:reserved->available',
    'material:reserved->consumed',
    'material:quarantined->available',
    'protocol_template:draft->active',
    'protocol_template:draft->under_review',
    'protocol_template:under_review->active',
    'protocol_template:under_review->draft',
    'protocol_template:active->draft',
    'notebook_template:draft->validated',
    'notebook_template:validated->draft'
  ];

  IF NOT (v_transition_key = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'invalid status transition for kind %: % -> %',
      v_row.kind, v_row.status, p_target_status USING ERRCODE = 'SB004';
  END IF;

  UPDATE "api"."records"
    SET status = p_target_status,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
