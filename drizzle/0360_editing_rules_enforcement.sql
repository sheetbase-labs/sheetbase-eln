-- SET-01.3 — editing rules enforced server-side.
--
-- The design's SettingsGeneral states "Ask for a reason when a saved value is
-- changed — The reason is written to History with the old and new value." The
-- rule lives on the workspace, is set by an owner through the settings RPC, and
-- is enforced by triggers on the write tables, so it holds for RPC writes and
-- for direct PostgREST writes alike. The reason travels in the request header
-- `x-sheetbase-change-reason`, which PostgREST exposes as `request.headers`; a
-- workspace that has not opted in behaves exactly as before.
-- The editing-rule parameters replace the previous signature: leaving both in
-- place makes a single-argument call ambiguous.
DROP FUNCTION IF EXISTS "api"."update_workspace_settings"(uuid,text,boolean,jsonb,jsonb,integer,jsonb);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."update_workspace_settings"(
  p_workspace_id uuid,
  p_registration_mode text DEFAULT NULL,
  p_review_workflow_enabled boolean DEFAULT NULL,
  p_review_workflow_config jsonb DEFAULT NULL,
  p_signature_policy jsonb DEFAULT NULL,
  p_audit_retention_days integer DEFAULT NULL,
  p_integration_settings jsonb DEFAULT NULL,
  p_require_change_reason boolean DEFAULT NULL,
  p_lock_on_sign boolean DEFAULT NULL,
  p_allow_offline_editing boolean DEFAULT NULL
) RETURNS "api"."workspace_settings"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v api.workspace_settings;
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id, 'owner') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'owner access required' USING ERRCODE = 'SB056';
  END IF;
  IF p_registration_mode IS NOT NULL AND p_registration_mode NOT IN ('open', 'invitation_only') THEN
    RAISE EXCEPTION 'invalid registration mode' USING ERRCODE = 'SB056';
  END IF;
  IF p_audit_retention_days IS NOT NULL AND p_audit_retention_days <= 0 THEN
    RAISE EXCEPTION 'invalid retention days' USING ERRCODE = 'SB057';
  END IF;
  INSERT INTO api.workspace_settings(
    workspace_id, registration_mode, review_workflow_enabled, review_workflow_config,
    signature_policy, audit_retention_days, integration_settings,
    require_change_reason, lock_on_sign, allow_offline_editing, created_by_user_id)
  VALUES (
    p_workspace_id, coalesce(p_registration_mode, 'open'), coalesce(p_review_workflow_enabled, false),
    coalesce(p_review_workflow_config, '{}'), coalesce(p_signature_policy, '{}'),
    coalesce(p_audit_retention_days, 2555), coalesce(p_integration_settings, '{}'),
    coalesce(p_require_change_reason, false), coalesce(p_lock_on_sign, true),
    coalesce(p_allow_offline_editing, true), api.current_user_id())
  ON CONFLICT (workspace_id) DO UPDATE SET
    registration_mode = coalesce(p_registration_mode, api.workspace_settings.registration_mode),
    review_workflow_enabled = coalesce(p_review_workflow_enabled, api.workspace_settings.review_workflow_enabled),
    review_workflow_config = coalesce(p_review_workflow_config, api.workspace_settings.review_workflow_config),
    signature_policy = coalesce(p_signature_policy, api.workspace_settings.signature_policy),
    audit_retention_days = coalesce(p_audit_retention_days, api.workspace_settings.audit_retention_days),
    integration_settings = coalesce(p_integration_settings, api.workspace_settings.integration_settings),
    require_change_reason = coalesce(p_require_change_reason, api.workspace_settings.require_change_reason),
    lock_on_sign = coalesce(p_lock_on_sign, api.workspace_settings.lock_on_sign),
    allow_offline_editing = coalesce(p_allow_offline_editing, api.workspace_settings.allow_offline_editing),
    updated_at = now()
  RETURNING * INTO v;
  IF p_require_change_reason IS NOT NULL OR p_lock_on_sign IS NOT NULL OR p_allow_offline_editing IS NOT NULL THEN
    PERFORM internal.emit_change_event(v.workspace_id, 'workspace_settings', v.workspace_id, 'update', NULL, NULL,
      jsonb_build_object('effect', 'editing_rules',
        'requireChangeReason', v.require_change_reason,
        'lockOnSign', v.lock_on_sign,
        'allowOfflineEditing', v.allow_offline_editing));
  END IF;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."update_workspace_settings"(uuid,text,boolean,jsonb,jsonb,integer,jsonb,boolean,boolean,boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."update_workspace_settings"(uuid,text,boolean,jsonb,jsonb,integer,jsonb,boolean,boolean,boolean) TO authenticated;
--> statement-breakpoint

-- The reason the caller supplied for this request, if any.
CREATE OR REPLACE FUNCTION "internal"."change_reason_from_request"()
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT nullif(btrim(coalesce(
    (nullif(current_setting('request.headers', true), '')::jsonb)->>'x-sheetbase-change-reason',
    '')), '')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "internal"."change_reason_from_request"() FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "internal"."change_reason_from_request"() TO authenticated;
--> statement-breakpoint

-- A saved value cannot change without a reason where the workspace asks for one.
CREATE OR REPLACE FUNCTION "internal"."enforce_change_reason"()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_workspace uuid;
  v_requires boolean;
  v_reason text := internal.change_reason_from_request();
BEGIN
  -- Resolved per table: plpgsql binds NEW fields per row type, so the branches
  -- must not share one expression.
  IF TG_TABLE_NAME = 'blocks' THEN
    SELECT r.workspace_id INTO v_workspace FROM api.records r WHERE r.id = NEW.record_id;
  ELSE
    v_workspace := NEW.workspace_id;
  END IF;
  IF v_workspace IS NULL THEN RETURN NEW; END IF;
  SELECT s.require_change_reason INTO v_requires FROM api.workspace_settings s WHERE s.workspace_id = v_workspace;
  IF NOT coalesce(v_requires, false) THEN RETURN NEW; END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'a reason is required to change a saved value' USING ERRCODE = 'SB114';
  END IF;
  IF length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'the change reason is too long' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "internal"."enforce_change_reason"() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

-- The reason and the old/new value go to History for the changed block.
CREATE OR REPLACE FUNCTION "internal"."record_change_reason"()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reason text := internal.change_reason_from_request();
BEGIN
  IF v_reason IS NULL THEN RETURN NULL; END IF;
  PERFORM internal.emit_change_event(
    (SELECT r.workspace_id FROM api.records r WHERE r.id = NEW.record_id),
    'block', NEW.id, 'update', NEW.record_id,
    (SELECT r.project_id FROM api.records r WHERE r.id = NEW.record_id),
    jsonb_build_object('reason', v_reason, 'effect', 'value_changed',
      'changes', jsonb_build_object('text', jsonb_build_object(
        'from', left(coalesce(internal.extract_jsonb_text(OLD.payload), ''), 500),
        'to', left(coalesce(internal.extract_jsonb_text(NEW.payload), ''), 500),
        'label', 'Saved value'))));
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "internal"."record_change_reason"() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

DROP TRIGGER IF EXISTS enforce_change_reason ON api.blocks;
--> statement-breakpoint
CREATE TRIGGER enforce_change_reason BEFORE UPDATE ON api.blocks
  FOR EACH ROW WHEN (NEW.payload IS DISTINCT FROM OLD.payload)
  EXECUTE FUNCTION internal.enforce_change_reason();
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_change_reason ON api.blocks;
--> statement-breakpoint
CREATE TRIGGER record_change_reason AFTER UPDATE ON api.blocks
  FOR EACH ROW WHEN (NEW.payload IS DISTINCT FROM OLD.payload)
  EXECUTE FUNCTION internal.record_change_reason();
--> statement-breakpoint

-- Sheet cell values are the other saved value the design names.
DROP TRIGGER IF EXISTS enforce_change_reason ON api.sheet_instances;
--> statement-breakpoint
CREATE TRIGGER enforce_change_reason BEFORE UPDATE ON api.sheet_instances
  FOR EACH ROW WHEN (NEW.state IS DISTINCT FROM OLD.state)
  EXECUTE FUNCTION internal.enforce_change_reason();
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
