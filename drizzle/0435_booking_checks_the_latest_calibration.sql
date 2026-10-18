-- 0430's guard refused a booking when ANY calibration row was past due, so recording a fresh
-- certificate never cleared an instrument whose earlier rows had lapsed. Its own comment states the
-- intent: the LATEST calibration must not be overdue. This restates the one shared guard that way;
-- create_booking and edit_booking call it, so neither changes.
CREATE OR REPLACE FUNCTION "internal"."assert_instrument_bookable"(
  p_resource "api"."calendar_resources"
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instrument "api"."instruments";
  v_latest_due timestamptz;
BEGIN
  IF p_resource.resource_type IS DISTINCT FROM 'instrument' THEN
    RETURN;
  END IF;

  SELECT * INTO v_instrument FROM "api"."instruments"
   WHERE id = p_resource.id
     AND workspace_id = p_resource.workspace_id;
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = 'SB021';
  END IF;
  IF v_instrument.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'resource is inactive and cannot be booked' USING ERRCODE = 'SB005';
  END IF;
  IF NOT "internal"."instrument_qualified"(v_instrument.id, "api"."current_user_id"()) THEN
    RAISE EXCEPTION 'a current qualification is required to book this instrument' USING ERRCODE = 'SB115';
  END IF;

  SELECT c.due_at INTO v_latest_due
    FROM "api"."instrument_calibrations" c
   WHERE c.instrument_id = v_instrument.id
   ORDER BY c.performed_at DESC NULLS LAST, c.created_at DESC
   LIMIT 1;
  IF v_latest_due IS NOT NULL AND v_latest_due < now() THEN
    RAISE EXCEPTION 'the instrument calibration is overdue' USING ERRCODE = 'SB116';
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "internal"."assert_instrument_bookable"("api"."calendar_resources") FROM PUBLIC, anon, authenticated, api_client;
