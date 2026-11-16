-- A robot can pipette only so little and so much at a time. Store the smallest
-- and largest transfer it takes, so a worklist made for it (from hits, from a
-- stamp or from a plate) fills in its volume limits instead of each person
-- typing them again.
ALTER TABLE api.instrument_robot_settings
    ADD COLUMN min_transfer_ul numeric,
    ADD COLUMN max_transfer_ul numeric;
--> statement-breakpoint
ALTER TABLE api.instrument_robot_settings
    ADD CONSTRAINT chk_instrument_robot_settings_limits CHECK (
        (min_transfer_ul IS NULL OR min_transfer_ul > 0)
        AND (max_transfer_ul IS NULL OR max_transfer_ul > 0)
        AND (min_transfer_ul IS NULL OR max_transfer_ul IS NULL OR min_transfer_ul <= max_transfer_ul)
    );
--> statement-breakpoint
DROP FUNCTION api.set_instrument_robot(uuid, text, text, jsonb);
--> statement-breakpoint
CREATE FUNCTION api.set_instrument_robot(
    p_instrument_id uuid, p_driver text, p_worklist_format text DEFAULT NULL,
    p_labware jsonb DEFAULT '{}'::jsonb,
    p_min_transfer_ul numeric DEFAULT NULL, p_max_transfer_ul numeric DEFAULT NULL)
RETURNS api.instrument_robot_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_instrument api.instruments;
  v_format text;
  r api.instrument_robot_settings;
BEGIN
  SELECT * INTO v_instrument FROM api.instruments
   WHERE id = p_instrument_id AND workspace_id = api.current_workspace_id();
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF api.has_capability(v_instrument.workspace_id, 'instrument.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs instrument.manage' USING ERRCODE = '42501';
  END IF;
  IF p_driver IS NULL OR p_driver NOT IN ('opentrons', 'file') THEN
    RAISE EXCEPTION 'choose how Sheetbase reaches this robot' USING ERRCODE = '22023';
  END IF;
  v_format := coalesce(nullif(btrim(p_worklist_format), ''), CASE p_driver WHEN 'opentrons' THEN 'opentrons' ELSE 'csv' END);
  IF p_driver = 'opentrons' AND v_format <> 'opentrons' THEN
    RAISE EXCEPTION 'an Opentrons robot runs an Opentrons protocol' USING ERRCODE = '22023';
  END IF;
  IF v_format NOT IN ('csv', 'echo', 'tecan_gwl', 'hamilton', 'opentrons') THEN
    RAISE EXCEPTION 'unknown worklist format' USING ERRCODE = '22023';
  END IF;
  IF p_labware IS NULL OR jsonb_typeof(p_labware) <> 'object' THEN
    RAISE EXCEPTION 'the labware must be an object' USING ERRCODE = '22023';
  END IF;
  IF (p_min_transfer_ul IS NOT NULL AND p_min_transfer_ul <= 0)
     OR (p_max_transfer_ul IS NOT NULL AND p_max_transfer_ul <= 0) THEN
    RAISE EXCEPTION 'a transfer limit must be more than zero' USING ERRCODE = '22023';
  END IF;
  IF p_min_transfer_ul IS NOT NULL AND p_max_transfer_ul IS NOT NULL
     AND p_min_transfer_ul > p_max_transfer_ul THEN
    RAISE EXCEPTION 'the smallest transfer cannot be larger than the largest' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.instrument_robot_settings
    (instrument_id, workspace_id, driver, worklist_format, labware,
     min_transfer_ul, max_transfer_ul, updated_by_user_id)
  VALUES (v_instrument.id, v_instrument.workspace_id, p_driver, v_format, p_labware,
          p_min_transfer_ul, p_max_transfer_ul, api.current_user_id())
  ON CONFLICT (instrument_id) DO UPDATE
     SET driver = EXCLUDED.driver, worklist_format = EXCLUDED.worklist_format,
         labware = EXCLUDED.labware,
         min_transfer_ul = EXCLUDED.min_transfer_ul, max_transfer_ul = EXCLUDED.max_transfer_ul,
         updated_at = now(), updated_by_user_id = EXCLUDED.updated_by_user_id
  RETURNING * INTO r;
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_instrument_robot(uuid, text, text, jsonb, numeric, numeric) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_instrument_robot(uuid, text, text, jsonb, numeric, numeric) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_instrument_robot(uuid, text, text, jsonb, numeric, numeric) TO authenticated;
