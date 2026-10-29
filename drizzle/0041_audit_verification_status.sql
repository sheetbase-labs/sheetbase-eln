-- Anyone in the workspace can see whether the audit trail and the signed
-- records were last found intact, and when.
--
-- The nightly check already writes its result as a System entry in the audit
-- log, but only people who can open the audit settings could read it. This
-- hands the latest result to every member, so a signed record can say
-- "verified, last checked" without sending the reader to Settings.

CREATE FUNCTION api.audit_verification_status() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace uuid := api.current_workspace_id();
  v_event record;
BEGIN
  IF v_workspace IS NULL OR NOT api.is_workspace_member(v_workspace) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  SELECT e.payload, e.created_at INTO v_event
    FROM api.change_events e
   WHERE e.workspace_id = v_workspace
     AND e.entity_type = 'system'
     AND e.payload ? 'chain'
   ORDER BY e.sequence DESC
   LIMIT 1;
  IF v_event IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'ok', (v_event.payload->>'ok')::boolean,
    'checkedAt', v_event.created_at,
    'entriesChecked', (v_event.payload->'chain'->>'entriesChecked')::integer,
    'signaturesChecked', (v_event.payload->'signedRevisions'->>'checked')::integer,
    'firstBadRevisionId', v_event.payload->'signedRevisions'->>'firstBadRevisionId');
END $$;
--> statement-breakpoint
ALTER FUNCTION api.audit_verification_status() OWNER TO migrator;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.audit_verification_status() TO authenticated;
