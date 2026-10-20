-- A colleague who cannot book an instrument because they are not qualified can
-- ask for it, and the people who can grant it are told.
--
-- Booking is refused with SB115 until an owner grants a qualification
-- (api.set_instrument_qualification), but nothing told the owner anyone was
-- waiting, and nothing told the booker it had been granted. This adds:
--
--   api.instrument_qualification_requests   one open request per person and
--                                           instrument
--   api.request_instrument_qualification    the person asks (idempotent)
--   api.dismiss_instrument_qualification_request
--                                           an owner declines
--   api.set_instrument_qualification        also settles the person's open
--                                           request as granted
--
-- and two Inbox items derived from the rows:
--
--   qualification_requested   workspace owners and admins other than the
--                             requester, while the request is open
--   qualification_granted     the requester, for fourteen days after the grant

CREATE TABLE api.instrument_qualification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
  instrument_id uuid NOT NULL REFERENCES api.instruments(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE CASCADE,
  note text,
  status text NOT NULL DEFAULT 'pending',
  decided_by_user_id text REFERENCES internal."user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_instrument_qualification_request_status
    CHECK (status IN ('pending', 'granted', 'dismissed')),
  CONSTRAINT chk_instrument_qualification_request_note
    CHECK (note IS NULL OR length(btrim(note)) <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_instrument_qualification_pending_request
  ON api.instrument_qualification_requests(instrument_id, user_id)
  WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX idx_instrument_qualification_requests_workspace
  ON api.instrument_qualification_requests(workspace_id);
--> statement-breakpoint

ALTER TABLE api.instrument_qualification_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A person sees their own requests; owners and admins see everyone's.
CREATE POLICY instrument_qualification_requests_select
  ON api.instrument_qualification_requests
  FOR SELECT TO authenticated
  USING (
    workspace_id = api.current_workspace_id()
    AND api.is_workspace_member(workspace_id)
    AND (user_id = api.current_user_id()
         OR api.has_capability(workspace_id, 'workspace.admin'))
  );
--> statement-breakpoint
GRANT SELECT ON api.instrument_qualification_requests TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.request_instrument_qualification(
  p_instrument_id uuid,
  p_note text DEFAULT NULL
) RETURNS api.instrument_qualification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_instrument api.instruments;
  v_user text := api.current_user_id();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row api.instrument_qualification_requests;
BEGIN
  SELECT * INTO v_instrument FROM api.instruments
   WHERE id = p_instrument_id AND workspace_id = api.current_workspace_id();
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_user IS NULL OR NOT api.is_workspace_writer(v_instrument.workspace_id) THEN
    RAISE EXCEPTION 'a workspace writer is required' USING ERRCODE = '42501';
  END IF;
  IF v_instrument.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'this instrument is retired' USING ERRCODE = '22023';
  END IF;
  IF internal.instrument_qualified(v_instrument.id, v_user) THEN
    RAISE EXCEPTION 'you are already qualified on this instrument' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'the note is too long' USING ERRCODE = '22023';
  END IF;

  INSERT INTO api.instrument_qualification_requests(
    workspace_id, instrument_id, user_id, note)
  VALUES (v_instrument.workspace_id, v_instrument.id, v_user, v_note)
  ON CONFLICT (instrument_id, user_id) WHERE status = 'pending'
  DO UPDATE SET note = coalesce(excluded.note, api.instrument_qualification_requests.note),
                updated_at = now()
  RETURNING * INTO v_row;

  PERFORM internal.emit_change_event(v_instrument.workspace_id, 'instrument', v_instrument.id, 'update',
    NULL, NULL,
    jsonb_build_object('effect', 'qualification_requested', 'userId', v_user));
  RETURN v_row;
END $function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.request_instrument_qualification(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.request_instrument_qualification(uuid, text) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.dismiss_instrument_qualification_request(p_request_id uuid)
RETURNS api.instrument_qualification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row api.instrument_qualification_requests;
BEGIN
  SELECT * INTO v_row FROM api.instrument_qualification_requests
   WHERE id = p_request_id AND workspace_id = api.current_workspace_id();
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'request not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT api.has_capability(v_row.workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'this request has already been settled' USING ERRCODE = '22023';
  END IF;
  UPDATE api.instrument_qualification_requests
     SET status = 'dismissed', decided_by_user_id = api.current_user_id(), updated_at = now()
   WHERE id = v_row.id
   RETURNING * INTO v_row;
  RETURN v_row;
END $function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.dismiss_instrument_qualification_request(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.dismiss_instrument_qualification_request(uuid) TO authenticated;
--> statement-breakpoint

-- Granting settles the person's open request, so the owner's item clears and
-- the booker is told. Unchanged otherwise.
CREATE OR REPLACE FUNCTION api.set_instrument_qualification(
  p_instrument_id uuid,
  p_user_id text,
  p_valid_until timestamptz,
  p_qualified_for text DEFAULT NULL
) RETURNS api.instrument_qualifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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

  UPDATE api.instrument_qualification_requests
     SET status = 'granted', decided_by_user_id = api.current_user_id(), updated_at = now()
   WHERE instrument_id = v_instrument.id
     AND user_id = p_user_id
     AND status = 'pending';

  PERFORM internal.emit_change_event(v_instrument.workspace_id, 'instrument', v_instrument.id, 'update',
    NULL, NULL,
    jsonb_build_object('effect', 'qualification_granted', 'userId', p_user_id,
      'validUntil', p_valid_until, 'qualifiedFor', p_qualified_for));
  RETURN v_row;
END $function$;
--> statement-breakpoint

DO $$
DECLARE previous text;
BEGIN
  SELECT rtrim(pg_get_viewdef('api.my_work_items'::regclass,true),E';\n ') INTO previous;
  EXECUTE 'CREATE OR REPLACE VIEW api.my_work_items WITH(security_invoker=true) AS
    SELECT old.* FROM ('||previous||') old

    UNION ALL
    -- A colleague asked to be qualified on an instrument; owners and admins decide.
    SELECT ''qualification_requested''::text,NULL::uuid,i.serial_number,
      coalesce(api.workspace_member_label(q.user_id),''A colleague'')||'' on ''||i.name,
      NULL::uuid,
      coalesce(q.note,''Asked to be qualified so they can book it'')::text,
      NULL::timestamptz,''needs_action''::text,q.created_at,
      ''instrument_qualification_request''::text,i.id,NULL::uuid,NULL::uuid,NULL::uuid
    FROM api.instrument_qualification_requests q
    JOIN api.instruments i ON i.id=q.instrument_id
    WHERE q.workspace_id=api.current_workspace_id()
      AND q.status=''pending''
      AND q.user_id<>api.current_user_id()
      AND api.has_capability(q.workspace_id,''workspace.admin'')

    UNION ALL
    -- The person who asked learns they can book now.
    SELECT ''qualification_granted''::text,NULL::uuid,i.serial_number,i.name,
      NULL::uuid,
      ''You are qualified on ''||i.name||''. You can book it now''::text,
      NULL::timestamptz,''needs_action''::text,q.updated_at,
      ''instrument_qualification_request''::text,i.id,NULL::uuid,NULL::uuid,NULL::uuid
    FROM api.instrument_qualification_requests q
    JOIN api.instruments i ON i.id=q.instrument_id
    WHERE q.workspace_id=api.current_workspace_id()
      AND q.status=''granted''
      AND q.user_id=api.current_user_id()
      AND q.updated_at>now()-interval ''14 days''';
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
