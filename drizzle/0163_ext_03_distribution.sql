-- ---------------------------------------------------------------------------
-- EXT-03: Governable extension distribution.
--
-- Completes the EXT-01/02 lifecycle and adds distribution trust on top of
-- the canonical registry (no new tables, no second authority):
--
-- * `api.remove_extension` — revokes the bound credential first (no orphan
--   authority), deletes the install row (contributions resolve nothing
--   once the row is gone; the registry only renders `enabled` installs),
--   and audits via the existing `change_event_extensions` trigger
--   (`extension` / `delete` with the OLD row payload). Extensions have no
--   dependents yet, so removal is unconditional besides `extensions.manage`
--   gating — documented, not invented.
-- * `api.update_extension` — new manifest/version for an install. Resets
--   the row to `installed` and revokes the bound credential: new code
--   never auto-runs and new scopes never inherit old authority. The admin
--   re-enables after review and re-issues credentials.
-- * Trust: only `https:` sources are trusted. Any other source identity
--   (`dev:`, `registry:`, …) needs `p_acknowledge_untrusted = true` on
--   install/update, else SB034. The check lives server-side; the admin UI
--   acknowledgement checkbox is gating, not enforcement.
-- * `compatibleWith` manifest range: validated here with the same grammar
--   as `src/lib/extensions/compat.ts` (`*`, exact versions, explicit
--   `>=`/`<=`/`>`/`<`/`=` comparators — no caret/tilde shims). Compat
--   *state* (compatible/unknown/incompatible) is computed client-side
--   against the deployment artifact version; the server never auto-blocks
--   or auto-disables on compat — incompatible installs warn, never
--   silently break.
-- * `api.audit_events` object correlation gains the extension audit
--   identity (`payload.extension_id`, stamped by callers performing
--   durable extension-attributed writes), so the admin Extensions section
--   reads lifecycle + invocation history for an install from the one
--   canonical `change_events` stream.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- compatibleWith validation. Mirrors validateCompatRange
-- (src/lib/extensions/compat.ts); the parity tests keep both in lockstep.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.validate_extension_compat(p_manifest jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_range text;
  v_token text;
BEGIN
  IF (p_manifest ? 'compatibleWith') IS DISTINCT FROM true THEN
    RETURN;
  END IF;
  v_range := btrim(p_manifest->>'compatibleWith');
  IF v_range IS NULL OR v_range = '' OR length(v_range) > 200 THEN
    RAISE EXCEPTION 'invalid extension compatibleWith' USING ERRCODE = 'SB034';
  END IF;
  FOR v_token IN SELECT * FROM regexp_split_to_table(v_range, '\s+') LOOP
    IF v_token = '*' THEN
      CONTINUE;
    END IF;
    IF v_token !~ '^((>=|<=|>|<|=)?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?)$' THEN
      RAISE EXCEPTION 'invalid extension compatibleWith comparator: %', v_token
        USING ERRCODE = 'SB034';
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.validate_extension_compat(jsonb)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Shared guards: untrusted sources need explicit acknowledgement; bound
-- credentials are revoked (with audit) before the row is deleted or reset.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.require_extension_source_ack(
  p_source text,
  p_acknowledge_untrusted boolean
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF left(p_source, 8) = 'https://' THEN
    RETURN;
  END IF;
  IF COALESCE(p_acknowledge_untrusted, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'untrusted extension source requires explicit acknowledgement'
      USING ERRCODE = 'SB034';
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.require_extension_source_ack(text, boolean)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.revoke_extension_credential(
  p_workspace_id uuid,
  p_extension_id uuid,
  p_extension_key text,
  p_credential_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_credential_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE internal.api_credentials SET revoked_at = now()
   WHERE id = p_credential_id AND revoked_at IS NULL;
  IF FOUND THEN
    PERFORM internal.emit_change_event_as_actor(
      api.current_user_id(),
      p_workspace_id,
      'api_credential',
      p_credential_id,
      'revoke',
      NULL,
      NULL,
      jsonb_build_object(
        'extension_id', p_extension_id::text,
        'extensionKey', p_extension_key
      )
    );
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.revoke_extension_credential(uuid, uuid, text, uuid)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Install gains the trust acknowledgement. DROP + CREATE: the signature
-- grows a defaulted parameter, which CREATE OR REPLACE forbids.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.install_extension(uuid, text, text, text, text, jsonb);
--> statement-breakpoint
CREATE FUNCTION api.install_extension(
  p_workspace_id uuid,
  p_key text,
  p_name text,
  p_version text,
  p_source text,
  p_manifest jsonb,
  p_acknowledge_untrusted boolean DEFAULT false
)
RETURNS api.extensions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.extensions;
  v_name text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'extensions.manage');
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9-]{0,48}$' THEN
    RAISE EXCEPTION 'invalid extension key' USING ERRCODE = 'SB034';
  END IF;
  v_name := btrim(p_name);
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid extension name' USING ERRCODE = 'SB034';
  END IF;
  IF p_version IS NULL
     OR p_version !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$' THEN
    RAISE EXCEPTION 'invalid extension version' USING ERRCODE = 'SB034';
  END IF;
  IF p_source IS NULL
     OR length(p_source) NOT BETWEEN 1 AND 500
     OR (
       left(p_source, 8) <> 'https://'
       AND p_source !~ '^[a-z][a-z0-9-]*:[^/][a-zA-Z0-9._/~?#%@!$&''()*+,;=-]+$'
     ) THEN
    RAISE EXCEPTION 'invalid extension source' USING ERRCODE = 'SB034';
  END IF;
  PERFORM internal.validate_extension_manifest(p_manifest);
  PERFORM internal.validate_extension_compat(p_manifest);
  PERFORM internal.require_extension_source_ack(p_source, p_acknowledge_untrusted);
  -- Row columns mirror the manifest identity: one authority, no drift.
  IF btrim(p_manifest->>'name') IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'extension name must match the manifest' USING ERRCODE = 'SB034';
  END IF;
  IF (p_manifest->>'version') IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'extension version must match the manifest' USING ERRCODE = 'SB034';
  END IF;
  IF (p_manifest->>'source') IS DISTINCT FROM p_source THEN
    RAISE EXCEPTION 'extension source must match the manifest' USING ERRCODE = 'SB034';
  END IF;
  INSERT INTO api.extensions(
    workspace_id, key, name, version, source, manifest, status,
    created_by_user_id, updated_by_user_id
  ) VALUES (
    p_workspace_id, p_key, v_name, p_version, p_source, p_manifest, 'installed',
    api.current_user_id(), api.current_user_id()
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.install_extension(uuid, text, text, text, text, jsonb, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.install_extension(uuid, text, text, text, text, jsonb, boolean) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Update: same validation as install, then reset to `installed` with the
-- bound credential revoked. New code never auto-runs; the enable/disable
-- machine and the `change_event_extensions` trigger audit the rest.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.update_extension(
  p_workspace_id uuid,
  p_extension_id uuid,
  p_name text,
  p_version text,
  p_source text,
  p_manifest jsonb,
  p_acknowledge_untrusted boolean DEFAULT false
)
RETURNS api.extensions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.extensions;
  v_name text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'extensions.manage');
  SELECT * INTO v FROM api.extensions
   WHERE id = p_extension_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'extension not found' USING ERRCODE = 'SB036';
  END IF;
  v_name := btrim(p_name);
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid extension name' USING ERRCODE = 'SB034';
  END IF;
  IF p_version IS NULL
     OR p_version !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$' THEN
    RAISE EXCEPTION 'invalid extension version' USING ERRCODE = 'SB034';
  END IF;
  IF p_source IS NULL
     OR length(p_source) NOT BETWEEN 1 AND 500
     OR (
       left(p_source, 8) <> 'https://'
       AND p_source !~ '^[a-z][a-z0-9-]*:[^/][a-zA-Z0-9._/~?#%@!$&''()*+,;=-]+$'
     ) THEN
    RAISE EXCEPTION 'invalid extension source' USING ERRCODE = 'SB034';
  END IF;
  PERFORM internal.validate_extension_manifest(p_manifest);
  PERFORM internal.validate_extension_compat(p_manifest);
  PERFORM internal.require_extension_source_ack(p_source, p_acknowledge_untrusted);
  IF btrim(p_manifest->>'name') IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'extension name must match the manifest' USING ERRCODE = 'SB034';
  END IF;
  IF (p_manifest->>'version') IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'extension version must match the manifest' USING ERRCODE = 'SB034';
  END IF;
  IF (p_manifest->>'source') IS DISTINCT FROM p_source THEN
    RAISE EXCEPTION 'extension source must match the manifest' USING ERRCODE = 'SB034';
  END IF;
  PERFORM internal.revoke_extension_credential(
    p_workspace_id, v.id, v.key, v.credential_id
  );
  UPDATE api.extensions SET
    name = v_name,
    version = p_version,
    source = p_source,
    manifest = p_manifest,
    status = 'installed',
    credential_id = NULL,
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
  WHERE id = p_extension_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.update_extension(uuid, uuid, text, text, text, jsonb, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_extension(uuid, uuid, text, text, text, jsonb, boolean) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Remove: revoke-then-delete. The DELETE fires the existing
-- `change_event_extensions` trigger (`extension` / `delete`).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.remove_extension(
  p_workspace_id uuid,
  p_extension_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.extensions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'extensions.manage');
  SELECT * INTO v FROM api.extensions
   WHERE id = p_extension_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'extension not found' USING ERRCODE = 'SB036';
  END IF;
  PERFORM internal.revoke_extension_credential(
    p_workspace_id, v.id, v.key, v.credential_id
  );
  DELETE FROM api.extensions WHERE id = p_extension_id;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.remove_extension(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.remove_extension(uuid, uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- audit_events object correlation: match the extension audit identity so
-- one query returns an install's lifecycle plus its attributed invocations.
-- Identical to 0134 except the two extension_id predicates below.
-- ---------------------------------------------------------------------------
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
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."audit_events"(text, text, text, timestamptz, timestamptz, text, uuid, bigint, integer)
  FROM PUBLIC, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."audit_events"(text, text, text, timestamptz, timestamptz, text, uuid, bigint, integer)
  TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
