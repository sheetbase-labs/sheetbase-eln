-- Phase 4 — signature identity verification is a work item on both sides.
--
-- A person who cannot sign until an administrator confirms their identity is
-- waiting on that administrator, and the administrator had no way to learn they
-- were being waited on short of opening Settings > Signatures. Both ends become
-- Inbox items, derived from the certification row:
--
--   verification_requested  an owner or administrator other than the requester,
--                           while the request is open (requested, not verified)
--   verification_granted    the requester, once verified and until they have
--                           certified again, within fourteen days
--
-- The administrator test is the one api.verify_signature_identity applies
-- (an active owner or admin who is not the requester), so nobody is shown an
-- item they would be refused on opening.

DO $$
DECLARE previous text;
BEGIN
  SELECT rtrim(pg_get_viewdef('api.my_work_items'::regclass,true),E';\n ') INTO previous;
  EXECUTE 'CREATE OR REPLACE VIEW api.my_work_items WITH(security_invoker=true) AS
    SELECT old.* FROM ('||previous||') old

    UNION ALL
    SELECT ''verification_requested''::text,NULL::uuid,NULL::text,
      coalesce(api.workspace_member_label(c.user_id),''A colleague'')::text,NULL::uuid,
      ''Waiting for you to verify their identity so they can sign''::text,
      NULL::timestamptz,''needs_action''::text,c.certified_at,
      ''signature_identity_verification''::text,c.id,NULL::uuid,NULL::uuid,NULL::uuid
    FROM api.user_signature_certifications c
    WHERE c.workspace_id=api.current_workspace_id()
      AND c.credential_session_id IS NOT NULL
      AND c.identity_verified_at IS NULL
      AND c.user_id<>api.current_user_id()
      AND EXISTS(SELECT 1 FROM api.workspace_memberships m
        WHERE m.workspace_id=c.workspace_id AND m.user_id=api.current_user_id()
          AND m.suspended_at IS NULL AND m.role IN (''owner'',''admin''))

    UNION ALL
    SELECT ''verification_granted''::text,NULL::uuid,NULL::text,
      ''Your identity was verified''::text,NULL::uuid,
      ''Verified by ''||coalesce(api.workspace_member_label(c.identity_verified_by),''an administrator'')
        ||''. Certify your signature to sign''::text,
      NULL::timestamptz,''needs_action''::text,c.identity_verified_at,
      ''signature_identity_verification''::text,c.id,NULL::uuid,NULL::uuid,NULL::uuid
    FROM api.user_signature_certifications c
    WHERE c.workspace_id=api.current_workspace_id()
      AND c.user_id=api.current_user_id()
      AND c.identity_verified_at IS NOT NULL
      AND c.identity_verified_at>now()-interval ''14 days''
      AND (c.certified_at IS NULL OR c.revoked_at IS NOT NULL)';
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
