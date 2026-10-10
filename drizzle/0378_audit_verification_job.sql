-- REV-05.2 — the nightly verification job records its result as a System entry.
--
-- DEC-04: "SHA-256 hash chain, nightly verification at 06:00". The job verifies
-- the audit chain (REV-05.1) and every signed revision's integrity digest, then
-- writes one System entry per workspace whose payload is the result, so the log
-- itself shows whether the trail is intact.
--
-- 'system' becomes a valid audit subject: the entry is about the trail, not
-- about a record.
DO $$ DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'chk_change_events_entity_type'
     AND conrelid = 'api.change_events'::regclass;
  ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type '
       || replace(v_def, ']))', ', ''system''::text]))');
END $$;
--> statement-breakpoint

-- Chain verification moves into internal so the job and the API share one
-- implementation. The API wrapper keeps its admin check and shape.
CREATE OR REPLACE FUNCTION internal.verify_audit_chain(p_workspace_id uuid)
RETURNS TABLE(ok boolean, checked integer, first_bad_sequence bigint, first_bad_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r record;
  v_previous text;
  v_expected text;
  v_checked integer := 0;
BEGIN
  FOR r IN SELECT * FROM api.change_events e WHERE e.workspace_id = p_workspace_id ORDER BY e.sequence LOOP
    v_expected := internal.audit_entry_hash(
      v_previous, r.workspace_id, r.sequence, r.entity_type, r.entity_uuid,
      r.operation, r.record_id, r.project_id, r.actor_user_id,
      r.actor_credential_id, r.client_id, r.payload, r.created_at);
    v_checked := v_checked + 1;
    IF r.previous_hash IS DISTINCT FROM v_previous OR r.entry_hash IS DISTINCT FROM v_expected THEN
      RETURN QUERY SELECT false, v_checked, r.sequence, r.id;
      RETURN;
    END IF;
    v_previous := r.entry_hash;
  END LOOP;
  RETURN QUERY SELECT true, v_checked, NULL::bigint, NULL::uuid;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.verify_audit_chain(uuid) FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.verify_audit_chain(p_workspace_id uuid)
RETURNS TABLE(ok boolean, checked integer, first_bad_sequence bigint, first_bad_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_capability(p_workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM internal.verify_audit_chain(p_workspace_id);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.verify_audit_chain(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.verify_audit_chain(uuid) TO authenticated;
--> statement-breakpoint

-- Signed revisions: recompute the digest of the frozen snapshot and compare it
-- with both the digest captured at signing and the revision's own digest, so a
-- rewritten revision is detected even though the signature row is untouched.
CREATE OR REPLACE FUNCTION internal.verify_signed_revisions(p_workspace_id uuid)
RETURNS TABLE(ok boolean, checked integer, first_bad_signature_id uuid, first_bad_revision_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r record;
  v_expected text;
  v_checked integer := 0;
BEGIN
  FOR r IN
    SELECT s.id AS signature_id, s.revision_id, s.revision_integrity_digest AS signed_digest,
           rev.canonical_snapshot, rev.integrity_digest AS stored_digest
      FROM api.signatures s
      JOIN api.revisions rev ON rev.id = s.revision_id
     WHERE s.workspace_id = p_workspace_id
     ORDER BY s.signed_at, s.id
  LOOP
    v_expected := internal.revision_integrity_digest(r.canonical_snapshot);
    v_checked := v_checked + 1;
    IF v_expected IS DISTINCT FROM r.signed_digest OR v_expected IS DISTINCT FROM r.stored_digest THEN
      RETURN QUERY SELECT false, v_checked, r.signature_id, r.revision_id;
      RETURN;
    END IF;
  END LOOP;
  RETURN QUERY SELECT true, v_checked, NULL::uuid, NULL::uuid;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.verify_signed_revisions(uuid) FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.run_audit_verification(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_chain record;
  v_signed record;
  v_result jsonb;
  v_sequence bigint;
BEGIN
  -- User-facing callers must be an admin of the workspace they verify. The
  -- scheduled runner has no claim probe at all and is accepted only because it
  -- connects as this function's owner (the migrator role that applied it).
  IF api.claim_probe() IS NOT NULL THEN
    IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
       OR NOT api.has_capability(p_workspace_id, 'workspace.admin') THEN
      RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT pg_has_role(
      current_user,
      (SELECT proowner FROM pg_proc
        WHERE oid = 'api.run_audit_verification(uuid)'::regprocedure),
      'USAGE') THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_chain FROM internal.verify_audit_chain(p_workspace_id);
  SELECT * INTO v_signed FROM internal.verify_signed_revisions(p_workspace_id);

  v_result := jsonb_build_object(
    'ok', v_chain.ok AND v_signed.ok,
    'verifiedAt', now(),
    'chain', jsonb_build_object(
      'ok', v_chain.ok,
      'entriesChecked', v_chain.checked,
      'firstBadSequence', v_chain.first_bad_sequence,
      'firstBadId', v_chain.first_bad_id),
    'signedRevisions', jsonb_build_object(
      'ok', v_signed.ok,
      'checked', v_signed.checked,
      'firstBadSignatureId', v_signed.first_bad_signature_id,
      'firstBadRevisionId', v_signed.first_bad_revision_id));

  -- A System entry: no actor, subject 'system', the result as the payload. It is
  -- written directly because internal.emit_change_event is a no-op without a
  -- claim probe, and the job deliberately runs without a user session.
  INSERT INTO api.workspace_change_seq(workspace_id,last_seq) VALUES(p_workspace_id,1)
    ON CONFLICT(workspace_id) DO UPDATE
      SET last_seq=api.workspace_change_seq.last_seq+1, updated_at=now()
    RETURNING last_seq INTO v_sequence;
  INSERT INTO api.change_events(id,workspace_id,sequence,entity_type,entity_uuid,operation,payload)
    VALUES(gen_random_uuid(), p_workspace_id, v_sequence, 'system', gen_random_uuid(), 'create', v_result);

  RETURN v_result;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.run_audit_verification(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.run_audit_verification(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
