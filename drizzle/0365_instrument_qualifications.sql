-- LAB-06.2 — instrument qualification: who may run an instrument, until when.
--
-- The design's SettingsInstruments and RecordInstrument boards show an
-- instrument's qualified-for scope and the people qualified to run it with an
-- expiry. Grants are an admin action on the instrument's workspace and are
-- audited; the table is readable by workspace members so the instrument page
-- and the booking path can both resolve the current state.
ALTER TABLE api.instrument_qualifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY instrument_qualifications_select ON api.instrument_qualifications
  FOR SELECT TO authenticated
  USING (
    workspace_id = api.current_workspace_id()
    AND api.is_workspace_member(workspace_id)
  );
--> statement-breakpoint
GRANT SELECT ON api.instrument_qualifications TO authenticated;
--> statement-breakpoint

-- Granting or extending a qualification. The scope lives on the instrument, so
-- this writes the person's expiry and audits the decision.
CREATE OR REPLACE FUNCTION api.set_instrument_qualification(
  p_instrument_id uuid,
  p_user_id text,
  p_valid_until timestamptz,
  p_qualified_for text DEFAULT NULL
) RETURNS api.instrument_qualifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_instrument api.instruments;
  v_row api.instrument_qualifications;
BEGIN
  SELECT * INTO v_instrument FROM api.instruments
   WHERE id = p_instrument_id AND workspace_id = api.current_workspace_id();
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT api.has_capability(v_instrument.workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
     WHERE m.workspace_id = v_instrument.workspace_id
       AND m.user_id = p_user_id
       AND m.suspended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'an active workspace member is required' USING ERRCODE = '22023';
  END IF;
  IF p_valid_until IS NULL OR p_valid_until <= now() THEN
    RAISE EXCEPTION 'a future qualification expiry is required' USING ERRCODE = '22023';
  END IF;
  IF p_qualified_for IS NOT NULL AND length(btrim(p_qualified_for)) > 200 THEN
    RAISE EXCEPTION 'the qualified-for scope is too long' USING ERRCODE = '22023';
  END IF;

  IF p_qualified_for IS NOT NULL THEN
    UPDATE api.instruments
       SET qualified_for = nullif(btrim(p_qualified_for), ''),
           updated_at = now(),
           updated_by_user_id = api.current_user_id()
     WHERE id = v_instrument.id;
  END IF;

  INSERT INTO api.instrument_qualifications(
    workspace_id, instrument_id, user_id, valid_until, granted_by_user_id)
  VALUES (v_instrument.workspace_id, v_instrument.id, p_user_id, p_valid_until, api.current_user_id())
  ON CONFLICT (instrument_id, user_id) DO UPDATE
    SET valid_until = excluded.valid_until,
        granted_by_user_id = excluded.granted_by_user_id,
        updated_at = now()
  RETURNING * INTO v_row;

  PERFORM internal.emit_change_event(v_instrument.workspace_id, 'instrument', v_instrument.id, 'update',
    NULL, NULL,
    jsonb_build_object('effect', 'qualification_granted', 'userId', p_user_id,
      'validUntil', p_valid_until, 'qualifiedFor', p_qualified_for));
  RETURN v_row;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_instrument_qualification(uuid,text,timestamptz,text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_instrument_qualification(uuid,text,timestamptz,text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.revoke_instrument_qualification(
  p_instrument_id uuid,
  p_user_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_instrument api.instruments;
BEGIN
  SELECT * INTO v_instrument FROM api.instruments
   WHERE id = p_instrument_id AND workspace_id = api.current_workspace_id();
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT api.has_capability(v_instrument.workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api.instrument_qualifications
   WHERE instrument_id = v_instrument.id AND user_id = p_user_id;
  PERFORM internal.emit_change_event(v_instrument.workspace_id, 'instrument', v_instrument.id, 'update',
    NULL, NULL,
    jsonb_build_object('effect', 'qualification_revoked', 'userId', p_user_id));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.revoke_instrument_qualification(uuid,text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.revoke_instrument_qualification(uuid,text) TO authenticated;
--> statement-breakpoint

-- Who may run this instrument right now, with the expiry that decides it.
CREATE OR REPLACE FUNCTION api.instrument_qualification_list(p_instrument_id uuid)
RETURNS TABLE(user_id text, user_name text, valid_until timestamptz, current boolean, qualified_for text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT q.user_id, u.name, q.valid_until, q.valid_until > now(), i.qualified_for
    FROM api.instrument_qualifications q
    JOIN api.instruments i ON i.id = q.instrument_id
    LEFT JOIN internal."user" u ON u.id = q.user_id
   WHERE q.instrument_id = p_instrument_id
     AND q.workspace_id = api.current_workspace_id()
     AND api.is_workspace_member(q.workspace_id)
   ORDER BY q.valid_until DESC, q.user_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.instrument_qualification_list(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.instrument_qualification_list(uuid) TO authenticated;
--> statement-breakpoint

-- The person's own state, for the booking path and the instrument page.
CREATE OR REPLACE FUNCTION internal.instrument_qualified(
  p_instrument_id uuid,
  p_user_id text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM api.instrument_qualifications q
     WHERE q.instrument_id = p_instrument_id
       AND q.user_id = p_user_id
       AND q.valid_until > now())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.instrument_qualified(uuid,text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.instrument_qualified(uuid,text) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
