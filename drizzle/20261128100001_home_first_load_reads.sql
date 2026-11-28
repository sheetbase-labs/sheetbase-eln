-- Home's first load waited about a second on two reads of the change log, each
-- running the full access check on every event in the workspace before keeping
-- a few dozen:
--
-- * "What I last worked on" (recents) asks for my latest edits. An index on
--   workspace, actor and time lets it walk my events newest first and stop at
--   the limit, so the access check runs on about 300 events, not all of them.
-- * The activity feed (`api.audit_events`) checked every event, then kept the
--   newest 24. It now walks the workspace's events newest first and stops one
--   past the page (to know whether there is more). Same rows, same order, same
--   cursor; the filters are unchanged.
CREATE INDEX IF NOT EXISTS idx_change_events_workspace_actor_created
  ON api.change_events USING btree (workspace_id, actor_user_id, created_at DESC);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.audit_events(p_entity_type text DEFAULT NULL::text, p_operation text DEFAULT NULL::text, p_actor_user_id text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_search text DEFAULT NULL::text, p_object uuid DEFAULT NULL::uuid, p_before_sequence bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    WITH matches AS (
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
      WHERE e.workspace_id = v_workspace AND internal.can_read_change_event(e)
        AND (p_entity_type IS NULL OR e.entity_type = p_entity_type)
        AND (p_operation IS NULL OR e.operation = p_operation)
        AND (p_actor_user_id IS NULL OR e.actor_user_id = p_actor_user_id)
        AND (p_project_id IS NULL OR e.project_id = p_project_id)
        AND (p_from IS NULL OR e.created_at >= p_from)
        AND (p_to IS NULL OR e.created_at < p_to)
        AND (p_before_sequence IS NULL OR e.sequence < p_before_sequence)
        -- Object-readability boundary. See the contract note in 0134: this
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
          OR e.payload->>'extension_id' = p_object::text
          OR e.payload->>'extensionId' = p_object::text
        )
      ORDER BY e.sequence DESC
      LIMIT v_limit + 1
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
      'hasMore', (SELECT count(*) FROM matches) > v_limit,
      'nextCursor', (SELECT MIN(seq) FROM page)
    )
  );
END;
$function$;
