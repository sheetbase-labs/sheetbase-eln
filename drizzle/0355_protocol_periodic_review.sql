-- LAB-07 — periodic review: confirm as current, or start a new version.
--
-- An effective version carries a periodic review date. Confirming it as current
-- extends that date and is auditable; a superseded or retired version can never
-- be confirmed, and starting a new version remains the other exit. The used-by
-- list answers which experiments are pinned to a version and who has trained on
-- it, which is what the review decision needs.
CREATE OR REPLACE FUNCTION "api"."confirm_protocol_version_current"(
  p_version_id uuid,
  p_next_review_due_at timestamptz,
  p_reason text
) RETURNS "api"."protocol_versions"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_version api.protocol_versions;
BEGIN
  SELECT * INTO v_version FROM api.protocol_versions WHERE id = p_version_id FOR UPDATE;
  IF v_version.id IS NULL OR v_version.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'protocol version not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(v_version.workspace_id, 'schema.edit');
  IF v_version.status <> 'effective' THEN
    RAISE EXCEPTION 'only an effective protocol version can be confirmed' USING ERRCODE = 'SB113';
  END IF;
  IF NOT internal.protocol_version_is_eligible(v_version.id, false) THEN
    RAISE EXCEPTION 'protocol version is no longer current' USING ERRCODE = 'SB113';
  END IF;
  IF p_next_review_due_at IS NULL OR p_next_review_due_at <= now() THEN
    RAISE EXCEPTION 'a future review date is required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'a confirmation reason is required' USING ERRCODE = '22023';
  END IF;
  UPDATE api.protocol_versions
     SET review_due_at = p_next_review_due_at,
         reason = btrim(p_reason),
         updated_at = now(),
         updated_by_user_id = api.current_user_id()
   WHERE id = v_version.id
  RETURNING * INTO v_version;
  PERFORM internal.emit_change_event(v_version.workspace_id, 'protocol_version', v_version.id, 'update',
    NULL, NULL,
    jsonb_build_object('effect', 'confirmed_current', 'reviewDueAt', p_next_review_due_at,
      'reason', btrim(p_reason)));
  RETURN v_version;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."confirm_protocol_version_current"(uuid, timestamptz, text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."confirm_protocol_version_current"(uuid, timestamptz, text) TO authenticated;
--> statement-breakpoint

-- Used-by list: the experiments pinned to this exact version and the people who
-- have acknowledged it. Workspace-scoped and read-only. One row per version, so
-- the two lists never cross-multiply.
CREATE OR REPLACE FUNCTION "api"."protocol_version_usage"(p_version_id uuid)
RETURNS TABLE(
  protocol_version_id uuid,
  used_by_count integer,
  used_by jsonb,
  acknowledged_count integer,
  acknowledged_by jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH version AS (
    SELECT v.id, v.workspace_id FROM api.protocol_versions v
     WHERE v.id = p_version_id
       AND v.workspace_id = api.current_workspace_id()
       AND api.is_workspace_member(v.workspace_id)
  ), used AS (
    SELECT r.id, r.identifier, r.title, r.updated_at
      FROM api.records r JOIN version v ON v.workspace_id = r.workspace_id
     WHERE r.protocol_version_id = v.id AND r.deleted_at IS NULL
     ORDER BY r.identifier
  ), trained AS (
    SELECT a.user_id, a.acknowledged_at
      FROM api.protocol_acknowledgements a JOIN version v ON v.id = a.protocol_version_id
     ORDER BY a.acknowledged_at
  )
  SELECT v.id,
         (SELECT count(*)::int FROM used),
         coalesce((SELECT jsonb_agg(jsonb_build_object(
             'recordId', used.id, 'identifier', used.identifier, 'title', used.title,
             'startedAt', used.updated_at)) FROM used), '[]'::jsonb),
         (SELECT count(*)::int FROM trained),
         coalesce((SELECT jsonb_agg(jsonb_build_object(
             'userId', trained.user_id, 'acknowledgedAt', trained.acknowledged_at)) FROM trained), '[]'::jsonb)
    FROM version v
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."protocol_version_usage"(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."protocol_version_usage"(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
