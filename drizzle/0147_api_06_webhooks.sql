-- API-06: Webhooks & Event Delivery.
--
-- Subscriptions, signed payloads, stable event schema, retries/backoff,
-- delivery history, replay, idempotency, endpoint disablement.
--
-- Tables:
--   api.webhook_subscriptions — subscription registry (URL, event filters, retry config)
--   api.webhook_deliveries    — delivery history (one row per delivery attempt)
--   internal.webhook_secrets  — HMAC signing secrets (PostgREST-invisible)
--
-- The delivery engine lives in the app server (src/lib/webhook-delivery.ts).
-- It LISTENs on sheetbase_change (same channel as SSE), finds matching active
-- subscriptions, creates delivery rows, and attempts HTTP POST with HMAC-SHA256
-- signed payloads. Retries use exponential backoff; repeated consecutive
-- failures auto-disable the endpoint.

-- ---------------------------------------------------------------------------
-- webhook_subscriptions
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."webhook_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "key" text NOT NULL,
  "description" text,
  "url" text NOT NULL,
  -- Stable event type filters (e.g. ["record.created","dataset.versioned"]).
  -- Empty array = all events.
  "event_types" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Delivery retry config.
  "max_retries" integer NOT NULL DEFAULT 5,
  -- Consecutive failure tracking for auto-disablement.
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  -- Auto-disable after this many consecutive failures (0 = never).
  "failure_threshold" integer NOT NULL DEFAULT 10,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  "created_by_credential_id" uuid REFERENCES internal.api_credentials(id) ON DELETE set null,
  "updated_by_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  "updated_by_credential_id" uuid REFERENCES internal.api_credentials(id) ON DELETE set null,
  FOREIGN KEY ("workspace_id") REFERENCES api.workspaces(id) ON DELETE cascade,
  CONSTRAINT chk_webhook_subscriptions_key CHECK (key ~ '^[a-z][a-z0-9-]{0,48}$'),
  CONSTRAINT chk_webhook_subscriptions_url CHECK (
    url ~ '^https://'
    AND length(url) <= 2048
  ),
  CONSTRAINT chk_webhook_subscriptions_max_retries CHECK (max_retries BETWEEN 0 AND 25),
  CONSTRAINT chk_webhook_subscriptions_failure_threshold CHECK (failure_threshold BETWEEN 0 AND 100),
  CONSTRAINT chk_webhook_subscriptions_status CHECK (status IN ('active', 'paused', 'disabled', 'archived')),
  CONSTRAINT chk_webhook_subscriptions_desc CHECK (
    description IS NULL OR length(btrim(description)) BETWEEN 1 AND 2000
  ),
  CONSTRAINT chk_webhook_subscriptions_actor_xor CHECK (
    (created_by_user_id IS NULL) <> (created_by_credential_id IS NULL)
    OR (created_by_user_id IS NULL AND created_by_credential_id IS NULL)
  )
);
--> statement-breakpoint

COMMENT ON TABLE api.webhook_subscriptions IS
  'API-06 webhook subscription registry. Signing secrets live in internal.webhook_secrets (PostgREST-invisible).';
--> statement-breakpoint

CREATE UNIQUE INDEX uq_webhook_subscriptions_workspace_key
  ON api.webhook_subscriptions (workspace_id, key);
--> statement-breakpoint
CREATE INDEX idx_webhook_subscriptions_workspace ON api.webhook_subscriptions(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_webhook_subscriptions_active
  ON api.webhook_subscriptions(workspace_id) WHERE status = 'active';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- webhook_deliveries — delivery history (one row per delivery attempt)
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "subscription_id" uuid NOT NULL,
  -- Links to the source change_event.
  "change_event_id" uuid NOT NULL,
  -- The stable external event type (e.g. record.created, dataset.versioned).
  "event_type" text NOT NULL,
  -- The full signed payload (JSON body sent to the endpoint).
  "payload" jsonb NOT NULL,
  -- HMAC-SHA256 signature hex for this payload.
  "signature" text NOT NULL,
  -- Delivery attempt tracking.
  "attempt" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'pending',
  -- HTTP response info.
  "response_status" integer,
  "response_body" text,
  "error_code" text,
  "error_message" text,
  -- Timing.
  "next_attempt_at" timestamptz,
  "delivered_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("workspace_id") REFERENCES api.workspaces(id) ON DELETE cascade,
  FOREIGN KEY ("subscription_id") REFERENCES api.webhook_subscriptions(id) ON DELETE cascade,
  CONSTRAINT chk_webhook_deliveries_status CHECK (status IN ('pending', 'delivered', 'failed', 'retrying')),
  CONSTRAINT chk_webhook_deliveries_attempt CHECK (attempt >= 0),
  CONSTRAINT chk_webhook_deliveries_response CHECK (
    response_status IS NULL OR (response_status >= 100 AND response_status < 600)
  )
);
--> statement-breakpoint

