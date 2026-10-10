-- LAB-04.2 — register a replacement lot.
--
-- A replacement is a sibling lot for the same material: it inherits the supplier,
-- catalogue number and storage location, takes a new lot number, expiry and
-- quantity, and is linked to the lot it replaces so the inspector can say whether
-- a replacement exists. It is created through api.create_record, so it takes the
-- next identifier from the material sequence like any other lot.
-- The return type changes between revisions, so drop first.
DROP FUNCTION IF EXISTS api.register_replacement_lot(uuid,text,date,numeric,text,text);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.register_replacement_lot(
  p_reagent_record_id uuid,
  p_lot text,
  p_expiry date,
  p_quantity numeric,
  p_unit text DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_source api.records;
  v_properties jsonb;
  v_unit text;
  v_replacement api.records;
BEGIN
  SELECT * INTO v_source FROM api.records
   WHERE id = p_reagent_record_id AND deleted_at IS NULL
   FOR UPDATE;
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_source.kind <> 'reagent' THEN
    RAISE EXCEPTION 'not a material' USING ERRCODE = '22023';
  END IF;
  IF NOT api.is_workspace_writer(v_source.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_object_access('record', p_reagent_record_id, 'edit');

  IF p_lot IS NULL OR length(btrim(p_lot)) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'a lot number is required' USING ERRCODE = '22023';
  END IF;
  IF p_lot IS NOT DISTINCT FROM v_source.properties->>'lot' THEN
    RAISE EXCEPTION 'the replacement needs a new lot number' USING ERRCODE = '22023';
  END IF;
  IF p_expiry IS NULL THEN
    RAISE EXCEPTION 'an expiry date is required' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'a positive quantity is required' USING ERRCODE = '22023';
  END IF;

  v_unit := nullif(btrim(coalesce(p_unit, '')), '');
  IF v_unit IS NULL THEN
    v_unit := v_source.properties->>'unit';
  END IF;

  -- Inherit the material identity, replace the lot facts.
  v_properties := (v_source.properties - 'lot' - 'expiry' - 'quantity' - 'unit')
    || jsonb_build_object(
         'lot', btrim(p_lot),
         'expiry', to_char(p_expiry, 'YYYY-MM-DD'),
         'quantity', p_quantity)
    || CASE WHEN v_unit IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('unit', v_unit) END;

  v_replacement := api.create_record(
    v_source.project_id, 'reagent', v_source.title, 'available', v_source.tags,
    v_properties);

  INSERT INTO api.record_links
    (source_record_id, target_record_id, target_kind, target_identifier, link_type,
     link_metadata, created_by_user_id)
  VALUES (v_source.id, v_replacement.id, 'reagent', v_replacement.identifier, 'reagent',
          jsonb_build_object(
            'relation', 'replacement',
            'reason', nullif(btrim(coalesce(p_reason, '')), '')),
          api.current_user_id())
  ON CONFLICT (source_record_id, target_identifier, link_type) DO NOTHING;

  RETURN jsonb_build_object(
    'id', v_replacement.id,
    'identifier', v_replacement.identifier,
    'title', v_replacement.title,
    'projectId', v_replacement.project_id,
    'metadataVersion', v_replacement.metadata_version,
    'lot', btrim(p_lot),
    'expiry', to_char(p_expiry, 'YYYY-MM-DD'),
    'quantity', p_quantity,
    'unit', v_unit);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.register_replacement_lot(uuid,text,date,numeric,text,text)
  FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.register_replacement_lot(uuid,text,date,numeric,text,text) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
