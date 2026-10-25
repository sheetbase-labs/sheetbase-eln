-- Workspace AI access flags.
--
-- These flags are coarse owner-controlled switches over the AI surfaces. They
-- only reduce what scopes, workspace roles and RLS already allow. They are not
-- permissions and cannot grant access. `ai_enabled` remains the master switch.
--
-- The flags live on `workspace_settings` so the existing owner-only update path
-- and change-event trigger continue to audit who changed them. The JSON shape
-- is validated by a check constraint, and the only write path is the
-- human-session owner RPC below.

-- ---------------------------------------------------------------------------
-- 1. Flag shape.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION internal.valid_ai_feature_flags(p_flags jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(p_flags) = 'object'
    AND p_flags - ARRAY[
      'assistant','mcp_read','mcp_draft','mcp_workflow',
      'mcp_admin_read','mcp_admin_propose'
    ]::text[] = '{}'::jsonb
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'assistant','mcp_read','mcp_draft','mcp_workflow',
        'mcp_admin_read','mcp_admin_propose'
      ]::text[]) AS key
      WHERE jsonb_typeof(p_flags -> key) IS DISTINCT FROM 'boolean'
    )
$$;
--> statement-breakpoint

ALTER TABLE api.workspace_settings
  ADD COLUMN ai_feature_flags jsonb NOT NULL
  DEFAULT '{
    "assistant": true,
    "mcp_read": true,
    "mcp_draft": true,
    "mcp_workflow": false,
    "mcp_admin_read": false,
    "mcp_admin_propose": false
  }'::jsonb;
--> statement-breakpoint

ALTER TABLE api.workspace_settings
  ADD CONSTRAINT chk_workspace_settings_ai_feature_flags
  CHECK (internal.valid_ai_feature_flags(ai_feature_flags));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. The only write path: owner, live browser session.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.update_workspace_ai_feature_flags(
  p_workspace_id uuid,
  p_feature_flags jsonb
) RETURNS api.workspace_settings
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result api.workspace_settings;
BEGIN
  -- A browser session carries `session_id`; a personal or service credential
  -- does not. Flags are human-owned and cannot be changed by an agent token.
  IF api.current_user_id() IS NULL
     OR coalesce(api.claim_probe()->>'session_id', '') = ''
     OR coalesce(api.claim_probe()->>'credential_id', '') <> '' THEN
    RAISE EXCEPTION 'human session required for AI access flags'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_capability(p_workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'workspace owner required' USING ERRCODE = '42501';
  END IF;
  IF NOT internal.valid_ai_feature_flags(p_feature_flags) THEN
    RAISE EXCEPTION 'invalid AI feature flags' USING ERRCODE = '22023';
  END IF;

  UPDATE api.workspace_settings
     SET ai_feature_flags = p_feature_flags,
         ai_updated_by_user_id = api.current_user_id(),
         updated_at = now()
   WHERE workspace_id = p_workspace_id
   RETURNING * INTO v_result;

  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'workspace settings not found' USING ERRCODE = '42501';
  END IF;
  RETURN v_result;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.update_workspace_ai_feature_flags(uuid, jsonb)
  FROM PUBLIC;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION api.update_workspace_ai_feature_flags(uuid, jsonb)
  TO authenticated;
