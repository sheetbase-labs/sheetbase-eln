-- GOV-03 review pass: harden api.audit_events.
--
-- 1. Search escaping bug: '_' was escaped as '\%' instead of '\_', so a
--    literal-underscore search term behaved like '%'. ILIKE wildcard
--    escapes are \% _and_ \_; each must map to itself.
--
-- 2. Visibility contract made explicit: an event is visible iff the caller
--    can read the underlying object under Sheetbase's canonical rules.
--    Today every governed object class' authoritative SELECT policy is
--    exactly workspace membership (0004 projects, 0009 records,
--    0025 file_objects, 0035 dataset_schemas, 0072 sheet_definitions,
--    0074 sheet_instances, 0099 notebook_templates — verified across all
--    migrations), so the WHERE clause below implements that rule directly
--    and adds the stricter gated classes (api_credential,
--    workspace_invitation, workspace_settings, project_access events)
--    which are admin/security-only. api.project_access grants do NOT gate
--    any object read today, so applying them here would make history
--    strictly less visible than the live objects — diverging from, not
--    following, Sheetbase permissions. If a future migration narrows any
--    object's SELECT policy, THIS predicate must be narrowed with it;
--    tests/db/gov-03-audit-events.test.ts pins both sides of the contract.

CREATE OR REPLACE FUNCTION "api"."audit_events"(
  p_entity_type text DEFAULT NULL,
  p_operation text DEFAULT NULL,
  p_actor_user_id text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_object uuid DEFAULT NULL,
  p_before_sequence bigint DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claims jsonb;
  v_workspace uuid;
  v_role text;
  v_privileged boolean;
  v_search_like text;
  v_limit integer;
BEGIN
  v_claims := api.claim_probe();
  IF v_claims IS NULL
     OR nullif(v_claims->>'sub', '') IS NULL
     OR nullif(v_claims->>'session_id', '') IS NULL
     OR v_claims->>'role' <> 'authenticated' THEN
    RAISE EXCEPTION 'audit denied' USING ERRCODE = '42501';
  END IF;
  v_workspace := nullif(v_claims->>'workspace_id', '')::uuid;
  IF v_workspace IS NULL OR NOT api.is_workspace_member(v_workspace) THEN
    RAISE EXCEPTION 'audit denied' USING ERRCODE = '42501';
  END IF;

  -- Suspended members lost their seat: fail closed entirely rather than
  -- serving the workspace-scoped subset.
  SELECT membership.role INTO v_role
    FROM api.workspace_memberships membership
   WHERE membership.workspace_id = v_workspace
     AND membership.user_id = api.current_user_id()
     AND membership.suspended_at IS NULL;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'audit denied' USING ERRCODE = '42501';
  END IF;
  v_privileged := v_role IN ('owner', 'admin', 'steward');

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  -- ILIKE wildcard escaping: backslash first, then escape % and _ each as
  -- themselves (\% and \_) so user input matches literally.
  v_search_like := '%' ||
    replace(replace(replace(btrim(COALESCE(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_') ||
    '%';

  RETURN (
    WITH matches AS MATERIALIZED (
      SELECT e.sequence AS seq,
             e.id AS event_id,
             e.created_at AS created_at,
             e.entity_type AS entity_type,
             e.entity_uuid AS entity_uuid,
             e.operation AS operation,
             e.record_id AS record_id,
             e.project_id AS project_id,
             e.actor_user_id AS actor_user_id,
             e.actor_credential_id AS actor_credential_id,
             e.client_id AS client_id,
             e.payload AS payload,
             actor.name AS actor_name
      FROM api.change_events e
      LEFT JOIN "internal"."user" actor ON actor.id = e.actor_user_id
      WHERE e.workspace_id = v_workspace
        AND (p_entity_type IS NULL OR e.entity_type = p_entity_type)
        AND (p_operation IS NULL OR e.operation = p_operation)
        AND (p_actor_user_id IS NULL OR e.actor_user_id = p_actor_user_id)
        AND (p_from IS NULL OR e.created_at >= p_from)
        AND (p_to IS NULL OR e.created_at < p_to)
        AND (p_before_sequence IS NULL OR e.sequence < p_before_sequence)
        -- Object-readability boundary. See the contract note above: this
        -- implements each underlying object's canonical SELECT rule, which
        -- is workspace membership for every governed class, narrowed
        -- further for admin/security event classes.
        AND (
          v_privileged
          OR e.entity_type NOT IN (
            'api_credential', 'workspace_invitation', 'workspace_settings',
            'project_access'
          )
        )
        AND (
          btrim(COALESCE(p_search, '')) = ''
          OR e.payload::text ILIKE v_search_like
          OR e.entity_type ILIKE v_search_like
          OR e.operation ILIKE v_search_like
        )
        AND (
          p_object IS NULL
          OR e.entity_uuid = p_object
          OR e.record_id = p_object
          OR e.payload->>'datasetId' = p_object::text
          OR e.payload->>'templateId' = p_object::text
          OR e.payload->>'definitionId' = p_object::text
          OR e.payload->>'instanceId' = p_object::text
          OR e.payload->>'rotatedFromCredentialId' = p_object::text
          OR e.payload->>'rotatedToCredentialId' = p_object::text
        )
    ),
    page AS (
      SELECT * FROM matches ORDER BY seq DESC LIMIT v_limit
    )
    SELECT jsonb_build_object(
      'formatVersion', 1,
      'events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'sequence', seq,
          'id', event_id,
          'createdAt', to_char(created_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'entityType', entity_type,
          'entityUuid', entity_uuid,
          'operation', operation,
          'recordId', record_id,
          'projectId', project_id,
          'actorUserId', actor_user_id,
          'actorName', actor_name,
          'actorCredentialId', actor_credential_id,
          'clientId', client_id,
          'payload', payload
        ) ORDER BY seq DESC)
        FROM page
      ), '[]'::jsonb),
      'hasMore', EXISTS (SELECT 1 FROM matches OFFSET v_limit),
      'nextCursor', (SELECT MIN(seq) FROM page)
    )
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."audit_events"(text, text, text, timestamptz, timestamptz, text, uuid, bigint, integer)
  FROM PUBLIC, api_client;
GRANT EXECUTE ON FUNCTION "api"."audit_events"(text, text, text, timestamptz, timestamptz, text, uuid, bigint, integer)
  TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