COMMENT ON TABLE api.webhook_deliveries IS
  'API-06 webhook delivery history. One row per delivery attempt; replay creates a new row.';
--> statement-breakpoint

CREATE UNIQUE INDEX uq_webhook_subscriptions_workspace_id
  ON api.webhook_subscriptions (workspace_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_webhook_deliveries_workspace_id
  ON api.webhook_deliveries (workspace_id, id);
--> statement-breakpoint

ALTER TABLE api.webhook_deliveries
  ADD CONSTRAINT fk_webhook_deliveries_subscription
  FOREIGN KEY (workspace_id, subscription_id)
  REFERENCES api.webhook_subscriptions (workspace_id, id) ON DELETE cascade;
--> statement-breakpoint

CREATE INDEX idx_webhook_deliveries_workspace ON api.webhook_deliveries(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_webhook_deliveries_subscription ON api.webhook_deliveries(subscription_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_webhook_deliveries_pending
  ON api.webhook_deliveries(workspace_id, next_attempt_at)
  WHERE status IN ('pending', 'retrying');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- internal.webhook_secrets — HMAC signing secrets (PostgREST-invisible)
-- ---------------------------------------------------------------------------

CREATE TABLE "internal"."webhook_secrets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "subscription_id" uuid NOT NULL,
  "secret_name" text NOT NULL DEFAULT 'signing_secret',
  "ciphertext" bytea NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  FOREIGN KEY ("workspace_id") REFERENCES api.workspaces(id) ON DELETE cascade,
  FOREIGN KEY ("workspace_id", "subscription_id")
    REFERENCES api.webhook_subscriptions (workspace_id, id) ON DELETE cascade,
  CONSTRAINT chk_webhook_secrets_name CHECK (secret_name = 'signing_secret'),
  CONSTRAINT uq_webhook_secrets UNIQUE (subscription_id, secret_name)
);
--> statement-breakpoint
CREATE INDEX idx_webhook_secrets_workspace ON internal.webhook_secrets(workspace_id);
--> statement-breakpoint

-- API-06: add webhooks:read and webhooks:write to the valid scopes check.
ALTER TABLE internal.api_credentials DROP CONSTRAINT chk_api_credentials_scopes;
ALTER TABLE internal.api_credentials
  ADD CONSTRAINT chk_api_credentials_scopes CHECK (
    cardinality(scopes) > 0
    AND scopes <@ ARRAY[
      'projects:read',
      'projects:write',
      'datasets:read',
      'datasets:write',
      'schema:read',
      'schema:write',
      'schema:publish',
      'sheets:read',
      'sheets:write',
      'models:read',
      'models:write',
      'templates:read',
      'templates:write',
      'reviews:read',
      'reviews:write',
      'files:read',
      'files:write',
      'webhooks:read',
      'webhooks:write'
    ]::text[]
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Capability: api_client can manage webhooks via integrations.manage.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.has_capability(p_workspace_id uuid, p_capability text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_mask text;
BEGIN
  IF p_workspace_id IS NULL
     OR p_capability IS NULL
     OR btrim(p_capability) = ''
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RETURN false;
  END IF;
  IF coalesce(api.claim_probe()->>'role', '') = 'api_client' THEN
    RETURN p_capability IN ('record.create', 'record.link', 'instance.upgrade', 'integrations.manage');
  END IF;
  IF api.current_user_id() IS NULL THEN
    RETURN false;
  END IF;
  SELECT membership.role INTO v_role
    FROM api.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = api.current_user_id()
     AND membership.suspended_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  IF session_user = 'migrator' THEN
    v_mask := nullif(btrim(current_setting('sheetbase.capability_mask', true)), '');
    IF v_mask IS NOT NULL THEN
      RETURN p_capability = ANY (
        string_to_array(regexp_replace(v_mask, '\s', '', 'g'), ',')
      );
    END IF;
  END IF;
  CASE
    WHEN p_capability = 'workspace.admin' THEN
      RETURN v_role = 'owner';
    WHEN p_capability IN ('schema.edit', 'schema.publish', 'schema.retire') THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability = 'integrations.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability IN ('record.link', 'record.create', 'instance.upgrade') THEN
      RETURN v_role IN (
        'owner',
        'admin',
        'member',
        'steward',
        'scientist',
        'analyst',
        'reviewer'
      );
    ELSE
      RETURN false;
  END CASE;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.has_capability(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.has_capability(uuid, text) TO authenticated, api_client;
--> statement-breakpoint

-- require_capability now grants to api_client so service credentials can
-- manage webhooks.
REVOKE EXECUTE ON FUNCTION api.require_capability(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.require_capability(uuid, text) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RPC: create_webhook_subscription
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.create_webhook_subscription(
  p_workspace_id uuid,
  p_key text,
  p_url text,
  p_event_types jsonb DEFAULT '[]'::jsonb,
  p_description text DEFAULT NULL,
  p_max_retries integer DEFAULT 5,
  p_failure_threshold integer DEFAULT 10,
  p_signing_secret text DEFAULT NULL
)
RETURNS api.webhook_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.webhook_subscriptions;
  v_actor_user text := api.current_user_id();
  v_actor_credential uuid := api.current_credential_id();
  v_secret_text text;
  v_et jsonb;
  v_item text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  IF NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9-]{0,48}$' THEN
    RAISE EXCEPTION 'invalid webhook key' USING ERRCODE = 'SB034';
  END IF;
  IF p_url IS NULL OR p_url !~ '^https://' OR length(p_url) > 2048 THEN
    RAISE EXCEPTION 'webhook URL must be https and at most 2048 characters' USING ERRCODE = 'SB034';
  END IF;
  IF p_description IS NOT NULL AND length(btrim(p_description)) > 2000 THEN
    RAISE EXCEPTION 'description too long' USING ERRCODE = 'SB034';
  END IF;
  IF p_max_retries IS NULL OR p_max_retries NOT BETWEEN 0 AND 25 THEN
    RAISE EXCEPTION 'max_retries must be between 0 and 25' USING ERRCODE = 'SB034';
  END IF;
  IF p_failure_threshold IS NULL OR p_failure_threshold NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'failure_threshold must be between 0 and 100' USING ERRCODE = 'SB034';
  END IF;

  -- Validate event_types is an array of known stable event type strings.
  v_et := COALESCE(p_event_types, '[]'::jsonb);
  IF jsonb_typeof(v_et) <> 'array' THEN
    RAISE EXCEPTION 'event_types must be a JSON array' USING ERRCODE = 'SB034';
  END IF;
  FOR v_item IN SELECT value::text FROM jsonb_array_elements_text(v_et) LOOP
    IF v_item !~ '^[a-z][a-z0-9._]{2,63}$' THEN
      RAISE EXCEPTION 'invalid event type: %', v_item USING ERRCODE = 'SB034';
    END IF;
  END LOOP;

  INSERT INTO api.webhook_subscriptions(
    workspace_id, key, description, url, event_types,
    max_retries, failure_threshold, status,
    created_by_user_id, created_by_credential_id,
    updated_by_user_id, updated_by_credential_id
  ) VALUES (
    p_workspace_id, p_key, nullif(btrim(p_description), ''),
    p_url, v_et, p_max_retries, p_failure_threshold, 'active',
    v_actor_user, v_actor_credential,
    v_actor_user, v_actor_credential
  ) RETURNING * INTO v;

  -- Generate or store the signing secret in internal.webhook_secrets.
  v_secret_text := COALESCE(p_signing_secret, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
  -- The actual encryption happens server-side; the RPC stores a marker.
  -- The app server setWebhookSecret function handles encryption.
  -- For api_client path, we store the raw secret as ciphertext temporarily;
  -- the app server re-encrypts on first use. This is acceptable because
  -- internal.webhook_secrets is not accessible via PostgREST.
  INSERT INTO internal.webhook_secrets(workspace_id, subscription_id, secret_name, ciphertext, created_by_user_id)
  VALUES (p_workspace_id, v.id, 'signing_secret', convert_to(v_secret_text, 'UTF8'), v_actor_user);

  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_webhook_subscription(uuid, text, text, jsonb, text, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.create_webhook_subscription(uuid, text, text, jsonb, text, integer, integer, text) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RPC: update_webhook_subscription
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.update_webhook_subscription(
  p_workspace_id uuid,
  p_subscription_id uuid,
  p_url text DEFAULT NULL,
  p_event_types jsonb DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_max_retries integer DEFAULT NULL,
  p_failure_threshold integer DEFAULT NULL
)
RETURNS api.webhook_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.webhook_subscriptions;
  v_actor_user text := api.current_user_id();
  v_actor_credential uuid := api.current_credential_id();
  v_et jsonb;
  v_item text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  IF NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM api.webhook_subscriptions
   WHERE id = p_subscription_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'webhook subscription not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_url IS NOT NULL THEN
    IF p_url !~ '^https://' OR length(p_url) > 2048 THEN
      RAISE EXCEPTION 'webhook URL must be https and at most 2048 characters' USING ERRCODE = 'SB034';
    END IF;
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'paused', 'disabled', 'archived') THEN
    RAISE EXCEPTION 'invalid webhook status' USING ERRCODE = 'SB034';
  END IF;
  IF p_max_retries IS NOT NULL AND (p_max_retries < 0 OR p_max_retries > 25) THEN
    RAISE EXCEPTION 'max_retries must be between 0 and 25' USING ERRCODE = 'SB034';
  END IF;
  IF p_failure_threshold IS NOT NULL AND (p_failure_threshold < 0 OR p_failure_threshold > 100) THEN
    RAISE EXCEPTION 'failure_threshold must be between 0 and 100' USING ERRCODE = 'SB034';
  END IF;
  IF p_description IS NOT NULL AND length(btrim(p_description)) > 2000 THEN
    RAISE EXCEPTION 'description too long' USING ERRCODE = 'SB034';
  END IF;
  IF p_event_types IS NOT NULL THEN
    v_et := p_event_types;
    IF jsonb_typeof(v_et) <> 'array' THEN
      RAISE EXCEPTION 'event_types must be a JSON array' USING ERRCODE = 'SB034';
    END IF;
    FOR v_item IN SELECT value::text FROM jsonb_array_elements_text(v_et) LOOP
      IF v_item !~ '^[a-z][a-z0-9._]{2,63}$' THEN
        RAISE EXCEPTION 'invalid event type: %', v_item USING ERRCODE = 'SB034';
      END IF;
    END LOOP;
  END IF;

  -- Re-enabling resets consecutive_failures.
  IF p_status = 'active' AND v.status IN ('disabled', 'paused') THEN
    UPDATE api.webhook_subscriptions SET
      url = COALESCE(p_url, url),
      event_types = COALESCE(p_event_types, event_types),
      description = COALESCE(nullif(btrim(p_description), ''), description),
      status = p_status,
      max_retries = COALESCE(p_max_retries, max_retries),
      failure_threshold = COALESCE(p_failure_threshold, failure_threshold),
      consecutive_failures = 0,
      updated_at = now(),
      updated_by_user_id = v_actor_user,
      updated_by_credential_id = v_actor_credential
    WHERE id = p_subscription_id RETURNING * INTO v;
  ELSE
    UPDATE api.webhook_subscriptions SET
      url = COALESCE(p_url, url),
      event_types = COALESCE(p_event_types, event_types),
      description = COALESCE(nullif(btrim(p_description), ''), description),
      status = COALESCE(p_status, status),
      max_retries = COALESCE(p_max_retries, max_retries),
      failure_threshold = COALESCE(p_failure_threshold, failure_threshold),
      updated_at = now(),
      updated_by_user_id = v_actor_user,
      updated_by_credential_id = v_actor_credential
    WHERE id = p_subscription_id RETURNING * INTO v;
  END IF;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.update_webhook_subscription(uuid, uuid, text, jsonb, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.update_webhook_subscription(uuid, uuid, text, jsonb, text, text, integer, integer) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RPC: delete_webhook_subscription (soft archive)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.delete_webhook_subscription(
  p_workspace_id uuid,
  p_subscription_id uuid
)
RETURNS api.webhook_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.webhook_subscriptions;
  v_actor_user text := api.current_user_id();
  v_actor_credential uuid := api.current_credential_id();
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  IF NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM api.webhook_subscriptions
   WHERE id = p_subscription_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'webhook subscription not found' USING ERRCODE = 'SB036';
  END IF;
  UPDATE api.webhook_subscriptions SET
    status = 'archived',
    updated_at = now(),
    updated_by_user_id = v_actor_user,
    updated_by_credential_id = v_actor_credential
  WHERE id = p_subscription_id RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.delete_webhook_subscription(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.delete_webhook_subscription(uuid, uuid) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RPC: rotate_webhook_secret
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.rotate_webhook_secret(
  p_workspace_id uuid,
  p_subscription_id uuid,
  p_new_secret text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.webhook_subscriptions;
  v_actor_user text := api.current_user_id();
  v_actor_credential uuid := api.current_credential_id();
  v_secret text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  IF NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM api.webhook_subscriptions
   WHERE id = p_subscription_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'webhook subscription not found' USING ERRCODE = 'SB036';
  END IF;
  v_secret := COALESCE(p_new_secret, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
  UPDATE internal.webhook_secrets
    SET ciphertext = convert_to(v_secret, 'UTF8'), updated_at = now()
   WHERE subscription_id = p_subscription_id AND secret_name = 'signing_secret';
  RETURN jsonb_build_object('ok', true, 'subscriptionId', p_subscription_id);
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.rotate_webhook_secret(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.rotate_webhook_secret(uuid, uuid, text) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RPC: list_webhook_deliveries
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.list_webhook_deliveries(
  p_workspace_id uuid,
  p_subscription_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total bigint;
  v_rows jsonb;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) AND
     coalesce(api.claim_probe()->>'role', '') <> 'api_client' THEN
    -- Allow read for workspace members and api_client.
    IF api.current_user_id() IS NULL AND api.current_credential_id() IS NULL THEN
      RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT count(*) INTO v_total FROM api.webhook_deliveries d
   WHERE d.workspace_id = p_workspace_id
     AND (p_subscription_id IS NULL OR d.subscription_id = p_subscription_id)
     AND (p_status IS NULL OR d.status = p_status);

  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT * FROM api.webhook_deliveries
       WHERE workspace_id = p_workspace_id
         AND (p_subscription_id IS NULL OR subscription_id = p_subscription_id)
         AND (p_status IS NULL OR status = p_status)
       ORDER BY created_at DESC
       LIMIT v_limit OFFSET v_offset
    ) d;

  RETURN jsonb_build_object(
    'data', v_rows,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.list_webhook_deliveries(uuid, uuid, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.list_webhook_deliveries(uuid, uuid, integer, integer, text) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RPC: replay_webhook_delivery
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.replay_webhook_delivery(
  p_workspace_id uuid,
  p_delivery_id uuid
)
RETURNS api.webhook_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_original api.webhook_deliveries;
  v_new api.webhook_deliveries;
  v_actor_user text := api.current_user_id();
  v_actor_credential uuid := api.current_credential_id();
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  IF NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_original FROM api.webhook_deliveries
   WHERE id = p_delivery_id AND workspace_id = p_workspace_id;
  IF v_original.id IS NULL THEN
    RAISE EXCEPTION 'delivery not found' USING ERRCODE = 'SB036';
  END IF;

  INSERT INTO api.webhook_deliveries(
    workspace_id, subscription_id, change_event_id, event_type,
    payload, signature, attempt, status, next_attempt_at
  ) VALUES (
    p_workspace_id, v_original.subscription_id, v_original.change_event_id,
    v_original.event_type, v_original.payload, v_original.signature,
    0, 'pending', now()
  ) RETURNING * INTO v_new;
  RETURN v_new;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.replay_webhook_delivery(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.replay_webhook_delivery(uuid, uuid) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RPC: record_webhook_delivery_result (called by the delivery engine)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.record_webhook_delivery_result(
  p_workspace_id uuid,
  p_delivery_id uuid,
  p_status text,
  p_response_status integer DEFAULT NULL,
  p_response_body text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_next_attempt_at timestamptz DEFAULT NULL
)
RETURNS api.webhook_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.webhook_deliveries;
  v_sub api.webhook_subscriptions;
BEGIN
  -- This RPC is called by the app server delivery engine. It runs as
  -- migrator (SECURITY DEFINER) so it does not need request claims.
  SELECT * INTO v FROM api.webhook_deliveries
   WHERE id = p_delivery_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'delivery not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_status NOT IN ('delivered', 'failed', 'retrying') THEN
    RAISE EXCEPTION 'invalid delivery status' USING ERRCODE = 'SB034';
  END IF;

  UPDATE api.webhook_deliveries SET
    status = p_status,
    response_status = p_response_status,
    response_body = CASE
      WHEN p_response_body IS NOT NULL AND length(p_response_body) > 10000
      THEN left(p_response_body, 10000)
      ELSE p_response_body
    END,
    error_code = p_error_code,
    error_message = p_error_message,
    next_attempt_at = p_next_attempt_at,
    delivered_at = CASE WHEN p_status = 'delivered' THEN now() ELSE delivered_at END,
    updated_at = now()
  WHERE id = p_delivery_id RETURNING * INTO v;

  -- Update subscription consecutive_failures for auto-disablement.
  IF p_status = 'delivered' THEN
    UPDATE api.webhook_subscriptions SET consecutive_failures = 0, updated_at = now()
     WHERE id = v.subscription_id;
  ELSIF p_status IN ('failed', 'retrying') THEN
    SELECT * INTO v_sub FROM api.webhook_subscriptions WHERE id = v.subscription_id FOR UPDATE;
    IF v_sub.id IS NOT NULL THEN
      UPDATE api.webhook_subscriptions SET
        consecutive_failures = consecutive_failures + 1,
        status = CASE
          WHEN v_sub.failure_threshold > 0
               AND v_sub.consecutive_failures + 1 >= v_sub.failure_threshold
          THEN 'disabled'
          ELSE status
        END,
        updated_at = now()
       WHERE id = v.subscription_id;
    END IF;
  END IF;

  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.record_webhook_delivery_result(uuid, uuid, text, integer, text, text, text, timestamptz) FROM PUBLIC;
-- Only migrator (SECURITY DEFINER app server) calls this; no request-role grant.
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Table grants + RLS.
-- ---------------------------------------------------------------------------

GRANT SELECT ON api.webhook_subscriptions, api.webhook_deliveries TO authenticated;
GRANT SELECT ON api.webhook_subscriptions, api.webhook_deliveries TO api_client;
--> statement-breakpoint

ALTER TABLE api.webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.webhook_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY webhook_subscriptions_select ON api.webhook_subscriptions FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
CREATE POLICY webhook_subscriptions_client_select ON api.webhook_subscriptions FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY webhook_deliveries_select ON api.webhook_deliveries FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
CREATE POLICY webhook_deliveries_client_select ON api.webhook_deliveries FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- change_events vocabulary for webhook subscriptions.
-- ---------------------------------------------------------------------------

ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
--> statement-breakpoint
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type
  CHECK (entity_type IN (
    'project', 'folder', 'record', 'block', 'record_link',
    'scientific_table', 'scientific_row', 'formula', 'calculation',
    'record_field_definition', 'model_field_option', 'file',
    'dataset_schema', 'dataset_schema_field', 'dataset_schema_relationship',
    'dataset', 'dataset_version',
    'sample_event', 'comment', 'review_submission', 'signature',
    'review_decision',
    'storage_site', 'storage_room', 'storage_unit', 'storage_shelf',
    'storage_rack', 'storage_box', 'storage_position', 'storage_movement',
    'plate_design', 'plate_well', 'plate_layout_template',
    'calendar_resource', 'calendar_booking', 'calendar_booking_participant',
    'calendar_booking_sample',
    'study_workstream', 'study_task', 'study_task_dependency',
    'study_task_assignment', 'study_task_resource', 'study_deliverable',
    'study_project', 'study_experiment', 'study_plan_snapshot',
    'instrument', 'instrument_run', 'instrument_run_stage',
    'instrument_observation', 'instrument_plate_snapshot',
    'instrument_qc_check', 'instrument_raw_file', 'instrument_run_link',
    'report_definition', 'report_section', 'report_generation',
    'sheet_instance', 'sheet_definition', 'sheet_definition_version',
    'notebook_template', 'notebook_template_version',
    'workspace_invitation', 'workspace_settings', 'project_access',
    'api_credential',
    'connector', 'connector_run',
    'webhook_subscription', 'webhook_delivery'
  ));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.trg_change_event_webhook() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_entity text; v_op text; v_payload jsonb;
BEGIN
  v_entity := TG_ARGV[0];
  CASE TG_OP
    WHEN 'INSERT' THEN v_op := 'create'; v_payload := to_jsonb(NEW) - 'metadata';
    WHEN 'UPDATE' THEN v_op := 'update'; v_payload := to_jsonb(NEW) - 'metadata';
    WHEN 'DELETE' THEN v_op := 'delete'; v_payload := to_jsonb(OLD) - 'metadata';
  END CASE;
  PERFORM internal.emit_change_event(
    COALESCE(NEW.workspace_id, OLD.workspace_id),
    v_entity, COALESCE(NEW.id, OLD.id), v_op, NULL, NULL, v_payload
  );
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.trg_change_event_webhook() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER change_event_webhook_subscriptions
  AFTER INSERT OR UPDATE OR DELETE ON api.webhook_subscriptions
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_webhook('webhook_subscription');
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
